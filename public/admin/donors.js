/**
 * Admin → Donors & Partners: everyone who gives, the partners on the website, and checks into Zeffy
 * ===========================================================================
 * Peter, Nov 11 2026: "i want a donor crm, similar to how kids is built today", Checks "is not related to job costs
 * and probably needs its own place on the sidebar called donors", and Partners in with it. Over /api/donors-admin
 * (functions/api/_donors.js, _donor-crm.js): Zeffy stays where gifts are taken, receipted and changed, and every gift
 * and donor here opens there in one click. What only the site knows (which organization a Zeffy name is, two records
 * that are one person, Keep anonymous) is said here, privately: nothing on this page reaches the website by itself.
 *
 * One area, four tabs (./donor-tabs.js): Donors and Checks here, Partners and Community partners in index.html.
 * Addresses: #donors, #donors/needs, #donors/thanks, #donors/checks, #donors/<Zeffy contact id> (a person),
 * #donors/org/<p:slug|o:id> (an organization), #donors/gift/<payment id> (whoever a gift counts for, the gift marked:
 * the MAJOR GIFT Slack post links this). The old #job-costs/checks opens Checks here.
 *
 * Donors     people and organizations: New (first gift within 12 months), Active (a gift within 18 months), Lapsed
 *            (none in 18 months); Organizations; Not yet this year (gave last year, nothing yet this year: the
 *            year-end list); To thank (gifts Zeffy sends no thank-you for, and every gift of $1,000 or more:
 *            functions/api/_donor-thanks.js); Needs you (a near name, a gift two organizations could have, two records
 *            that may be one person, a partner whose giving says Champion, a big giver with no organization, a name
 *            that reads as an organization's). The list and To thank filter by who on the team looks after them
 *            (Owner); Needs you is about records, not whose they are, so it's everyone's.
 *            A donor's page, built like a kid's: what to thank them for, giving, the team's notes and gifts; beside
 *            them stage, owner, Zeffy, Keep anonymous, organizations and History.
 * Checks     every check deposited in Mercury and its Zeffy record (./checks.js)
 */
import { h, htm, useState, useEffect, useRef, useMemo } from './vendor.js';
import { Checks } from './checks.js';
import { useStyles as useJobCostsStyles } from './job-costs.js';
import { zeffyPaymentUrl, zeffyContactUrl } from './zeffy-links.js';
import { AreaTabs, setChecksWaiting } from './donor-tabs.js';
import { ask as askAnywhere } from './ask.js';
// A question about this page closes when the page is left (Back, a link): it never acts on a page no longer shown
const ask = (o) => askAnywhere({ ...o, closeOnMove: true });
import { useDialog } from './dialog.js';

const html = htm.bind(h);
const API = '/api/donors-admin';
const PAGE = 100;

const STYLE = `
.dn { display: grid; gap: 1rem; min-width: 0; }
/* Each one-column stack is as wide as its box, never as wide as its widest content asks (the filter pills' row
   asks for its whole length before it scrolls): what's too long wraps or scrolls inside, the page never widens */
:is(.dn, .dn-years, .dn-gifts, .dn-facts, .dn-needs, .dn-need, .dn-plain, .dn-thank__list, .dn-thank__one, .dn-notes, .dn-note-new) { grid-template-columns: minmax(0, 1fr); }
.dn-status { margin: 0; font-size: var(--fs-xs); color: var(--color-text-muted); }
.dn-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: .6rem .75rem; }
.dn-toolbar .search-bar { flex: 1 1 16rem; min-width: 0; }
.dn-sort { display: flex; align-items: center; gap: .4rem; font-size: var(--fs-sm); color: var(--color-text-secondary); }
.dn-sort .form-select { width: auto; min-height: 36px; }
.dn-list { padding: 0; overflow: hidden; }
.dn-table { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
.dn-table th { padding: .55rem .9rem; border-bottom: 1px solid var(--color-border); text-align: left; font-size: var(--fs-xs); font-weight: 600; color: var(--color-text-muted); white-space: nowrap; }
.dn-table td { padding: .6rem .9rem; border-bottom: 1px solid var(--color-border); vertical-align: middle; }
.dn-table tr:last-child td { border-bottom: none; }
.dn-table .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.dn-row { cursor: pointer; }
.dn-row:hover td { background: var(--color-bg-hover); }
.dn-name { display: block; padding: 0; border: none; background: none; font: inherit; font-weight: 600; color: var(--color-text); text-align: left; cursor: pointer; overflow-wrap: anywhere; }
.dn-name:focus-visible { outline: none; box-shadow: var(--focus-ring-strong); border-radius: 4px; }
.dn-sub { display: block; margin-top: .1rem; font-size: var(--fs-xs); color: var(--color-text-muted); overflow-wrap: anywhere; }
.dn-more { display: flex; justify-content: center; padding: .75rem; border-top: 1px solid var(--color-border); }
.dn-empty { padding: 1.25rem; color: var(--color-text-secondary); }
.dn-tags { display: inline-flex; flex-wrap: wrap; gap: .3rem; vertical-align: middle; }
.dn-stage--new { background: var(--tone-success-bg, #E8F6EC); color: var(--tone-success-fg, #1F6B3A); }
.dn-stage--lapsed { background: var(--tone-warn-bg); color: var(--tone-warn-fg); }
.dn-head { margin-bottom: .25rem; }
.dn-head h2 { display: flex; flex-wrap: wrap; align-items: center; gap: .3rem .6rem; margin: 0; overflow-wrap: anywhere; }
.dn-head h2 .tag { font-size: var(--fs-xs); }
.dn-head__sub { margin: .25rem 0 0; color: var(--color-text-secondary); font-size: var(--fs-sm); overflow-wrap: anywhere; }
.dn-back { display: inline-flex; align-items: center; gap: .35rem; margin-bottom: .5rem; padding: .25rem 0; border: none; background: none; font: inherit; font-size: var(--fs-sm); color: var(--color-text-secondary); cursor: pointer; }
.dn-back:hover { color: var(--color-text); }
.dn-tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .6rem; }
.dn-tile { padding: .75rem .85rem; border: 1px solid var(--color-border); border-radius: 12px; background: var(--color-bg-card); }
.dn-tile__label { display: block; font-size: var(--fs-xs); color: var(--color-text-muted); }
.dn-tile__value { display: block; margin-top: .15rem; font-size: var(--fs-lg, 1.125rem); font-weight: 700; font-variant-numeric: tabular-nums; }
.dn-tile__sub { display: block; margin-top: .1rem; font-size: var(--fs-xs); color: var(--color-text-secondary); }
.dn-years { display: grid; gap: .35rem; margin: 1rem 0 0; padding: 0; list-style: none; }
.dn-years li { display: grid; grid-template-columns: 3rem minmax(0, 1fr) auto; align-items: center; gap: .6rem; font-size: var(--fs-xs); font-variant-numeric: tabular-nums; }
.dn-bar { height: 8px; border-radius: 4px; background: var(--color-bg-secondary); overflow: hidden; }
.dn-bar > span { display: block; height: 100%; border-radius: 4px; background: var(--color-text); }
.dn-gifts { display: grid; margin: 0; padding: 0; list-style: none; }
.dn-gift { display: grid; grid-template-columns: 6.5rem minmax(0, 1fr) auto; gap: .2rem .9rem; align-items: start; padding: .75rem 0; border-bottom: 1px solid var(--color-border); }
.dn-gift:last-child { border-bottom: none; }
.dn-gift.is-flash { background: var(--tone-warn-surface, #FFF9DB); border-radius: 8px; }
.dn-gift__day { font-size: var(--fs-xs); color: var(--color-text-muted); padding-top: .15rem; }
.dn-gift__what { min-width: 0; display: grid; gap: .15rem; }
.dn-gift__what strong { overflow-wrap: anywhere; }
.dn-gift__meta { font-size: var(--fs-xs); color: var(--color-text-secondary); overflow-wrap: anywhere; }
.dn-gift__amt { font-weight: 700; font-variant-numeric: tabular-nums; text-align: right; }
.dn-gift__links { grid-column: 2 / -1; display: flex; flex-wrap: wrap; gap: .25rem .9rem; font-size: var(--fs-xs); }
.dn-facts { display: grid; gap: .5rem; margin: 0; }
.dn-facts dt { font-size: var(--fs-xs); color: var(--color-text-muted); }
.dn-facts dd { margin: 0; font-size: var(--fs-sm); overflow-wrap: anywhere; }
@media (max-width: 720px) {
  .dn-table .dn-hide-sm { display: none; }
  .dn-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dn-gift { grid-template-columns: minmax(0, 1fr) auto; }
  .dn-gift__day { grid-column: 1 / -1; }
  .dn-gift__links { grid-column: 1 / -1; }
}
@media (pointer: coarse) { .dn-name, .dn-back, .dn-gift__links a { min-height: 44px; display: inline-flex; align-items: center; } }

.dn-tag--site { background: var(--color-bg-secondary); color: var(--color-text); }
.dn-needs-pill[aria-pressed="false"] { border-color: var(--tone-warn-border, #E9C46A); }
.dn-needs { display: grid; gap: .75rem; margin: 0; padding: 0; list-style: none; }
.dn-need { display: grid; gap: .45rem; padding: 1rem 1.1rem; }
.dn-need__q { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
.dn-need__sub { margin: 0; font-size: var(--fs-sm); color: var(--color-text-secondary); overflow-wrap: anywhere; }
.dn-need__do { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem .75rem; margin-top: .25rem; }
.dn-need__q, .dn-need__sub, .dn-need__do a { overflow-wrap: anywhere; min-width: 0; }
.dn-need__do .btn { display: inline-flex; align-items: center; gap: .35rem; }
.dn-same { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .6rem; }
.dn-same__one { display: grid; gap: .15rem; padding: .6rem .75rem; border: 1px solid var(--color-border); border-radius: 10px; min-width: 0; overflow-wrap: anywhere; }
.dn-done { padding: 1rem 0; }
.dn-picker { width: min(32rem, 100%); }
.dn-picker .form-input { width: 100%; margin-bottom: .6rem; }
.dn-picker__list { display: grid; gap: .25rem; max-height: 50vh; overflow: auto; margin: 0 0 1rem; padding: 0; list-style: none; }
.dn-picker__item { display: grid; gap: .1rem; width: 100%; padding: .55rem .7rem; border: 1px solid var(--color-border); border-radius: 10px; background: var(--color-bg-card); font: inherit; text-align: left; color: var(--color-text); cursor: pointer; }
.dn-picker__item:hover:not(:disabled) { border-color: var(--color-border-strong); background: var(--color-bg-hover); }
.dn-picker__item:disabled { opacity: .55; cursor: default; }
.dn-picker__none { padding: .5rem .2rem; }
/* After Stage and the card under it (and, on a phone, after the giving and gifts) */
.dn-card--late { order: 3; }
/* A heading that takes the focus only so a screen reader says whose page this is */
.dn-head h2:focus, .dn-head h2[tabindex]:focus-visible, .dn .page-header h2[tabindex]:focus { outline: none; box-shadow: none; }
.dn-check { display: inline-flex; align-items: center; gap: .5rem; min-height: 36px; font-size: var(--fs-sm); font-weight: 600; cursor: pointer; }
.dn-check input { width: 18px; height: 18px; margin: 0; }
.dn-plain { display: grid; gap: .6rem; margin: 0; padding: 0; list-style: none; font-size: var(--fs-sm); }
.dn-plain li { display: grid; gap: .15rem; min-width: 0; overflow-wrap: anywhere; }
.dn-row-do { display: flex; flex-wrap: wrap; align-items: center; gap: .35rem .75rem; margin-top: .15rem; }
.dn-linkbtn { padding: 0; border: none; background: none; font: inherit; font-size: inherit; cursor: pointer; justify-self: start; text-align: left; }
.dn-suggest { margin-top: .75rem; padding: .7rem .8rem; border-radius: 10px; background: var(--tone-warn-surface, #FFF9DB); font-size: var(--fs-sm); }
.dn-suggest p { margin: 0 0 .4rem; }
.dn-maybe { padding: .6rem .75rem; border-radius: 10px; background: var(--tone-warn-surface, #FFF9DB); }
.dn-rename .form-input { width: 100%; margin-bottom: 1rem; }
/* Search, Owner and Sort on one line; the filters on their own below */
.dn-toolbar .ppl-filters { flex-basis: 100%; }
.dn-card--owner { order: 1; }
/* A person's Zeffy details after what to thank them for and their giving, on a phone */
.kd-card.dn-card--zeffy { order: 3; }
.dn-card--owner .form-select { width: 100%; }
.dn-tag--thank { background: var(--tone-warn-bg); color: var(--tone-warn-fg); }
.dn-thank { border-color: var(--tone-warn-border, #E9C46A); }
.dn-thank__list { display: grid; margin: 0; padding: 0; list-style: none; }
.dn-thank__one { display: grid; gap: .2rem; padding: .7rem 0; border-top: 1px solid var(--color-border); font-size: var(--fs-sm); overflow-wrap: anywhere; }
.dn-thank__one:first-child { border-top: none; padding-top: 0; }
.dn-note-new { display: grid; gap: .5rem; }
.dn-note-new textarea, .dn-note textarea { width: 100%; min-height: 4.5rem; resize: vertical; font: inherit; }
.dn-note-new__do { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .5rem .75rem; }
.dn-notes { display: grid; margin: .75rem 0 0; padding: 0; list-style: none; }
.dn-note { display: grid; gap: .3rem; padding: .75rem 0; border-top: 1px solid var(--color-border); min-width: 0; }
.dn-note__body { margin: 0; font-size: var(--fs-sm); line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
.dn-note__meta { display: flex; flex-wrap: wrap; align-items: center; gap: .2rem .75rem; font-size: var(--fs-xs); color: var(--color-text-muted); }
.dn-history__row { cursor: default; }
.dn-history__row:hover { background: none; }
.dn-history__what { font-size: var(--fs-xs); color: var(--color-text-secondary); overflow-wrap: anywhere; }
@media (max-width: 720px) { .dn-same { grid-template-columns: minmax(0, 1fr); } }
/* Room under a list on a phone, so the item after one answered can sit above the message at the foot of the screen */
@media (max-width: 720px) { .dn-needs { padding-bottom: 7rem; } }
@media (pointer: coarse) { .dn-linkbtn, .dn-plain a, .dn-need__do a { min-height: 44px; display: inline-flex; align-items: center; } }
`;

let styled = false;
function useStyles() {
  if (styled) return;
  styled = true;
  const el = document.createElement('style');
  el.dataset.module = 'donors';
  el.textContent = STYLE;
  document.head.append(el);
}

// Whole dollars as whole dollars ($10,000), anything else to the cent ($10.10)
const usd = (cents) => { const c = Math.round(Number(cents) || 0); return `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`; };
const day = (s) => (s ? new Date(s * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const ago = (iso) => {
  if (!iso) return null;
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} minute${m === 1 ? '' : 's'} ago` : m < 1440 ? `${Math.round(m / 60)} hour${Math.round(m / 60) === 1 ? '' : 's'} ago` : `${Math.round(m / 1440)} day${Math.round(m / 1440) === 1 ? '' : 's'} ago`;
};
const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;
const STAGES = {
  new: { label: 'New', tone: 'dn-stage--new', what: 'Their first gift was within the last 12 months.' },
  active: { label: 'Active', tone: '', what: 'They first gave more than a year ago, and have given within the last 18 months.' },
  lapsed: { label: 'Lapsed', tone: 'dn-stage--lapsed', what: 'No gift in the last 18 months.' },
  inkind: { label: 'In kind only', tone: '', what: 'Only gifts in kind so far.' },
  none: { label: 'No gifts of their own', tone: '', what: 'Only tickets, purchases, gifts refunded in full, or gifts that count for an organization.' },
};
const stageTag = (s) => html`<span class=${`tag ${STAGES[s]?.tone || ''}`}>${STAGES[s]?.label || s}</span>`;
/** A teammate by their address: their name from Google, else the start of the address ("alex@…" → Alex) */
const fullName = (email, staff = []) => {
  if (!email) return '';
  const s = staff.find((x) => x.email === email);
  if (s) return s.name;
  if (!String(email).includes('@')) return String(email);
  const f = String(email).split('@')[0].split(/[._+-]/)[0];
  return f ? f[0].toUpperCase() + f.slice(1) : String(email);
};
const firstName = (email, staff = []) => fullName(email, staff).split(' ')[0];
/** When something was said: "just now", "today, 2:10 PM", "Oct 23, 2:10 PM" (the year when it isn't this one) */
const when = (iso) => {
  const t = Date.parse(iso);
  if (!t) return '';
  const d = new Date(t);
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const start = new Date(); start.setHours(0, 0, 0, 0);
  if (t >= start.getTime()) return `today, ${time}`;
  if (t >= start.getTime() - 864e5) return `yesterday, ${time}`;
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) })}, ${time}`;
};
const shortDay = (iso) => { const t = Date.parse(iso); return t ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(new Date(t).getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) }) : ''; };
// (a gift in kind Zeffy has no value for is said so, never "$0")
const amountOf = (g) => (g.inKind ? `${usd(g.inKind)} in kind` : !Number(g.cents) && (g.why === 'kind' || g.thanks?.why === 'kind') ? 'a gift in kind' : usd(g.cents));
/** Who looks after a donor, as the Owner filter has it: '' anyone, 'none' no one, else their address */
const ownerOk = (filter, owner) => !filter || (filter === 'none' ? !owner : owner === filter);
/** Where an organization is: its level on the Partners page, or only here */
const orgTag = (o) => html`<span class=${`tag ${o.onSite ? 'dn-tag--site' : ''}`}>${o.onSite ? `${o.levelLabel || 'Friend'} partner` : 'Not on the website'}</span>`;

async function call(params = '', body = null) {
  try {
    const r = await fetch(`${API}${params}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) } : { headers: { Accept: 'application/json' } });
    const j = await r.json().catch(() => null);
    return j ? (j.success ? j : { ...j, status: r.status }) : { success: false, error: 'The site didn’t answer.', status: r.status };
  } catch {
    return { success: false, error: 'The site didn’t answer.' };
  }
}
const get = (params) => call(params);
/**
 * A change. Refused, or its answer lost on the way back (it may have saved all the same): every view of Donors &
 * Partners open reads again (the list, Needs you, To thank, the page, the sidebar), so none shows what was before
 */
// Every change, sent twice, is made once and answers as it is (done already, or refused): an answer lost on the way
// back is asked once more, so the page says what really happened
const lostAnswer = (r) => !r.success && (!r.status || r.status >= 500);
const change = async (body) => {
  let r = await call('', body);
  if (lostAnswer(r)) r = { ...(await call('', body)), retried: true };
  if (!r.success) {
    listChanged();
    thanksChanged();
    if (lostAnswer(r)) r = { ...r, error: 'The site didn’t answer. The page reads again, so what shows is what’s saved.' };
  }
  return r;
};

function placeOf(hash = location.hash) {
  const raw = String(hash).replace(/^#/, '');
  // The old Job Costs address of Checks
  if (/^job-costs\/checks\b/.test(raw)) return { tab: 'checks' };
  const parts = raw.split('?')[0].split('/').slice(1).filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch { return x; } });
  if (!parts[0]) return { tab: 'people' };
  if (parts[0] === 'checks') return { tab: 'checks' };
  if (parts[0] === 'needs') return { tab: 'people', needs: true };
  if (parts[0] === 'thanks') return { tab: 'people', thanks: true };
  if (parts[0] === 'gift') return parts[1] ? { tab: 'people', gift: parts[1] } : { tab: 'people' };
  if (parts[0] === 'org') return parts[1] ? { tab: 'people', org: parts[1] } : { tab: 'people' };
  return { tab: 'people', donor: parts[0] };
}
// (a gift's link that settled on its donor is at the donor's address: the gift only marks which one to show)
const addressOf = (place) => (place.tab === 'checks' ? '#donors/checks' : place.needs ? '#donors/needs' : place.thanks ? '#donors/thanks' : place.org ? `#donors/org/${encodeURIComponent(place.org)}`
  : place.donor ? `#donors/${encodeURIComponent(place.donor)}` : place.gift ? `#donors/gift/${encodeURIComponent(place.gift)}` : '#donors');
function go(place) {
  const next = addressOf(place);
  if (location.hash !== next) history.pushState(null, '', next);
}
/** A donor in the list → their place */
/** From a toast, which can be pressed after leaving: by address, which the admin follows from anywhere */
const goTo = (place) => { location.hash = addressOf(place); };
const placeOfDonor = (d, extra = {}) => (d.type === 'org' ? { tab: 'people', org: d.ref, ...extra } : d.ref.startsWith('g:') ? { tab: 'people', gift: d.ref.slice(2), fromList: true, ...extra } : { tab: 'people', donor: d.ref, ...extra });

// Each move to a place (a link, Back, Forward, a click) is a new page there: nothing of the page before carries over
let moves = 0;
export function Donors({ addToast = () => {}, partners = [], partnersCount = null, communityCount = null, createPartner = null, onPartnersChanged = () => {} }) {
  useJobCostsStyles();
  useStyles();
  const [place, setPlace] = useState(() => ({ ...placeOf(), n: ++moves }));
  useEffect(() => {
    // An old Job Costs link to Checks settles on this area's own address, opened fresh or followed from here
    const settle = () => { if (/^#job-costs\/checks\b/.test(location.hash)) history.replaceState(null, '', '#donors/checks'); };
    settle();
    const on = () => {
      settle();
      // Anywhere but the page To thank or Needs you opened: Back is to the list again
      if (backFor && location.hash !== backFor) { backTo = null; backFor = null; }
      if (/^#(donors|job-costs\/checks)\b/.test(location.hash)) { const next = placeOf(); setPlace((p) => (addressOf(p) === addressOf(next) ? p : { ...next, n: ++moves })); }
    };
    window.addEventListener('popstate', on);
    window.addEventListener('hashchange', on);
    // An address changed between the first draw and now (a link followed at once) isn't missed
    on();
    return () => { window.removeEventListener('popstate', on); window.removeEventListener('hashchange', on); backTo = null; backFor = null; };
  }, []);
  const open = (p) => { go(p); setPlace({ ...p, n: ++moves }); window.scrollTo({ top: 0, behavior: 'instant' }); };
  // A move that took away what had the focus (Take it out, then the list): the page's heading has it
  useEffect(() => { const t = setTimeout(() => { if (!document.activeElement || document.activeElement === document.body) { const h = document.querySelector('.dn h2'); if (h) { if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); } } }, 400); return () => clearTimeout(t); }, [place.n]);
  // Back from a donor's page: where it was opened from (To thank, Needs you), else the list
  const backLabel = backTo === 'thanks' ? 'To thank' : backTo === 'needs' ? 'Needs you' : 'Donors';
  const goBack = () => { const to = backTo; backTo = null; backFor = null; focusPill = !!to; open({ tab: 'people', thanks: to === 'thanks', needs: to === 'needs' }); };
  // What's done here is in effect at once (private D1, Zeffy, Mercury), so no message offers Publish unless it says it
  // waits for it ({ publish: true }: a partner's level, a partner card made)
  const toast = (msg, type, action = null, o = {}) => addToast(msg, type, action, { publish: false, ...o });
  const ctx = { addToast: toast, open, partners, createPartner, partnersChanged: onPartnersChanged };
  const pick = (id) => {
    if (id === 'partners') location.hash = '#partners';
    else if (id === 'community') location.hash = '#partners/community-partners';
    else open({ tab: id === 'checks' ? 'checks' : 'people' });
  };
  if (place.org) return html`<div class="dn"><${OrgPage} key=${`${place.n}:${place.org}`} orgKey=${place.org} gift=${place.gift || null} ctx=${ctx} onBack=${goBack} backLabel=${backLabel} /></div>`;
  if (place.donor || place.gift) {
    // A gift's link settling on its donor's own address is the same page (n stays): it isn't read twice
    return html`<div class="dn"><${DonorPage} key=${place.n} donor=${place.donor} gift=${place.gift} fromList=${!!place.fromList} ctx=${ctx} onBack=${goBack} backLabel=${backLabel}
      onDonor=${(ref) => { if (location.hash !== addressOf(place)) return; history.replaceState(null, '', `#donors/${encodeURIComponent(ref)}`); setPlace({ tab: 'people', donor: ref, gift: place.gift, fromList: place.fromList, n: place.n }); }}
      onOrg=${(key) => { if (location.hash !== addressOf(place)) return; history.replaceState(null, '', `#donors/org/${encodeURIComponent(key)}`); setPlace({ tab: 'people', org: key, gift: place.gift, n: place.n }); }} /></div>`;
  }
  return html`<div class="dn">
    <${AreaTabs} current=${place.tab === 'checks' ? 'checks' : 'donors'} partners=${partnersCount} community=${communityCount} onPick=${pick} />
    ${place.tab === 'checks' ? html`<div class="page-header"><div><h2>Checks into Zeffy</h2>
        <p class="page-sub">Every check deposited in Mercury, on its way into Zeffy: the site reads each one and fills in its card, and a person sends it.</p></div></div>
      <div class="jc"><${Checks} addToast=${toast} onCount=${setChecksWaiting} /></div>`
      : html`<${DonorList} ctx=${ctx} view=${place.needs ? 'needs' : place.thanks ? 'thanks' : null} onView=${(w) => open({ tab: 'people', needs: w === 'needs', thanks: w === 'thanks' })} onOpen=${(d) => open(placeOfDonor(d))} />`}
  </div>`;
}

// ─── Donors ─────────────────────────────────────────────────────────

const SORTS = [
  ['latest', 'Latest gift', (a, b) => (b.latest?.at || 0) - (a.latest?.at || 0)],
  ['total', 'Most given', (a, b) => b.total - a.total],
  ['year', 'Most this year', (a, b) => b.thisYear - a.thisYear || b.total - a.total],
  ['last', 'Most last year', (a, b) => b.lastYear - a.lastYear || b.total - a.total],
  ['name', 'Name', (a, b) => a.name.localeCompare(b.name)],
];
let lastList = null; // the list as last read, so coming back from a donor shows it at once
// Where the list was (search, filter, sort, how many shown, scroll, the donor opened), so Back returns there
let lastPlace = null;
// The Owner filter, kept while the admin is open (a donor's page and back, To thank and back)
let lastOwner = '';
// Where a donor's page was opened from, when not the list ('thanks' | 'needs'): its Back goes there. Kept with the
// address that list opened, so any other way to a page (a Slack link, after leaving the area) is the list's
let backTo = null;
let backFor = null;
const cameFrom = (view) => (e) => { backTo = view; backFor = e.currentTarget.getAttribute('href'); };
// Back there: the focus on its pill (the donor's row has it when Back is to the list)
let focusPill = false;
/** Read the list again when it next shows (a change on a donor's page moves gifts between donors) */
const listChanged = () => { if (lastList) lastList = { ...lastList, stale: true }; };
// A thank-you was said (or undone): the sidebar's count, the list, To thank and a donor's page all read again. With a
// value, only the count just read (the sidebar takes it; nothing else needs to read)
const thanksChanged = (value) => window.dispatchEvent(new CustomEvent('soard-thanks-changed', value === undefined ? undefined : { detail: { value } }));
/** Read again when a thank-you is said anywhere (a toast's Undo after leaving the page that said it) */
function useThanksSaid(reload) {
  const fn = useRef(reload);
  fn.current = reload;
  useEffect(() => {
    const on = (e) => { if (!(e.detail && 'value' in e.detail)) fn.current(); };
    window.addEventListener('soard-thanks-changed', on);
    window.addEventListener('soard-thanks-moved', on);
    return () => { window.removeEventListener('soard-thanks-changed', on); window.removeEventListener('soard-thanks-moved', on); };
  }, []);
}
/** A read whose answer still counts: one started later wins, whatever order they come back in */
function useLatest() {
  const n = useRef(0);
  // (left: the list is gone, another view opened meanwhile; its slow read never lands on the counts or the sidebar)
  useEffect(() => () => { n.current = -1; }, []);
  return () => { if (n.current < 0) return () => false; const mine = ++n.current; return () => mine === n.current; };
}
/** The pressed pill in sight in its row (a phone scrolls the row sideways; the page never moves) */
function usePressedInView(deps) {
  useEffect(() => {
    const pill = document.querySelector('.dn .ppl-filters [aria-pressed="true"]');
    const row = pill?.parentElement;
    if (!row || row.scrollWidth <= row.clientWidth) return;
    const left = pill.offsetLeft - row.offsetLeft;
    if (left < row.scrollLeft || left + pill.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollLeft = Math.max(0, left - (row.clientWidth - pill.offsetWidth) / 2);
  }, deps);
}

function DonorList({ ctx, view, onView, onOpen }) {
  const [v, setV] = useState(lastList);
  const [err, setErr] = useState(null);
  const back = useRef(lastPlace);
  const [q, setQ] = useState(back.current?.q || '');
  const [stage, setStage] = useState(back.current?.stage || 'all');
  const [sort, setSort] = useState(back.current?.sort || 'latest');
  const [owner, setOwner] = useState(lastOwner);
  const [shown, setShown] = useState(back.current?.shown || PAGE);
  const search = useRef(null);
  // Back from a donor: the same rows, scrolled where they were, the focus on the donor just opened
  useEffect(() => {
    const b = back.current;
    if (!b || !v || view) return;
    back.current = null;
    lastPlace = null;
    requestAnimationFrame(() => {
      window.scrollTo({ top: b.scroll, behavior: 'instant' });
      document.querySelector(`.dn-row[data-key="${CSS.escape(b.key)}"] .dn-name`)?.focus({ preventScroll: true });
    });
  }, [!!v]);
  const openDonor = (p) => { lastPlace = { q, stage, sort, owner, shown, scroll: window.scrollY, key: p.key }; backTo = null; backFor = null; onOpen(p); };
  const latest = useLatest();
  // Left (a donor opened): a read still out lands nowhere, and its count never reaches the sidebar
  const gone = useRef(false);
  useEffect(() => () => { gone.current = true; }, []);
  const load = async () => {
    const current = latest();
    const j = await get('');
    if (!current() || gone.current) return;
    if (!j.success) { setErr(j.error); return; }
    setErr(null);
    lastList = j;
    setV(j);
    thanksChanged(j.thanks || 0);
  };
  // Shown at once from the last read, then read again (a change on a donor's page can move gifts)
  useEffect(() => { load(); }, []);
  useThanksSaid(load);
  usePressedInView([view, stage, !!v]);
  useEffect(() => { if (v && focusPill) { focusPill = false; document.querySelector('.dn .ppl-filters [aria-pressed="true"]')?.focus({ preventScroll: true }); } }, [!!v]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('input, textarea, select, [contenteditable="true"]') || document.querySelector('.modal-overlay, .ask-overlay')) return;
      e.preventDefault();
      // The search box is there in every view: typing in it goes back to the list
      search.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [view]);
  const firstRender = useRef(true);
  useEffect(() => { if (firstRender.current) { firstRender.current = false; return; } setShown(PAGE); }, [q, stage, sort, owner]);
  const people = v?.people || [];
  const staff = v?.staff || [];
  const me = v?.me && staff.some((s) => s.email === v.me) ? v.me : null;
  // The Owner filter on someone the list no longer offers (left the team, and looks after no one now): Anyone again
  useEffect(() => { if (v && owner && owner !== 'none' && owner !== me && !staff.some((s) => s.email === owner)) { setOwner(''); lastOwner = ''; } }, [v, owner]);
  // As people type it: accents and "&" or "and" either way (Marí finds María, "lark and wren" Lark & Wren)
  const fold = (x) => String(x || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s*&\s*/g, ' and ').replace(/\s+/g, ' ').trim();
  const words = fold(q);
  const inStage = (p, s) => (s === 'all' ? true : s === 'org' ? p.type === 'org' : s === 'yearend' ? p.lastYear > 0 && !p.thisYear : p.stage === s);
  const has = (x) => fold(x).includes(words);
  // An organization is found by who gave for it too (a person whose every gift counts for it has no row of their own)
  const giverOf = (p) => (words && p.type === 'org' && ![p.name, ...(p.companies || []), ...(p.funds || [])].some(has) ? (p.givers || []).find((g) => [g.name, ...(g.emails || [])].some(has)) : null);
  const matches = useMemo(() => people.filter((p) => inStage(p, stage) && ownerOk(owner, p.owner)
    && (!words || [p.name, p.email, ...(p.companies || []), ...(p.funds || [])].some(has) || !!giverOf(p)))
    .sort(SORTS.find(([k]) => k === sort)[2]), [people, words, stage, sort, owner]);
  const count = (s) => people.filter((p) => inStage(p, s) && ownerOk(owner, p.owner)).length;
  // Gifts to thank, under the Owner filter like every other count (and like the To thank list)
  const thanksShown = Array.isArray(v?.thanksOwners) ? v.thanksOwners.filter((o) => ownerOk(owner, o || null)).length : v?.thanks || 0;
  if (err && !v) return html`<div class="notice notice--danger"><div class="notice__body"><strong>Couldn’t load donors:</strong> ${err}</div>
    <div class="notice__actions"><button class="btn btn-ghost" onClick=${load}>Try again</button></div></div>`;
  // Read before and couldn't be read again: what shows is the last read, and it says so
  const stale = err && v ? html`<div class="notice notice--warn" role="status"><div class="notice__body"><strong>Couldn’t read the list again:</strong> ${err} It shows what was read before.</div>
    <div class="notice__actions"><button class="btn btn-ghost" onClick=${load}>Try again</button></div></div>` : null;
  if (!v) return html`<div style="text-align:center;padding:2rem"><span class="spinner" /></div>`;
  const fresh = ago(v.windowAt);
  const year = new Date().getFullYear();
  const filters = [['all', 'Everyone'], ['org', 'Organizations'], ['new', 'New'], ['active', 'Active'], ['lapsed', 'Lapsed'], ['yearend', 'Not yet this year']];
  // The year-end list reads best by last year's giving; leaving it, the list goes back to the latest gift
  const pickStage = (k) => {
    if (k === 'yearend' && sort === 'latest') setSort('last');
    if (k !== 'yearend' && stage === 'yearend' && sort === 'last') setSort('latest');
    setStage(k);
    if (view) onView(null);
  };
  const pickOwner = (o) => { setOwner(o); lastOwner = o; };
  // To thank or Needs you just read: the counts above them say what they show (a teammate's answers since included)
  const counts = (c) => { setV((x) => (x ? { ...x, ...c } : x)); if (lastList) lastList = { ...lastList, ...c }; if ('thanks' in c) thanksChanged(c.thanks); };
  const yearEnd = stage === 'yearend';
  // A count from before a change made since (Back to the list after a thank-you): being read again, never shown as now
  const n = (x, tone = '') => (v.stale && !err ? html`<span class=${`count ${tone}`} aria-label="being read again">…</span>` : html`<span class=${`count ${tone}`}>${x.toLocaleString()}</span>`);
  const ownerName = owner === 'none' ? 'no one' : owner === me ? 'you' : fullName(owner, staff);
  return html`
    <div class="page-header">
      <div>
        <h2>Donors</h2>
        <p class="page-sub">Everyone who gives to SOARD, people and organizations, from Zeffy. Gifts are taken and changed in Zeffy: each one here opens there. Which organization a name belongs to, who looks after them, notes and thank-yous are kept here, for the team only.</p>
      </div>
    </div>
    ${v.error || (v.windowError && (!v.windowAt || Date.now() - Date.parse(v.windowAt) > 30 * 60e3)) ? html`<div class="notice notice--warn" role="status"><div class="notice__body"><strong>The site couldn’t finish reading Zeffy${v.windowAt ? ` since ${ago(v.windowAt)}` : ''}.</strong> ${v.error || v.windowError}. It tries again on its own every 15 minutes; the list shows what it read last.</div></div>` : null}
    ${stale}
    ${v.held ? html`<div class="notice notice--warn" role="status"><div class="notice__body"><strong>Zeffy’s list came back much shorter than the one here.</strong> Nothing was taken out. If the next read agrees, the gifts Zeffy no longer has come off; if it was a glitch, nothing changes. Nothing to do.</div></div>` : null}
    ${!v.filledAt ? html`<div class="notice" role="status"><div class="notice__body"><strong>Reading all of Zeffy’s history.</strong> ${v.payments ? `${v.payments.toLocaleString()} gifts so far. ` : ''}Totals and first gifts fill in over the next hour or so; nothing to do.</div></div>` : null}
    <div class="dn-toolbar">
      <div class="search-bar">
        <span class="search-icon" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></span>
        <input type="search" ref=${search} placeholder="Name, email or company" aria-label="Search donors" aria-keyshortcuts="/" value=${q} onInput=${(e) => { setQ(e.target.value); if (view) onView(null); }} />
        ${!q ? html`<kbd class="kd-kbd" aria-hidden="true">/</kbd>` : null}
      </div>
      ${html`<label class="dn-sort dn-owner-filter">Owner <select class="form-select" value=${owner} onChange=${(e) => pickOwner(e.target.value)}>
        <option value="">Anyone</option>
        ${me ? html`<option value=${me}>Me</option>` : null}
        <option value="none">No one</option>
        ${staff.filter((s) => s.email !== me).map((s) => html`<option key=${s.email} value=${s.email}>${s.name}${s.left ? ' (left the team)' : ''}</option>`)}
      </select></label>`}
      ${view ? null : html`<label class="dn-sort dn-sort-by">Sort <select class="form-select" value=${sort} onChange=${(e) => setSort(e.target.value)}>${SORTS.map(([k, label]) => html`<option key=${k} value=${k}>${label}</option>`)}</select></label>`}
      <div class="ppl-filters" role="group" aria-label="Show">
        ${filters.map(([k, label]) => html`
          <button type="button" key=${k} class="pill ppl-filter" aria-pressed=${!view && stage === k} onClick=${() => pickStage(k)}>${label} ${n(count(k))}</button>`)}
        ${v.thanks || view === 'thanks' ? html`<button type="button" class="pill ppl-filter dn-needs-pill" aria-pressed=${view === 'thanks'} onClick=${() => onView(view === 'thanks' ? null : 'thanks')}>To thank ${n(thanksShown, 'is-warn')}</button>` : null}
        ${v.needs || view === 'needs' ? html`<button type="button" class="pill ppl-filter dn-needs-pill" aria-pressed=${view === 'needs'} onClick=${() => onView(view === 'needs' ? null : 'needs')}>Needs you ${n(v.needs || 0, 'is-warn')}</button>` : null}
      </div>
    </div>
    ${view === 'needs' ? html`<${NeedsList} ctx=${ctx} onChanged=${load} onCount=${(n) => counts({ needs: n })} />`
    : view === 'thanks' ? html`<${ThanksList} ctx=${ctx} owner=${owner} ownerName=${ownerName} onCount=${(items) => counts({ thanks: items.length, thanksOwners: items.map((t) => t.owner || '') })} />` : html`
    <p class="dn-status">${stage === 'org' ? 'Partners and the other organizations that give, with their gifts from every name they give under.' : yearEnd ? `The year-end list: gave in ${year - 1}, nothing yet in ${year}.` : STAGES[stage]?.what || 'Everyone who has given.'}${owner ? ` Looked after by ${ownerName}.` : ''} From Zeffy${fresh ? `, read ${fresh}` : ''}.</p>
    <div class="card dn-list">
      ${matches.length ? html`<table class="dn-table">
        <caption class="sr-only">Donors${stage === 'org' ? ', organizations' : yearEnd ? ', not yet this year' : stage !== 'all' ? `, ${STAGES[stage].label}` : ''}${owner ? `, looked after by ${ownerName}` : ''}${words ? `, matching “${q.trim()}”` : ''}</caption>
        <thead><tr><th scope="col">Donor</th><th scope="col">Stage</th><th scope="col" class="num dn-hide-sm">${yearEnd ? 'Last year' : 'This year'}</th><th scope="col" class="num">All time</th><th scope="col" class="num dn-hide-sm">Latest gift</th><th scope="col" class="dn-hide-sm">Owner</th></tr></thead>
        <tbody>${matches.slice(0, shown).map((p) => html`<tr key=${p.key} class="dn-row" data-key=${p.key} onClick=${(e) => { if (!e.target.closest('button')) openDonor(p); }}>
          <td><button type="button" class="dn-name" onClick=${() => openDonor(p)}>${p.name}</button>
            <span class="dn-sub">${p.type === 'org' ? html`${orgTag(p)} ` : null}${[giverOf(p) ? `given by ${giverOf(p).name || giverOf(p).emails[0]}` : null, p.type !== 'org' && p.companies?.length ? `for ${p.companies.join(', ')}` : null, p.funds?.length ? `through ${p.funds.join(', ')}` : null, p.keepAnonymous ? 'kept anonymous' : p.anonymous ? 'asked to be anonymous' : null, `${plural(p.gifts, 'gift')}${p.streak > 1 ? `, ${p.streak} years in a row` : ''}`].filter(Boolean).join(' · ')}</span></td>
          <td>${stageTag(p.stage)}</td>
          <td class="num dn-hide-sm">${(yearEnd ? p.lastYear : p.thisYear) ? usd(yearEnd ? p.lastYear : p.thisYear) : '–'}</td>
          <td class="num">${usd(p.total)}</td>
          <td class="num dn-hide-sm">${day(p.latest?.at)}</td>
          <td class="dn-hide-sm">${p.owner ? firstName(p.owner, staff) : html`<span class="dn-sub">–</span>`}</td>
        </tr>`)}</tbody>
      </table>
      ${matches.length > shown ? html`<div class="dn-more"><button type="button" class="btn btn-ghost btn-sm" onClick=${() => { const at = shown; setShown((n) => n + PAGE); requestAnimationFrame(() => document.querySelectorAll('.dn-table tbody .dn-name')[at]?.focus()); }}>Show ${Math.min(PAGE, matches.length - shown)} more of ${matches.length.toLocaleString()}</button></div>` : null}`
      : html`<p class="dn-empty">${people.length ? `No donors match${words ? ` “${q.trim()}”` : ''}${owner ? `, looked after by ${ownerName}` : ''}.` : 'No gifts read from Zeffy yet. They come in within 15 minutes.'}</p>`}
    </div>`}`;
}

// ─── To thank ───────────────────────────────────────────────────────

/**
 * Thanked, or not needed: said on the gift, with Undo in the toast. Each says what it saw (To thank; Undo, what it
 * said), so another tab's or a teammate's answer since is never overwritten: they're told instead. Whatever happens,
 * every view of it reads again (the list, To thank, a donor's page, the sidebar), wherever the person is by then
 */
async function sayThanks(ctx, g, state) {
  const r = await change({ act: 'thanks', id: g.id, state, was: 'todo' });
  listChanged();
  thanksChanged();
  if (!r.success) { ctx.addToast(r.error, 'error'); return false; }
  // Already so (a second click, or a teammate said the same): nothing changed, so nothing to undo
  if (r.same && !(r.retried && r.you)) { ctx.addToast(`${state === 'thanked' ? 'Thanked' : 'No thank-you needed'} already${r.you ? ', by you' : r.by ? `, said by ${r.by.split('@')[0].replace(/^./, (c) => c.toUpperCase())}` : ''}`, 'info'); return true; }
  const undo = async () => {
    const u = await change({ act: 'thanks', id: g.id, state: 'todo', was: state });
    // Back in its list: the focus on it (pressed from the toast, the focus had nowhere to be), once a read shows it
    const back = u.success ? focusWhenBack(g.id) : null;
    listChanged();
    thanksChanged();
    if (!u.success) { ctx.addToast(u.error, 'error'); return; }
    await back;
  };
  // (Zeffy with no name for them: the gift alone, never "from No name")
  const from = g.name && g.name !== 'No name' ? ` from ${g.name}` : '';
  ctx.addToast(state === 'thanked' ? `Thanked: ${amountOf(g)}${from}` : `No thank-you needed: ${amountOf(g)}${from}`, 'success', { label: 'Undo', fn: undo });
  return true;
}
/** A list of thank-yous (To thank, a donor's page) shows a fresh read: whoever waits for one looks again */
const thanksRead = () => window.dispatchEvent(new Event('soard-thanks-read'));
/**
 * A thank-you said To thank again (Undo): its Thanked button, once a read made after the Undo shows it again (one read
 * before it may still show it as it was, then not at all), and only while the focus is nowhere a person put it
 */
function focusWhenBack(id) {
  return new Promise((done) => {
    let t = null;
    const finish = () => { window.removeEventListener('soard-thanks-read', look); clearTimeout(t); done(); };
    function look() {
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-thank="${CSS.escape(String(id))}"] .btn-primary`);
        if (!el) return;
        const a = document.activeElement;
        if (!a || a === document.body || a.matches('h1, h2, .toast-undo, [tabindex="-1"]')) el.focus();
        finish();
      });
    }
    window.addEventListener('soard-thanks-read', look);
    t = setTimeout(finish, 6000);
  });
}
/** An item under the messages at the foot of the screen (a phone): the page moves so it shows above them */
function clearOfToasts(el) {
  const t = [...document.querySelectorAll('.toast-container .toast')].map((x) => x.getBoundingClientRect()).filter((r) => r.height);
  if (!t.length) return;
  const top = Math.min(...t.map((r) => r.top));
  const r = el.getBoundingClientRect();
  if (r.bottom > top - 8 && r.top < window.innerHeight) window.scrollBy({ top: r.bottom - top + 16 });
}
/** After an item of a list is answered and goes: the focus on the one that took its place, else the list's words */
function useRefocus(selector, ready, otherwise = '.dn-done, .dn-status') {
  const at = useRef(null);
  useEffect(() => {
    // Once the item answered has gone (the list read again), not before
    // (an answer that failed leaves its item: after a while the focus is left where the person put it)
    if (at.current && Date.now() - at.current.t > 10e3) at.current = null;
    if (at.current == null || !ready || at.current.li?.isConnected) return;
    const { i } = at.current;
    at.current = null;
    // The person moved on meanwhile (typing a note, the Owner filter): the focus stays where they put it
    if (document.activeElement && document.activeElement !== document.body) return;
    const items = [...document.querySelectorAll(`${selector} > li`)];
    const next = items[Math.min(i, items.length - 1)]?.querySelector('button:not([disabled]), a[href]');
    const fallback = document.querySelector(otherwise);
    if (next) { next.focus(); requestAnimationFrame(() => clearOfToasts(next.closest('li') || next)); }
    else if (fallback) { fallback.setAttribute('tabindex', '-1'); fallback.focus(); }
  });
  return (el) => { const li = el?.closest?.('li'); at.current = { li, i: li ? [...li.parentElement.children].indexOf(li) : 0, t: Date.now() }; };
}
const waiting = (since) => {
  const d = Math.floor((Date.now() - Date.parse(since)) / 864e5);
  return !Number.isFinite(d) ? '' : d < 1 ? 'Came in today' : `Waiting ${plural(d, 'day')}`;
};

function ThanksList({ ctx, owner = '', ownerName = '', onCount = () => {} }) {
  const [v, setV] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);
  const latest = useLatest();
  const load = async () => {
    const current = latest();
    const j = await get('?thanks=1');
    if (!current()) return;
    if (!j.success) { setErr(j.error); return; }
    setErr(null);
    setV(j);
    onCount(j.items);
    thanksRead();
  };
  useEffect(() => { load(); }, []);
  useThanksSaid(load);
  const refocus = useRefocus('.dn-needs[aria-label="To thank"]', !!v);
  if (err) return html`<div class="notice notice--danger"><div class="notice__body">${err}</div><div class="notice__actions"><button class="btn btn-ghost" onClick=${load}>Try again</button></div></div>`;
  if (!v) return html`<div style="text-align:center;padding:2rem"><span class="spinner" /></div>`;
  const items = v.items.filter((t) => ownerOk(owner, t.owner));
  const doIt = async (t, state, e) => {
    refocus(e.currentTarget);
    setBusy(`${t.id}:${state}`);
    await sayThanks(ctx, t, state);
    await load();
    setBusy(null);
  };
  if (!items.length) return html`<p class="dn-status dn-done">${owner ? `Nothing to thank for donors looked after by ${ownerName}.` : 'Nothing to thank.'} A gift shows here when Zeffy sends the giver no thank-you (a check, a donor-advised fund, a gift in kind, anything entered by hand) or it’s $1,000 or more.</p>`;
  return html`
    <p class="dn-status">Zeffy thanks online givers by email. These it doesn’t, or they’re big enough for a call or a note from the team. The one waiting longest is first${owner ? `; looked after by ${ownerName}` : ''}.</p>
    <ul class="dn-needs" aria-label="To thank">${items.map((t) => html`<li key=${t.id} class="card dn-need" data-thank=${t.id}>
      <p class="dn-need__q">Thank ${t.name === 'No name' ? 'a giver Zeffy has no name for' : t.name}${t.org && t.org.name !== t.name ? ` (for ${t.org.name})` : !t.org && t.company && t.company !== t.name && t.how !== 'Donor-advised fund' ? ` (for ${t.company})` : ''}: ${amountOf(t)}</p>
      <p class="dn-need__sub">${[t.how, t.campaign, day(t.at)].filter(Boolean).join(' · ')}. ${t.whyText}.</p>
      <p class="dn-need__sub">${t.owner ? `Looked after by ${fullName(t.owner, v.staff)}` : 'No one looks after them yet'} · ${waiting(t.since)}</p>
      <div class="dn-need__do">
        <button type="button" class="btn btn-primary btn-sm" aria-disabled=${busy ? 'true' : null} onClick=${(e) => { if (!busy) doIt(t, 'thanked', e); }}>${busy === `${t.id}:thanked` ? html`<span class="spinner spinner-14" />` : null}Thanked</button>
        <button type="button" class="btn btn-ghost btn-sm" aria-disabled=${busy ? 'true' : null} onClick=${(e) => { if (!busy) doIt(t, 'skipped', e); }}>${busy === `${t.id}:skipped` ? html`<span class="spinner spinner-14" />` : null}Not needed</button>
        <a class="link" href=${t.org ? `#donors/org/${encodeURIComponent(t.org.key)}` : t.ref && !t.ref.startsWith('g:') ? `#donors/${encodeURIComponent(t.ref)}` : `#donors/gift/${encodeURIComponent(t.ids?.[0] || t.id)}`} onClick=${cameFrom('thanks')}>${t.org ? `Open ${t.org.name}` : t.name === 'No name' ? 'Open their gift' : `Open ${t.name}`}</a>
        <a class="link" href=${zeffyPaymentUrl(t.ids?.[0] || t.id)} target="_blank" rel="noopener">Open in Zeffy</a>
      </div></li>`)}</ul>
    ${v.more ? html`<p class="dn-status">And ${plural(v.more, 'more gift')} after these.</p>` : null}`;
}

// ─── Needs you ──────────────────────────────────────────────────────

/** Moving a partner to Champion, as Partners asks it (the page on Publish, JobTread's role soon) */
async function makeChampion(item, ctx) {
  const yes = await ask({
    title: `Move ${item.name} to Champion?`,
    text: `They gave ${usd(item.cents12)} in the last 12 months. Champion is the Champions grid on the Partners page; the page changes when you publish. Anyone of theirs in JobTread gets the Champion role there soon, published or not.`,
    yes: 'Move to Champion', careful: true,
  });
  if (!yes) return false;
  // One step on the site: the partner moved (an upgrade only, as it is at that moment) and the answer said, together;
  // refused (someone answered, or moved them, since), nothing changes and it says why
  const r = await change({ act: 'level', org: item.org, done: true, was: item.levelLabel, asked: true, move: true });
  if (!r.success) {
    // The answer lost on the way back (the move may have gone through): as it is now, never a failure that worked
    const now = r.status && r.status < 500 ? null : await get(`?org=${encodeURIComponent(item.org)}`);
    if (now?.success && now.level === 'champion') {
      window.dispatchEvent(new CustomEvent('soard-content-changed'));
      ctx.partnersChanged?.();
      ctx.addToast(`${item.name} moves to Champion when you publish`, 'success', null, { publish: true });
      return true;
    }
    ctx.addToast(`Couldn’t move ${item.name}: ${r.error}`, 'error');
    return false;
  }
  // A partner's level is the website's: the Publish bar counts it at once, and Partners shows it there
  window.dispatchEvent(new CustomEvent('soard-content-changed'));
  ctx.partnersChanged?.();
  ctx.addToast(`${item.name} moves to Champion when you publish`, 'success', null, { publish: true });
  return true;
}

/** Making an organization here (not on the website) from a name, with that name linked */
async function keepAsOrg(name, link, ctx, question = null) {
  const key = `o:${[...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  const r = await change({ act: 'org-new', key, name, links: link ? [link] : [], ...(question ? { asked: true, subject: question.subject, also: question.also || [] } : {}) });
  if (!r.success) { ctx.addToast(r.error, 'error'); return null; }
  listChanged();
  ctx.addToast(`${name} is an organization here now. Only staff see it.`, 'success', { label: 'Open', fn: () => goTo({ tab: 'people', org: r.key }) });
  return r.key;
}

function NeedsList({ ctx, onChanged, only = null, onCount = () => {} }) {
  const [v, setV] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);
  const [staff, setStaff] = useState([]);
  const latest = useLatest();
  const load = async () => {
    const current = latest();
    const j = await get('?needs=1');
    if (!current()) return;
    if (!j.success) { setErr(j.error); return; }
    setErr(null);
    setV(j.items);
    setStaff(j.staff || []);
    if (!only) onCount(j.items.length);
  };
  useEffect(() => { load(); }, []);
  useThanksSaid(load);
  const refocus = useRefocus('.dn-needs[aria-label="Needs you"]', !!v);
  const doIt = async (id, fn, e) => {
    refocus(e?.currentTarget);
    setBusy(id);
    const ok = await fn();
    // Answered, or not (someone answered it first, it's gone since): the list as it is now, and the card stays busy
    // until then (never pressed twice)
    if (ok !== false) listChanged();
    await load();
    setBusy(null);
    onChanged?.();
  };
  // An answer to the question as this page asked it: answered since (another tab, a teammate), nothing changes
  const said = async (body, done) => { const r = await change({ ...body, asked: true }); if (!r.success) { ctx.addToast(r.error, 'error'); return false; } if (done) ctx.addToast(done, 'success'); return true; };
  if (err) return html`<div class="notice notice--danger"><div class="notice__body">${err}</div><div class="notice__actions"><button class="btn btn-ghost" onClick=${load}>Try again</button></div></div>`;
  if (!v) return html`<div style="text-align:center;padding:2rem"><span class="spinner" /></div>`;
  const items = only ? v.filter(only) : v;
  if (!items.length) return html`<p class="dn-status dn-done">Nothing needs you. The site asks here when a name might be a partner or reads as an organization’s, two records might be one person, a gift could count for two organizations, or someone’s giving says Champion.</p>`;
  const btn = (id, label, fn, primary = false) => html`<button type="button" class=${`btn btn-sm ${primary ? 'btn-primary' : 'btn-ghost'}`} aria-disabled=${busy ? 'true' : null} onClick=${(e) => { if (!busy) doIt(id, fn, e); }}>${busy === id ? html`<span class="spinner spinner-14" />` : null}${label}</button>`;
  // A donor's page from here: its Back comes back here
  const who = (s, label = s.name) => html`<a class="link" href=${`#donors/${encodeURIComponent(s.ref)}`} onClick=${cameFrom('needs')}>${label}</a>`;
  return html`<ul class="dn-needs" aria-label="Needs you">${items.map((it) => {
    const id = it.id;
    if (it.kind === 'level') return html`<li key=${id} class="card dn-need">
      <p class="dn-need__q">${it.name} gave ${usd(it.cents12)} in the last 12 months. Make them a Champion?</p>
      <p class="dn-need__sub">A Funding partner, ${it.levelLabel} on the Partners page now. Champion is for major sponsors: $10,000 or more.</p>
      <div class="dn-need__do">${btn(id, 'Move to Champion…', () => makeChampion(it, ctx), true)}${btn(`${id}:no`, 'Not now', () => said({ act: 'level', org: it.org, done: false }, 'It won’t ask about them again for a year'))}
        <a class="link" href=${`#donors/org/${encodeURIComponent(it.org)}`} onClick=${cameFrom('needs')}>See their giving</a></div></li>`;
    // A name that reads as an organization's: a contact can be said to be a person, for good
    const isPerson = (label = 'It’s a person') => (it.person ? btn(`${id}:person`, label, () => said({ act: 'big', subject: it.subject, also: it.also || [], person: true }, `${it.name} stays a person, and it won’t ask again`)) : null);
    const keep = btn(id, 'Keep it as an organization', async () => { const k = await keepAsOrg(it.name, { kind: it.link, subject: it.linkSubject }, ctx, it); return k ? true : false; }, true);
    if (it.kind === 'big') return html`<li key=${id} class="card dn-need">
      <p class="dn-need__q">${it.name} gave ${usd(it.cents12)} in the last 12 months and isn’t an organization here.</p>
      <p class="dn-need__sub">${it.people?.length ? `Given by ${it.people.join(', ')}. ` : ''}Keep it as an organization to see all its giving together. Only staff see it; putting it on the website is a separate step.</p>
      <div class="dn-need__do">${keep}${isPerson()}${btn(`${id}:no`, 'Not now', () => said({ act: 'big', subject: it.subject, also: it.also || [] }, 'It won’t ask about it again for a year'))}</div></li>`;
    if (it.kind === 'named') return html`<li key=${id} class="card dn-need">
      <p class="dn-need__q">Is ${it.name} an organization?</p>
      <p class="dn-need__sub">Its name reads as one, but it shows as a person here. It gave ${usd(it.cents)} in all. Keep it as an organization to list it with the organizations; only staff see it.</p>
      <div class="dn-need__do">${keep}${isPerson('No, it’s a person')}
        ${it.ref ? who({ ref: it.ref, name: it.name }, 'See their gifts') : null}
        ${it.link === 'contact' ? html`<a class="link" href=${zeffyContactUrl(it.linkSubject)} target="_blank" rel="noopener">Open in Zeffy</a>` : null}</div></li>`;
    if (it.kind === 'near') return html`<li key=${id} class="card dn-need">
      <p class="dn-need__q">Is ${it.link === 'company' ? html`“${it.subject}”` : it.name} ${it.orgName}?</p>
      <p class="dn-need__sub">${it.link === 'company' ? `A company named on ${usd(it.cents)} of gifts${it.people?.length ? ` (${it.people.join(', ')})` : ''}.` : `A Zeffy contact who gave ${usd(it.cents)}.`} ${it.why}. Yes counts its gifts for ${it.orgName}.</p>
      <div class="dn-need__do">${btn(id, `Yes, it’s ${it.orgName}`, () => said({ act: 'link', kind: it.link, subject: it.subject, org: it.org }, `Its gifts count for ${it.orgName} now`), true)}${btn(`${id}:no`, 'No', () => said({ act: 'not', kind: it.link, subject: it.subject, org: it.org }))}
        ${it.link === 'contact' ? html`<a class="link" href=${zeffyContactUrl(it.subject)} target="_blank" rel="noopener">Open in Zeffy</a>` : null}</div></li>`;
    if (it.kind === 'clash') return html`<li key=${id} class="card dn-need">
      <p class="dn-need__q">${it.name}’s gift of ${usd(it.cents)} on ${day(it.at)} was for ${it.company}, but their Zeffy contact counts for ${it.countedName}.</p>
      <p class="dn-need__sub">It counts for ${it.countedName} until you say.</p>
      <div class="dn-need__do">${btn(id, `Count it for ${it.otherName}`, () => said({ act: 'payment', id: it.payment, owner: it.other }, `That gift counts for ${it.otherName} now`))}${btn(`${id}:keep`, `Keep it with ${it.countedName}`, () => said({ act: 'payment', id: it.payment, owner: it.counted }))}
        <a class="link" href=${zeffyPaymentUrl(it.payment)} target="_blank" rel="noopener">Open in Zeffy</a></div></li>`;
    if (it.kind === 'same') return html`<li key=${id} class="card dn-need">
      <p class="dn-need__q">Same person? ${it.a.name} and ${it.b.name}</p>
      <p class="dn-need__sub">${it.why}. The same person shows as one donor here, with all their gifts; Zeffy keeps both records until someone merges them there.</p>
      <div class="dn-same">${[it.a, it.b].map((s) => html`<div key=${s.key} class="dn-same__one"><strong>${s.ref ? who(s) : s.name}</strong>
        <span class="dn-sub">${[s.email, `${plural(s.gifts, 'gift')}, ${usd(s.cents)}`, s.latest ? `latest ${day(s.latest)}` : null].filter(Boolean).join(' · ')}</span>
        ${s.ref ? html`<a class="link dn-sub" href=${zeffyContactUrl(s.ref)} target="_blank" rel="noopener">Open in Zeffy</a>` : null}</div>`)}</div>
      <div class="dn-need__do">${btn(id, 'Same person', () => said({ act: 'same', a: it.a.key, b: it.b.key, same: true }, 'One donor now'), true)}${btn(`${id}:no`, 'Not the same', () => said({ act: 'same', a: it.a.key, b: it.b.key, same: false }))}</div></li>`;
    if (it.kind === 'moved') {
      // The team's notes and owner, left on the old record: they go to the contact picked, never left where no one sees them
      const kept = [it.notes === 1 ? 'note' : it.notes ? `${it.notes} notes` : null, it.owner ? `owner (${firstName(it.owner, staff)})` : null].filter(Boolean);
      const keptWords = kept.length ? `Its ${kept.join(' and its ')} ${kept.length > 1 || it.notes > 1 ? 'go' : 'goes'} to the one you pick.` : '';
      // Each told apart (two of one name, as a duplicate Zeffy split is): its email and its gifts
      const who = (i) => it.names?.[i] || `Contact ${i + 1}`;
      const whoFull = (i) => [who(i), it.who?.[i]?.email, it.who?.[i]?.gifts ? plural(it.who[i].gifts, 'gift') : null].filter(Boolean).join(', ');
      return html`<li key=${id} class="card dn-need">
      <p class="dn-need__q">Zeffy split a contact’s gifts between ${plural(it.to.length, 'contact')}${it.names?.some(Boolean) ? `: ${it.to.map((c, i) => who(i)).join(' and ')}` : ''}.</p>
      <p class="dn-need__sub">What was said about it here (an organization, the same person) stayed with the old record. Look at them in Zeffy and say it again on the right one.${it.anon ? ' It was kept anonymous, so each of them is kept anonymous too.' : ''} ${keptWords}</p>
      ${it.to.length ? html`<ul class="dn-plain">${it.to.map((c, i) => html`<li key=${c}>${whoFull(i)} · <a class="link" href=${zeffyContactUrl(c)} target="_blank" rel="noopener" aria-label=${`${whoFull(i)}, in Zeffy`}>In Zeffy</a></li>`)}</ul>` : null}
      <div class="dn-need__do">
        ${kept.length ? it.to.map((c, i) => btn(`${id}:${c}`, `Give them to ${whoFull(i)}`, () => said({ act: 'moved-done', contact: it.contact, to: c }, `Its ${kept.join(' and its ')} went to ${who(i)}`)))
          : btn(id, 'Done', () => said({ act: 'moved-done', contact: it.contact }))}</div></li>`;
    }
    return null;
  })}</ul>`;
}

// ─── Pickers ────────────────────────────────────────────────────────

/** A small dialog: a search box and a list to pick from */
function Picker({ title, sub, placeholder, search, onPick, onClose, extra = null }) {
  const box = useRef(null);
  const input = useRef(null);
  const [q, setQ] = useState('');
  const [list, setList] = useState([]);
  const [failed, setFailed] = useState(null);
  const [tries, setTries] = useState(0);
  const [busy, setBusy] = useState(false);
  // Closed after the page changed under it (the row that opened it gone): the focus on the page's heading
  useDialog(box, onClose, busy, { returnTo: '.dn-head h2' });
  // Opened: the focus in the search box (the dialog itself takes it first)
  useEffect(() => { input.current?.focus(); }, []);
  // Asked a moment after typing stops, and only the latest answer shows; one that failed says so
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      Promise.resolve().then(() => search(q)).then((l) => { if (live) { setFailed(null); setList(l || []); } }, (e) => { if (live) { setFailed(e?.message || 'The site didn’t answer'); setList([]); } });
    }, q ? 250 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [q, tries]);
  // Refused (gone since, someone answered first): the choices are read again, as they are now
  const pick = async (x) => { setBusy(true); const done = await onPick(x); setBusy(false); if (done !== false) onClose(); else { search.reset?.(); setTries((n) => n + 1); } };
  return html`<div class="modal-overlay" onClick=${(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <div class="modal dn-picker" role="dialog" aria-modal="true" aria-labelledby="dn-pick-h" tabindex="-1" ref=${box}>
      <h3 id="dn-pick-h">${title}</h3>
      ${sub ? html`<p>${sub}</p>` : null}
      <input class="form-input" type="search" ref=${input} placeholder=${placeholder} aria-label=${placeholder} value=${q} onInput=${(e) => setQ(e.target.value)} />
      <ul class="dn-picker__list" aria-label="Choices">${list.length ? list.map((x) => html`<li key=${x.id}><button type="button" class="dn-picker__item" disabled=${busy || x.disabled} onClick=${() => pick(x)}>
        <strong>${x.label}</strong>${x.sub ? html`<span class="dn-sub">${x.sub}</span>` : null}</button></li>`) : failed ? html`<li class="dn-sub dn-picker__none">Couldn’t search just now: ${failed}. <button type="button" class="link dn-linkbtn" onClick=${() => setTries((n) => n + 1)}>Try again</button></li>` : html`<li class="dn-sub dn-picker__none">${q.trim().length < 2 ? 'Type a couple of letters' : 'Nothing by that name'}</li>`}</ul>
      ${extra}
      <div class="modal-buttons"><button type="button" class="btn btn-ghost" onClick=${onClose} disabled=${busy}>Cancel</button></div>
    </div></div>`;
}

/** Organizations to link a name to: partners (on the website) and the ones kept here, read from the site once a picker */
function orgChooser(except = null) {
  let all = null;
  // (read again after a pick that was refused: an organization a teammate took out goes from the choices)
  return Object.assign(async (q) => {
    all ||= get('?orgs=1').then((j) => { if (!j.success) throw new Error(j.error); return j.orgs || []; });
    const t = q.trim().toLowerCase();
    let orgs;
    try { orgs = await all; } catch (e) { all = null; throw e; }
    return orgs.filter((o) => o.key !== except && (!t || o.name.toLowerCase().includes(t)))
      .map((o) => ({ id: o.key, label: o.name, sub: o.onSite ? `${o.levelLabel || 'Friend'} partner` : 'Not on the website' })).slice(0, t ? 12 : 8);
  }, { reset: () => { all = null; } });
}

// ─── One donor ──────────────────────────────────────────────────────

const KIT = {
  active: 'Gets the newsletter', inactive: 'On the list, not getting it', cancelled: 'Unsubscribed', bounced: 'Their email bounced', complained: 'Marked it as spam',
};

function GivingTiles({ d }) {
  const most = Math.max(1, ...d.years.map((y) => y.cents));
  return html`<div class="dn-tiles">
      <div class="dn-tile"><span class="dn-tile__label">All time</span><span class="dn-tile__value">${usd(d.total)}</span><span class="dn-tile__sub">${plural(d.gifts, 'gift')}</span></div>
      <div class="dn-tile"><span class="dn-tile__label">This year</span><span class="dn-tile__value">${usd(d.thisYear)}</span><span class="dn-tile__sub">Last year ${usd(d.lastYear)}</span></div>
      <div class="dn-tile"><span class="dn-tile__label">Years in a row</span><span class="dn-tile__value">${d.streak}</span></div>
      ${d.first ? html`<div class="dn-tile"><span class="dn-tile__label">First gift</span><span class="dn-tile__value">${usd(d.first.cents)}</span><span class="dn-tile__sub">${day(d.first.at)}</span></div>` : null}
      ${d.latest ? html`<div class="dn-tile"><span class="dn-tile__label">Latest gift</span><span class="dn-tile__value">${usd(d.latest.cents)}</span><span class="dn-tile__sub">${day(d.latest.at)}</span></div>` : null}
      ${d.largest ? html`<div class="dn-tile"><span class="dn-tile__label">Largest gift</span><span class="dn-tile__value">${usd(d.largest.cents)}</span><span class="dn-tile__sub">${day(d.largest.at)}</span></div>` : null}
      ${d.inKind ? html`<div class="dn-tile"><span class="dn-tile__label">In kind</span><span class="dn-tile__value">${usd(d.inKind)}</span><span class="dn-tile__sub">Not in the totals</span></div>` : null}
    </div>
    ${d.years.length > 1 ? html`<ul class="dn-years" aria-label="Giving by year">${d.years.map((y) => html`<li key=${y.year}><span>${y.year}</span><span class="dn-bar" aria-hidden="true"><span style=${`width:${Math.max(2, Math.round((y.cents / most) * 100))}%`}></span></span><span>${usd(y.cents)}</span></li>`)}</ul>` : null}`;
}

/** A gift's thank-you, in a few words */
const thankWords = (t, staff) => (!t ? null : t.state === 'todo' ? html`<span class="tag dn-tag--thank">To thank</span>`
  : t.state === 'thanked' ? `thanked${t.at ? ` ${shortDay(t.at)}` : ''}${t.by ? ` by ${firstName(t.by, staff)}` : ''}`
  : t.state === 'skipped' ? `no thank-you needed${t.by ? ` (${firstName(t.by, staff)})` : ''}` : null);

/** Thanked or Not needed by mistake, found later: To thank again, from the gift (the toast's Undo lasts seconds) */
const againNow = new Set();
async function thankAgain(ctx, t) {
  if (againNow.has(t.id)) return;
  againNow.add(t.id);
  try {
    const r = await change({ act: 'thanks', id: t.id, state: 'todo', was: t.state });
    listChanged();
    thanksChanged();
    if (!r.success) { ctx.addToast(r.error, 'error'); return; }
    if (r.same && !(r.retried && r.you)) return;
    ctx.addToast(`To thank again: ${amountOf(t)}`, 'success');
  } finally { againNow.delete(t.id); }
}
function GiftList({ gifts, byWho = false, staff = [], ctx = null }) {
  if (!gifts.length) return html`<p class="dn-sub">No gifts of their own.</p>`;
  return html`<ul class="dn-gifts">${gifts.map((g) => html`<li key=${g.id} class="dn-gift" data-gift=${g.id} data-gifts=${g.ids.join(' ')}>
    <span class="dn-gift__day">${day(g.at)}</span>
    <span class="dn-gift__what"><strong>${g.campaign || 'A gift'}</strong>
      <span class="dn-gift__meta">${[byWho && g.by ? `from ${g.by}` : null, g.how, g.every ? (g.every[0].toUpperCase() + g.every.slice(1)) : null, g.parts > 1 ? `in ${g.parts} charges` : null, !byWho && g.forCompany ? `for ${g.forCompany}` : null, g.through ? `through ${g.through}` : null, g.anonymous ? 'anonymous' : null, g.refunded ? 'refunded in full' : null, g.sold ? 'a ticket or purchase, not counted as giving' : null].filter(Boolean).join(' · ')}${(g.thanksAll || (g.thanks ? [g.thanks] : [])).map((th) => { const t = thankWords(th, staff); const part = (g.thanksAll || []).length > 1 && th.cents != null ? ` (${amountOf({ cents: th.cents, inKind: th.inKind })})` : ''; return html`${!t ? null : typeof t === 'string' ? ` · ${t}${part}` : html` ${t}${part}`}${ctx && ['thanked', 'skipped'].includes(th.state) ? html` <button type="button" class="link dn-linkbtn" aria-label=${`To thank again: ${amountOf({ cents: th.cents ?? g.cents, inKind: th.inKind ?? g.inKind, why: th.why })}, ${day(g.at)}`} onClick=${() => thankAgain(ctx, th)}>To thank again</button>` : null}`; })}</span></span>
    <span class="dn-gift__amt">${g.inKind ? html`${usd(g.inKind)}<span class="dn-sub">in kind</span>` : g.kind ? 'In kind' : g.sold || g.refunded ? '–' : usd(g.cents)}</span>
    <span class="dn-gift__links">
      <a class="link" href=${zeffyPaymentUrl(g.id)} target="_blank" rel="noopener" aria-label=${`Open in Zeffy: ${g.campaign || 'gift'}, ${day(g.at)}`}>Open in Zeffy</a>
      ${g.mercury ? html`<a class="link" href=${g.mercury} target="_blank" rel="noopener" aria-label=${`See the check in Mercury: ${day(g.at)}`}>See the check in Mercury</a>` : null}
    </span>
  </li>`)}</ul>`;
}

/** Who on the team looks after a donor */
function OwnerCard({ subject, owner, staff = [], name, ctx, onDone }) {
  const [busy, setBusy] = useState(false);
  const saving = useRef(null);
  const pick = async (e) => {
    const email = e.target.value;
    // One change at a time: a pick while the last saves goes back to it
    if (saving.current !== null) { e.target.value = saving.current; return; }
    saving.current = email;
    setBusy(true);
    const r = await change({ act: 'owner', key: subject, email, was: owner || '' });
    saving.current = null;
    setBusy(false);
    // Refused, or the answer lost on the way back (it may have saved): the page reads again, so it shows who it is now
    if (!r.success) { ctx.addToast(r.error, 'error'); e.target.value = owner || ''; await onDone(); return; }
    listChanged();
    ctx.addToast(email ? `${fullName(email, staff)} looks after ${name} now` : `No one looks after ${name} now`, 'success');
    await onDone();
  };
  const left = owner && staff.find((s) => s.email === owner)?.left;
  return html`<section class="kd-card dn-card--owner" aria-labelledby="dn-owner-h">
    <h3 id="dn-owner-h">Owner</h3>
    <select id="dn-owner-pick" class="form-select" aria-label=${`Who on the team looks after ${name}`} value=${owner || ''} aria-busy=${busy ? 'true' : null} onChange=${pick}>
      <option value="">No one yet</option>
      ${staff.map((s) => html`<option key=${s.email} value=${s.email}>${s.name}${s.left ? ' (left the team)' : ''}</option>`)}
    </select>
    <p class="kd-card__note">${left ? `${fullName(owner, staff)} is no longer on the team: pick who looks after them now.` : 'The one on the team who looks after them: thanks them, keeps in touch and keeps the notes up to date.'}</p>
  </section>`;
}

/** The gifts on this page still to thank, at the top where they can't be missed */
function ThankBox({ gifts, name, ctx }) {
  const [busy, setBusy] = useState(null);
  // Said here: gone from the box at once, until the page reads again (never pressed twice while the read comes)
  const [said, setSaid] = useState(() => new Set());
  useEffect(() => { setSaid(new Set()); }, [gifts]);
  // Every thank-you still to do, each its own (a gift can hold a thanked part and a later part to thank)
  const seen = new Set();
  const todo = gifts.flatMap((g) => (g.thanksAll || (g.thanks ? [g.thanks] : [])).filter((t) => t.state === 'todo' && !said.has(t.id) && !seen.has(t.id) && seen.add(t.id)).map((t) => ({ ...g, id: `${g.id}:${t.id}`, thanks: t })));
  // The last one said: the box goes, the focus to the donor's name
  const refocus = useRefocus('.dn-thank__list', true, '.dn-head h2');
  if (!todo.length) return null;
  const doIt = async (g, state, e) => {
    refocus(e.currentTarget);
    setBusy(`${g.id}:${state}`);
    const ok = await sayThanks(ctx, { id: g.thanks.id, cents: g.thanks.cents ?? g.cents, inKind: g.thanks.inKind ?? g.inKind, why: g.thanks.why, name: g.by || name }, state);
    if (ok) setSaid((x) => new Set(x).add(g.thanks.id));
    setBusy(null);
  };
  return html`<section class="card kd-sec dn-thank" aria-labelledby="dn-thank-h">
    <header class="kd-sec__head"><h3 id="dn-thank-h">To thank <span class="count">${todo.length}</span></h3></header>
    <ul class="dn-thank__list">${todo.map((g) => html`<li key=${g.id} class="dn-thank__one" data-thank=${g.thanks.id}>
      <span><strong>${amountOf({ cents: g.thanks.cents ?? g.cents, inKind: g.thanks.inKind ?? g.inKind, thanks: g.thanks })}</strong> · ${[g.campaign || 'A gift', g.thanks.how || g.how, day(g.at), g.by ? `from ${g.by}` : null, g.thanks.ids && g.ids?.length > 1 && !g.thanks.ids.includes(g.ids[0]) ? 'the part given later' : null].filter(Boolean).join(' · ')}</span>
      <span class="dn-sub">${g.thanks.whyText}.</span>
      <span class="dn-row-do">
        <button type="button" class="btn btn-primary btn-sm" aria-disabled=${busy ? 'true' : null} onClick=${(e) => { if (!busy) doIt(g, 'thanked', e); }}>${busy === `${g.id}:thanked` ? html`<span class="spinner spinner-14" />` : null}Thanked</button>
        <button type="button" class="btn btn-ghost btn-sm" aria-disabled=${busy ? 'true' : null} onClick=${(e) => { if (!busy) doIt(g, 'skipped', e); }}>${busy === `${g.id}:skipped` ? html`<span class="spinner spinner-14" />` : null}Not needed</button>
      </span></li>`)}</ul>
    <p class="kd-card__note">Zeffy thanks online givers by email. These it doesn’t, or they’re big enough for a call or a note from the team.</p>
  </section>`;
}

/** The team's notes: newest first, anyone on the team can add, change or delete one */
function Notes({ subject, notes = [], staff = [], name, zeffy = false, ctx, onDone }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');
  // The note's words when Change was pressed: changed by a teammate since, it shows above the person's own
  const [from, setFrom] = useState(null);
  const box = useRef(null);
  // The note being added: named here, so pressing Add again after an answer that was lost saves it once
  const pending = useRef(null);
  // Saved after all (its answer lost, the page read again): it's in the list, so the box empties
  // (only when the box still holds those words: typed on since, the box keeps it all, and says the first part saved)
  useEffect(() => {
    if (!pending.current || !notes.some((n) => n.id === pending.current.id)) return;
    const said = pending.current.text;
    pending.current = null;
    if (text.trim() === said) setText('');
    else ctx.addToast('Your note was saved after all. The box still has what you typed since: change it to what’s new, then Add note.', 'info');
  }, [notes]);
  // A change saved after all (its answers lost, the page read again): the note reads as they wrote it, so it's done.
  // The note being changed deleted by a teammate meanwhile: the person's words go to the new note box, never lost
  useEffect(() => {
    if (editing && !notes.some((x) => x.id === editing)) {
      const words = draft.trim();
      setEditing(null);
      setFrom(null);
      if (words) {
        setText((x) => (x.trim() ? `${x.trimEnd()}\n\n${words}` : words));
        ctx.addToast('The note you were changing was deleted by someone else. Your words are in the new note box: Add note saves them.', 'info');
        requestAnimationFrame(() => box.current?.focus());
      }
      return;
    }
    const n = editing && notes.find((x) => x.id === editing);
    if (n && from !== null && n.body !== from && n.body === draft.trim()) { setEditing(null); setFrom(null); focusNote(n.id); }
  }, [notes]);
  const add = async (e) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    if (!pending.current || pending.current.text !== t) pending.current = { id: crypto.randomUUID(), text: t };
    setBusy(true);
    const r = await change({ act: 'note-add', key: subject, body: t, id: pending.current.id });
    setBusy(false);
    if (!r.success) { ctx.addToast(r.error, 'error'); requestAnimationFrame(() => box.current?.focus()); return; }
    pending.current = null;
    setText('');
    await onDone();
    box.current?.focus();
  };
  // The focus back on a note's Change (after saving or leaving a change), or the next note's (after a delete), else the box
  const focusNote = (id) => requestAnimationFrame(() => (document.querySelector(`.dn-note[data-note="${CSS.escape(id || '')}"] .dn-note__change`) || box.current)?.focus());
  const stop = (n) => { setEditing(null); setFrom(null); focusNote(n.id); };
  const save = async (n) => {
    const t = draft.trim();
    if (!t || busy) return;
    if (t === n.body) { stop(n); return; }
    setBusy(true);
    const r = await change({ act: 'note-edit', id: n.id, body: t, was: n.body });
    setBusy(false);
    if (!r.success) {
      // Never the person's words lost: deleted since, they go to the new note box; changed since, they stay in the
      // editor with the note as it is now above them (Save then puts theirs in its place)
      if (r.status === 404) {
        setEditing(null);
        setFrom(null);
        setText((x) => (x.trim() ? `${x.trimEnd()}\n\n${t}` : t));
        ctx.addToast('That note was deleted since you looked. Your words are in the new note box: Add note saves them.', 'error');
        await onDone();
        box.current?.focus();
        return;
      }
      ctx.addToast(r.status === 409 ? `${r.error} Your words are still in the box.` : r.error, 'error');
      if (r.status === 409) await onDone();
      return;
    }
    setEditing(null);
    setFrom(null);
    await onDone();
    focusNote(n.id);
  };
  const del = async (n) => {
    if (busy || !(await ask({ title: 'Delete this note?', text: 'It’s gone for everyone, and can’t be brought back.', yes: 'Delete', danger: true }))) return;
    const i = notes.findIndex((x) => x.id === n.id);
    const next = notes[i + 1] || notes[i - 1] || null;
    setBusy(true);
    // (only the note as it shows here: changed by a teammate since, it isn't deleted and shows as it is now)
    const r = await change({ act: 'note-delete', id: n.id, was: n.body });
    setBusy(false);
    if (!r.success) { ctx.addToast(r.error, 'error'); await onDone(); return; }
    ctx.addToast('Note deleted', 'success');
    await onDone();
    focusNote(next?.id);
  };
  // ⌘/Ctrl + Enter saves, as in a message
  const keys = (fn) => (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); fn(); } };
  return html`<section class="card kd-sec" aria-labelledby="dn-notes-h">
    <header class="kd-sec__head"><h3 id="dn-notes-h">Notes ${notes.length ? html`<span class="count">${notes.length}</span>` : null}</h3></header>
    <form class="dn-note-new" onSubmit=${add}>
      <textarea id="dn-note-text" aria-label=${`A note about ${name}`} ref=${box} class="form-input" rows="3" maxlength="4000" placeholder=${`A note about ${name}: a call, a visit, what they care about`} value=${text} readOnly=${busy} aria-busy=${busy ? 'true' : null}
        onInput=${(e) => setText(e.target.value)} onKeyDown=${keys(add)}></textarea>
      <div class="dn-note-new__do"><span class="dn-sub">Only the team sees notes.${zeffy ? ' Notes written in Zeffy before stay there.' : ''}</span>
        <button type="submit" class="btn btn-primary btn-sm" disabled=${!text.trim()} aria-disabled=${busy ? 'true' : null}>Add note</button></div>
    </form>
    ${notes.length ? html`<ul class="dn-notes">${notes.map((n) => html`<li key=${n.id} class="dn-note" data-note=${n.id}>
      ${editing === n.id && from !== null && n.body !== from ? html`<p class="dn-sub" id=${`dn-note-now-${n.id}`}>Changed since you began. It reads now:</p><p class="dn-note__body">${n.body}</p>` : null}
      ${editing === n.id ? html`<textarea id=${`dn-note-${n.id}`} aria-label="Change the note" class="form-input" rows="3" maxlength="4000" value=${draft} readOnly=${busy} aria-busy=${busy ? 'true' : null} data-escape="local"
          onInput=${(e) => setDraft(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stop(n); return; } keys(() => save(n))(e); }}
          ref=${(el) => { if (el && !el.dataset.focused) { el.dataset.focused = '1'; el.focus(); } }}></textarea>
        <span class="dn-row-do"><button type="button" class="btn btn-primary btn-sm" disabled=${!draft.trim()} aria-disabled=${busy ? 'true' : null} onClick=${() => save(n)}>Save</button>
          <button type="button" class="btn btn-ghost btn-sm" onClick=${() => { if (!busy) stop(n); }}>Cancel</button></span>`
      : html`<p class="dn-note__body">${n.body}</p>`}
      <span class="dn-note__meta"><span>${n.by ? fullName(n.by, staff) : 'Someone'} · ${when(n.at)}${n.editedAt ? ` · changed${n.editedBy && n.editedBy !== n.by ? ` by ${firstName(n.editedBy, staff)}` : ''} ${when(n.editedAt)}` : ''}</span>
        ${editing === n.id ? null : html`<button type="button" class="link dn-linkbtn dn-note__change" onClick=${() => { if (!busy) { setDraft(n.body); setFrom(n.body); setEditing(n.id); } }}>Change</button>
        <button type="button" class="link dn-linkbtn" onClick=${() => del(n)}>Delete</button>`}</span>
    </li>`)}</ul>` : null}
  </section>`;
}

/** What the team did about a donor, newest first */
function HistoryCard({ history = [], staff = [] }) {
  const [all, setAll] = useState(false);
  const list = all ? history : history.slice(0, 4);
  return html`<section class="kd-card kd-card--history" aria-labelledby="dn-history-h">
    <h3 id="dn-history-h">History ${history.length ? html`<span class="kd-card__count">${history.length >= 25 ? 'latest 25' : plural(history.length, 'change')}</span>` : null}</h3>
    ${!history.length ? html`<p class="kd-card__note">What the team says here (an owner, a note, a thank-you, an organization, Keep anonymous) is kept, with who and when.</p>`
      : html`<ol class="kd-history">${list.map((h, i) => html`<li key=${i}><div class="kd-history__row dn-history__row">
          <span class="kd-history__top"><strong>${h.by ? fullName(h.by, staff) : 'The site'}</strong><span>${when(h.at)}</span></span>
          <span class="dn-history__what">${h.what}</span></div></li>`)}</ol>
        ${history.length > 4 ? html`<button type="button" class="btn btn-ghost btn-sm kd-history__all" onClick=${() => setAll(!all)}>${all ? 'Show fewer' : `Show all ${history.length}`}</button>` : null}`}
  </section>`;
}

/** Keep anonymous: on a person or an organization */
function KeepAnonymous({ subject, on, why = null, names = [], name, ctx, onDone }) {
  const [busy, setBusy] = useState(false);
  // Kept because someone kept shares their email (a Zeffy duplicate, or a spouse): said so, and freed by "not the same"
  const shared = why?.kind === 'shared' || why?.kind === 'name';
  const notSame = async () => {
    if (!(await ask({ title: `${name} and ${why.otherName}: not the same person?`, text: `They share ${why.kind === 'name' ? 'a name' : 'an email'} in Zeffy. ${why.otherName} is kept anonymous; said not to be the same person, ${name} isn’t, and the two show as separate donors.`, yes: 'Not the same person' }))) return;
    setBusy(true);
    const r = await change({ act: 'same', a: subject, b: why.other, same: false });
    setBusy(false);
    if (!r.success) { ctx.addToast(r.error, 'error'); return; }
    listChanged();
    ctx.addToast(`${name} and ${why.otherName} are separate donors now`, 'success');
    onDone();
  };
  const flip = async (e) => {
    const next = e.target.checked;
    if (busy) { e.target.checked = !next; return; }
    setBusy(true);
    const r = await change({ act: 'anon', key: subject, on: next });
    setBusy(false);
    // Refused, or the answer lost on the way back (it may have saved): the page reads again, so the box shows what's so
    if (!r.success) { ctx.addToast(r.error, 'error'); e.target.checked = !next; onDone(); return; }
    listChanged();
    ctx.addToast(next ? `${name} is kept anonymous` : `${name} is no longer kept anonymous`, 'success');
    onDone();
  };
  return html`<section class="kd-card dn-card--late" aria-labelledby="dn-anon-h">
    <h3 id="dn-anon-h">Anonymous</h3>
    <label class="dn-check"><input type="checkbox" checked=${on} disabled=${shared} aria-busy=${busy ? 'true' : null} onChange=${flip} /> Keep anonymous</label>
    ${shared ? html`<p class="kd-card__note">Because they share ${why.kind === 'name' ? 'a name' : 'an email'} in Zeffy with ${why.otherName}, who is kept anonymous. <button type="button" class="link dn-linkbtn" disabled=${busy} onClick=${notSame}>Not the same person</button></p>`
      : why?.kind === 'email' ? html`<p class="kd-card__note">Kept by their email from before Zeffy had a contact for them.</p>` : null}
    <p class="kd-card__note">Their name stays off the board’s list of gifts, and the site never suggests them for the Partners page.</p>
    ${on && names.length > 1 ? html`<p class="kd-card__note">Gifts under any name it has had are hidden too: ${names.join(', ')}.</p>` : null}
  </section>`;
}

function DonorPage({ donor, gift, fromList = false, ctx, onBack, backLabel = 'Donors', onDonor, onOrg }) {
  const [v, setV] = useState(null);
  const [rowBusy, setRowBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [gone, setGone] = useState(null);
  const [picking, setPicking] = useState(null);
  const [joining, setJoining] = useState(false);
  // Only the latest read lands (a quick move to another donor never shows the one before)
  const seq = useRef(0);
  // Left (another donor, the list, another area): a read or a change still out lands nowhere, and moves no one
  const left = useRef(false);
  useEffect(() => () => { left.current = true; seq.current++; }, []);
  const load = async () => {
    const mine = ++seq.current;
    const fresh = () => mine === seq.current;
    setErr(null);
    let ref = donor;
    if (!ref && gift) {
      const g = await get(`?gift=${encodeURIComponent(gift)}`);
      if (!fresh()) return;
      if (!g.success) { setErr({ text: g.error, final: g.status === 404 }); return; }
      // A gift that counts for an organization opens the organization
      if (g.org) { onOrg(g.org); return; }
      ref = g.ref;
      // A Zeffy contact has an address of its own; a donor with none stays at their gift's
      if (!ref.startsWith('g:')) { onDonor(ref); return; }
    }
    const j = await get(`?donor=${encodeURIComponent(ref)}`);
    if (!fresh()) return;
    if (!j.success && shown.current && j.status !== 404) { ctx.addToast(`The page couldn’t be read again just now: ${j.error} It shows what was read before.`, 'error', { label: 'Try again', fn: () => load() }); return; }
    // Gone since it was read (taken out, merged, by a teammate): the page stays as it was, so nothing typed is lost
    if (!j.success && shown.current) { setGone(j.error); return; }
    if (!j.success) { setErr({ text: j.error, final: j.status === 404 }); return; }
    if (j.org) { onOrg(j.org); return; }
    setV(j);
    thanksRead();
  };
  useEffect(() => { setV(null); load(); }, [donor, gift]);
  // A thank-you said elsewhere (a toast's Undo from another page): this page as it is now
  useThanksSaid(() => { if (v) load(); });
  const shown = useRef(false);
  shown.current = !!v;
  // Opened: the focus on the donor's name, so a screen reader says whose page this is; after a change re-draws the
  // page and takes away what had the focus (a record split off, a name taken off), there again
  const heading = useRef(null);
  useEffect(() => { if (v) heading.current?.focus({ preventScroll: true }); }, [!!v]);
  useEffect(() => { if (v && (!document.activeElement || document.activeElement === document.body)) heading.current?.focus({ preventScroll: true }); }, [v]);
  // A gift opened from a link (Slack): in view, marked a moment, once (a change on the page later never jumps back to
  // it). Opened from the list, the page starts at the top
  const flashed = useRef(null);
  useEffect(() => {
    // (opened from To thank or Needs you: the page from the top, its To thank box first)
    if (!v || !gift || fromList || backTo || flashed.current === gift) return;
    const el = document.querySelector(`[data-gifts~="${CSS.escape(gift)}"]`);
    if (!el) return;
    flashed.current = gift;
    el.scrollIntoView({ block: 'center' });
    el.classList.add('is-flash');
    // Not tied to this effect: a change on the page meanwhile (a note, an owner) never leaves the mark on for good
    setTimeout(() => el.classList.remove('is-flash'), 2400);
  }, [v, gift]);
  const back = html`<button type="button" class="dn-back" onClick=${onBack}>← ${backLabel}</button>`;
  // (an address that leads nowhere: the focus on Back, never left on the page)
  if (err) return html`${back}<div class="notice notice--danger" role="alert" ref=${(el) => { if (el && err.final && (!document.activeElement || document.activeElement === document.body)) document.querySelector('.dn-back')?.focus(); }}><div class="notice__body">${err.text}</div>${err.final ? null : html`<div class="notice__actions"><button class="btn btn-ghost" onClick=${load}>Try again</button></div>`}</div>`;
  if (!v) return html`${back}<div style="text-align:center;padding:2rem"><span class="spinner" /></div>`;
  const d = v.donor;
  // One of the company row's answers at a time (a second press while the first saves does nothing)
  const once = async (fn) => { if (rowBusy) return; setRowBusy(true); try { await fn(); } finally { setRowBusy(false); } };
  const linkTo = async (link, orgKey, orgName, asked = false) => {
    // A Zeffy contact: every record of theirs (a person joined from several counts whole)
    const subjects = link.kind === 'contact' ? [...new Set([v.key, ...(v.also || []).map((a) => a.key)].filter((k) => k.startsWith('c:')).map((k) => k.slice(2)))] : [link.subject];
    // (all of them in one step: never some linked and some not)
    const r = await change({ act: 'link', kind: link.kind, subject: subjects[0], subjects, org: orgKey, ...(asked ? { asked: true } : {}) });
    if (!r.success) { ctx.addToast(r.error, 'error'); await load(); return false; }
    listChanged();
    ctx.addToast(`${link.kind === 'company' ? `Gifts for ${link.subject}` : `${d.name}’s gifts`} count for ${orgName} now`, 'success', { label: 'Open', fn: () => goTo({ tab: 'people', org: orgKey }) });
    await load();
    return true;
  };
  return html`
    ${back}
    ${gone ? html`<div class="notice notice--warn" role="alert"><div class="notice__body"><strong>${gone}</strong> This page shows it as it was: copy anything you typed here, then go back.</div></div>` : null}
    <div class="dn-head">
      <h2 tabindex="-1" ref=${heading}>${d.name} ${stageTag(d.stage)}${v.keepAnonymous ? html`<span class="tag">Kept anonymous</span>` : d.anonymous ? html`<span class="tag">Asked to be anonymous</span>` : null}</h2>
      <p class="dn-head__sub">${[d.funds.length ? `Through ${d.funds.join(', ')}` : null, d.email].filter(Boolean).join(' · ')}</p>
    </div>
    <div class="kd-shell"><div class="kd-layout">
      <aside class="kd-rail" aria-label="Donor at a glance">
        <section class="kd-card kd-card--status" aria-labelledby="dn-stage-h">
          <h3 id="dn-stage-h">Stage</h3>
          <p>${stageTag(d.stage)}</p>
          <p class="kd-card__note">${STAGES[d.stage]?.what}</p>
        </section>
        <${OwnerCard} subject=${v.key} owner=${v.owner} staff=${v.staff} name=${d.name} ctx=${ctx} onDone=${load} />
        <section class="kd-card kd-card--health dn-card--zeffy" aria-labelledby="dn-zeffy-h">
          <h3 id="dn-zeffy-h">In Zeffy</h3>
          <dl class="dn-facts">
            ${d.email ? html`<div><dt>Email</dt><dd>${d.email}</dd></div>` : null}
            <div><dt>Newsletter</dt><dd>${!d.email ? 'No email in Zeffy' : !v.kit ? 'Kit isn’t connected' : v.kit.error ? 'Kit didn’t answer' : v.kit.none ? 'Not on the list' : KIT[v.kit.state] || v.kit.state}</dd></div>
          </dl>
          ${d.contact ? html`<p style="margin:.75rem 0 0"><a class="btn btn-ghost btn-sm" href=${zeffyContactUrl(d.contact)} target="_blank" rel="noopener">Open in Zeffy</a></p>
            <p class="kd-card__note">Their name, email and address are changed in Zeffy.</p>` : html`<p class="kd-card__note">Zeffy has no contact for these gifts, only the name on each.</p>`}
          ${/^[cen]:/.test(v.key) ? html`<p class="kd-card__note">In Zeffy twice? <button type="button" class="link dn-linkbtn" onClick=${() => setJoining(true)}>Same person as another donor…</button></p>` : null}
          ${v.also?.length ? html`<p class="kd-card__note">Also in Zeffy as:</p><ul class="dn-plain">${v.also.map((a, i) => html`<li key=${a.key}>
            ${a.ref ? html`<a class="link" href=${zeffyContactUrl(a.ref)} target="_blank" rel="noopener">Record ${i + 2} in Zeffy</a>` : html`<span>Record ${i + 2}, with no Zeffy contact</span>`}
            <button type="button" class="link dn-linkbtn" onClick=${async () => {
              if (!(await ask({ title: 'Not the same person?', text: `Record ${i + 2} becomes a donor of its own, with its own gifts, and won’t be asked about again. ${d.name}’s other records stay together.`, yes: 'Not the same' }))) return;
              const r = await change({ act: 'split', key: a.key });
              if (!r.success) { ctx.addToast(r.error, 'error'); return; }
              listChanged();
              ctx.addToast(`Record ${i + 2} is a donor of its own now`, 'success');
              if (left.current) return;
              // This page stays with the person (the record split off may be the address it was opened at)
              if (r.ref && r.ref !== donor) onDonor(r.ref); else await load();
            }}>Not the same person</button></li>`)}</ul>` : null}
        </section>
        <${KeepAnonymous} subject=${v.key} on=${!!v.keepAnonymous} why=${v.keptWhy} name=${d.name} ctx=${ctx} onDone=${load} />
        <section class="kd-card dn-card--late" aria-labelledby="dn-orgs-h">
          <h3 id="dn-orgs-h">Organizations</h3>
          ${v.gaveFor?.length ? html`<ul class="dn-plain">${v.gaveFor.map((o) => html`<li key=${o.key}>Gave ${usd(o.cents)} for <a class="link" href=${`#donors/org/${encodeURIComponent(o.key)}`}>${o.name}</a><span class="dn-sub">${plural(o.gifts, 'gift')}, counted for them</span></li>`)}</ul>` : null}
          ${v.companies?.length ? html`<ul class="dn-plain">${v.companies.map((c) => html`<li key=${c.name}>Gave ${usd(c.cents)} for ${c.name}
            <span class="dn-sub">Counted as ${d.name}’s until it’s linked</span>
            <span class="dn-row-do">
              ${c.near ? html`<button type="button" class="btn btn-ghost btn-sm" aria-disabled=${rowBusy ? 'true' : null} onClick=${() => once(() => linkTo({ kind: 'company', subject: c.name }, c.near.key, c.near.name, true))}>It’s ${c.near.name}</button>` : null}
              <button type="button" class="btn btn-ghost btn-sm" onClick=${() => setPicking({ kind: 'company', subject: c.name, label: c.name })}>Link to…</button>
              <button type="button" class="btn btn-ghost btn-sm" aria-disabled=${rowBusy ? 'true' : null} onClick=${() => once(async () => { await keepAsOrg(c.name, { kind: 'company', subject: c.name }, ctx); await load(); })}>Keep as an organization</button>
            </span></li>`)}</ul>` : null}
          ${!v.gaveFor?.length && !v.companies?.length ? html`<p class="kd-card__note">None. When they give for a company, it shows here.</p>` : null}
          ${d.contact ? html`<p class="kd-card__note">Is this an organization’s own record in Zeffy? <button type="button" class="link dn-linkbtn" onClick=${() => setPicking({ kind: 'contact', subject: d.contact, label: d.name })}>Count it for an organization…</button></p>` : null}
        </section>
        <${HistoryCard} history=${v.history} staff=${v.staff} />
      </aside>
      <div class="kd-main" style="display:grid;gap:1rem">
        <${ThankBox} gifts=${v.gifts} name=${d.name} ctx=${ctx} />
        <section class="card kd-sec" aria-labelledby="dn-giving-h">
          <header class="kd-sec__head"><h3 id="dn-giving-h">Giving</h3></header>
          <${GivingTiles} d=${d} />
        </section>
        <${Notes} subject=${v.key} notes=${v.notes} staff=${v.staff} name=${d.name} zeffy=${!!d.contact} ctx=${ctx} onDone=${load} />
        <section class="card kd-sec" aria-labelledby="dn-gifts-h">
          <header class="kd-sec__head"><h3 id="dn-gifts-h">Gifts <span class="count">${v.gifts.length}</span></h3></header>
          <${GiftList} gifts=${v.gifts} staff=${v.staff} ctx=${ctx} />
        </section>
      </div>
    </div></div>
    ${picking ? html`<${Picker} title=${picking.kind === 'company' ? `Which organization is “${picking.label}”?` : `Which organization is ${picking.label}?`}
      sub=${picking.kind === 'company' ? 'Every gift given for that name counts for it, from anyone.' : 'Every gift from this Zeffy contact counts for it.'}
      placeholder="Organization name" search=${picking.search ||= orgChooser()}
      onPick=${(o) => linkTo({ kind: picking.kind, subject: picking.subject }, o.id, o.label)} onClose=${() => setPicking(null)} />` : null}
    ${joining ? html`<${Picker} title=${`Who else is ${d.name}?`} sub="Pick their other record: it shows as one donor here, with all their gifts. Zeffy keeps both until someone merges them there."
      placeholder="Name or email in Zeffy" onClose=${() => setJoining(false)}
      search=${async (q) => {
        if (q.trim().length < 2) return [];
        const j = await call('', { findPeople: q.trim(), except: v.key });
        if (!j.success) throw new Error(j.error);
        return (j.people || []).map((p) => ({ id: p.key, label: p.name, sub: [p.email, `${plural(p.gifts, 'gift')}, ${usd(p.cents)}`].filter(Boolean).join(' · ') }));
      }}
      onPick=${async (p) => {
        const r = await change({ act: 'same', a: v.key, b: p.id, same: true });
        if (!r.success) { ctx.addToast(r.error, 'error'); return false; }
        listChanged();
        ctx.addToast(`${d.name} and ${p.label} are one donor now`, 'success');
        await load();
        return true;
      }} />` : null}`;
}

// ─── One organization ───────────────────────────────────────────────

// (one Put it on the website at a time: a double click asks once)
let puttingOnSite = false;
function OrgPage({ orgKey, gift = null, ctx, onBack, backLabel = 'Donors' }) {
  const [v, setV] = useState(null);
  const [err, setErr] = useState(null);
  const [gone, setGone] = useState(null);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const left = useRef(false);
  useEffect(() => () => { left.current = true; seq.current++; }, []);
  const load = async () => {
    const mine = ++seq.current;
    setErr(null);
    const j = await get(`?org=${encodeURIComponent(orgKey)}`);
    if (mine !== seq.current) return;
    if (!j.success && shown.current && j.status !== 404) { ctx.addToast(`The page couldn’t be read again just now: ${j.error} It shows what was read before.`, 'error', { label: 'Try again', fn: () => load() }); return; }
    // Gone since it was read (taken out, merged, by a teammate): the page stays as it was, so nothing typed is lost
    if (!j.success && shown.current) { setGone(j.error); return; }
    if (!j.success) { setErr({ text: j.error, final: j.status === 404 }); return; }
    // Kept here before, on the website now: its partner's page, at its address
    if (j.org && !j.donor) { history.replaceState(null, '', `#donors/org/${encodeURIComponent(j.org)}`); ctx.open({ tab: 'people', org: j.org }); return; }
    setV(j);
    thanksRead();
  };
  useEffect(() => { setV(null); load(); }, [orgKey]);
  useThanksSaid(() => { if (v) load(); });
  const shown = useRef(false);
  shown.current = !!v;
  const heading = useRef(null);
  useEffect(() => { if (v) heading.current?.focus({ preventScroll: true }); }, [!!v]);
  useEffect(() => { if (v && (!document.activeElement || document.activeElement === document.body)) heading.current?.focus({ preventScroll: true }); }, [v]);
  // Opened from a gift's link (the Slack "Major gift" post) that counts for this organization: that gift, marked, once
  const flashed = useRef(null);
  useEffect(() => {
    if (!v || !gift || flashed.current === gift) return;
    const el = document.querySelector(`[data-gifts~="${CSS.escape(gift)}"]`);
    if (!el) return;
    flashed.current = gift;
    el.scrollIntoView({ block: 'center' });
    el.classList.add('is-flash');
    setTimeout(() => el.classList.remove('is-flash'), 2400);
  }, [v, gift]);
  const back = html`<button type="button" class="dn-back" onClick=${onBack}>← ${backLabel}</button>`;
  // (an address that leads nowhere: the focus on Back, never left on the page)
  if (err) return html`${back}<div class="notice notice--danger" role="alert" ref=${(el) => { if (el && err.final && (!document.activeElement || document.activeElement === document.body)) document.querySelector('.dn-back')?.focus(); }}><div class="notice__body">${err.text}</div>${err.final ? null : html`<div class="notice__actions"><button class="btn btn-ghost" onClick=${load}>Try again</button></div>`}</div>`;
  if (!v) return html`${back}<div style="text-align:center;padding:2rem"><span class="spinner" /></div>`;
  const d = v.donor;
  const level = v.needs.find((n) => n.kind === 'level');
  const near = v.needs.filter((n) => n.kind === 'near');
  const unlink = async (n) => {
    if (!(await ask({ title: `Take “${n.name}” off ${v.name}?`, text: n.kind === 'payment' ? 'That gift counts as it would without your answer: for its giver’s organization if they have one, else for them.' : 'Its gifts count for the people who gave them again, and the site won’t link that name to it by itself.', yes: 'Take it off' }))) return;
    const r = await change(n.kind === 'payment' ? { act: 'payment-clear', id: n.subject } : { act: 'not', kind: n.kind, subject: n.subject, ...(n.subjects?.length > 1 ? { subjects: n.subjects } : {}), org: v.key });
    if (!r.success) { ctx.addToast(r.error, 'error'); return; }
    listChanged();
    ctx.addToast(`“${n.name}” is off ${v.name}`, 'success');
    await load();
  };
  // Refused (answered by someone since): the page as it is now, so the question it showed goes
  const say = async (body, done) => { setBusy(true); const r = await change(body); setBusy(false); if (!r.success) { ctx.addToast(r.error, 'error'); await load(); return false; } listChanged(); if (done) ctx.addToast(done, 'success'); await load(); return true; };
  const putOnSite = async () => {
    if (puttingOnSite) return;
    puttingOnSite = true;
    try { await putOnSiteNow(); } finally { puttingOnSite = false; }
  };
  const putOnSiteNow = async () => {
    if (!ctx.createPartner) { location.hash = '#partners'; return; }
    // As it is now, not as this page read it: taken out, renamed or put on the website by a teammate since
    const now = await get(`?org=${encodeURIComponent(v.key)}`);
    if (now.success && (now.org || now.onSite)) { ctx.addToast(`${v.name} is on the website already: someone put it there since this page was read`, 'info'); goTo({ tab: 'people', org: now.org || v.key }); return; }
    if (!now.success && now.status === 404) { ctx.addToast(`${v.name} was taken out since this page was read, so there’s nothing to put on the website. Nothing was made.`, 'error'); if (!left.current) await load(); return; }
    if (!now.success) { ctx.addToast(`Couldn’t check ${v.name} just now: ${now.error} Nothing was made.`, 'error', { label: 'Try again', fn: putOnSite }); return; }
    const o = { name: now.name || v.name, keepAnonymous: !!now.keepAnonymous, anonymousGifts: !!now.anonymousGifts };
    if (o.keepAnonymous || o.anonymousGifts) {
      if (!(await ask({ title: `Put ${o.name} on the website?`, text: o.keepAnonymous ? `${o.name} is kept anonymous. Its name and logo would be on the Partners page for anyone to see.` : `Some of ${o.name}’s gifts were given anonymously. Its name and logo would be on the Partners page for anyone to see.`, yes: 'Put it on the website', careful: true }))) return;
    }
    // A partner card of its exact name already (made here a moment ago, before a step that failed): that one, never a second
    const nk = (x) => String(x || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '');
    const made = (ctx.partners || []).find((p) => nk(p.name) === nk(o.name));
    if (made) {
      if (await ask({ title: `Use the partner card “${made.name}”?`, text: `There’s a partner card with this name already. ${o.name}’s gifts, notes and owner go to it, and it’s on the website after you publish. To make another card instead, rename this organization first.`, yes: 'Use it' })) await finishOnSite(made.slug, o.name);
      return;
    }
    const slug = await ctx.createPartner({ name: o.name });
    if (!slug) return;
    await finishOnSite(slug, o.name, true);
  };
  // Its partner card is made: everything said about it moves to the partner (tried again from the toast if it failed)
  const finishOnSite = async (slug, name = v.name, madeNow = false) => {
    const r = await change({ act: 'website', key: v.key, slug });
    // Refused (taken out, or on the website as another card, since): the card just made says so, never left unmentioned
    if (!r.success && r.status === 409) {
      ctx.addToast(`${r.error}${madeNow && !r.went ? ` The partner card “${name}” was made just before: delete it in Partners if it isn’t wanted.` : ''}`, 'error');
      if (!left.current) await load();
      return;
    }
    if (!r.success) { ctx.addToast(`${name} has a partner card, but its gifts haven’t moved to it yet: ${r.error}`, 'error', { label: 'Try again', fn: () => finishOnSite(slug, name, madeNow) }); return; }
    listChanged();
    ctx.addToast(`${name} is on the Partners page after you publish`, 'success', null, { publish: true });
    // By address: this can finish from a toast after the page was left
    goTo({ tab: 'people', org: r.key });
  };
  const takeOut = async () => {
    if (!(await ask({ title: `Take ${v.name} out?`, text: `Its gifts count for the people who gave them again. Nothing changes in Zeffy.${v.notes?.length || v.owner ? ` Its ${[v.owner ? 'owner' : null, v.notes?.length ? plural(v.notes.length, 'note') : null].filter(Boolean).join(' and ')} ${v.madeFrom ? `go back to ${v.madeFrom.name}, the Zeffy record it was made from.` : 'go with it.'}` : ''}${v.keepAnonymous ? ' It’s kept anonymous: their names show on the board’s list of gifts again, unless they’re kept anonymous themselves.' : ''}`, yes: 'Take it out', danger: true }))) return;
    // (what the question said goes with it: a teammate's note or owner since is never lost unseen)
    const r = await change({ act: 'org-delete', key: v.key, was: { notes: (v.notes || []).map((n) => n.id), owner: v.owner || '' } });
    if (!r.success) { ctx.addToast(r.error, 'error'); if (!left.current) await load(); return; }
    listChanged();
    ctx.addToast(`${v.name} taken out`, 'success');
    if (!left.current) onBack();
  };
  const findNames = async (q) => {
    if (q.trim().length < 2) return [];
    const j = await call('', { find: q.trim() });
    if (!j.success) throw new Error(j.error);
    return (j.names || []).map((x) => ({ id: `${x.kind}:${x.subject}`, ...x, label: x.name, disabled: x.org === v.key,
      sub: [x.kind === 'company' ? 'A company name on gifts' : x.email || 'A Zeffy contact', `${usd(x.cents)} given`, x.org === v.key ? 'already counts here' : x.orgName ? `counts for ${x.orgName} now` : null].filter(Boolean).join(' · ') }));
  };
  return html`
    ${back}
    ${gone ? html`<div class="notice notice--warn" role="alert"><div class="notice__body"><strong>${gone}</strong> This page shows it as it was: copy anything you typed here, then go back.</div></div>` : null}
    <div class="dn-head">
      <h2 tabindex="-1" ref=${heading}>${v.name} ${stageTag(d.stage)} ${orgTag(v)}${v.keepAnonymous ? html`<span class="tag">Kept anonymous</span>` : null}</h2>
      <p class="dn-head__sub">An organization: every gift from the names below counts for it.</p>
    </div>
    <div class="kd-shell"><div class="kd-layout">
      <aside class="kd-rail" aria-label="Organization at a glance">
        <section class="kd-card kd-card--status" aria-labelledby="dn-stage-h">
          <h3 id="dn-stage-h">Stage</h3>
          <p>${stageTag(d.stage)}</p>
          <p class="kd-card__note">${STAGES[d.stage]?.what}</p>
        </section>
        <${OwnerCard} subject=${v.key} owner=${v.owner} staff=${v.staff} name=${v.name} ctx=${ctx} onDone=${load} />
        <section class="kd-card kd-card--health" aria-labelledby="dn-site-h">
          <h3 id="dn-site-h">On the website</h3>
          ${v.onSite ? html`<p>${v.levelLabel} on the Partners page</p>
            <p style="margin:.5rem 0 0"><a class="btn btn-ghost btn-sm" href=${`#partners/${encodeURIComponent(v.slug)}`}>Open its partner card</a></p>
            ${level ? html`<div class="dn-suggest"><p>Gave ${usd(level.cents12)} in the last 12 months: Champion is $10,000 or more.</p>
              <div class="dn-need__do"><button type="button" class="btn btn-primary btn-sm" disabled=${busy} onClick=${async () => { if (await makeChampion(level, ctx)) listChanged(); await load(); }}>Move to Champion…</button>
              <button type="button" class="btn btn-ghost btn-sm" disabled=${busy} onClick=${() => say({ act: 'level', org: v.key, done: false, asked: true }, 'It won’t ask about them again for a year')}>Not now</button></div></div>` : null}`
          : html`<p>Not on the website. Only staff see it here.</p>
            <div class="dn-need__do"><button type="button" class="btn btn-ghost btn-sm" onClick=${putOnSite}>Put it on the website…</button>
              <button type="button" class="btn btn-ghost btn-sm" onClick=${() => setRenaming(true)}>Rename</button>
              <button type="button" class="btn btn-ghost btn-sm" onClick=${takeOut}>Take it out</button></div>`}
          <p class="kd-card__note">Giving in the last 12 months: ${usd(v.cents12)}.</p>
        </section>
        <${KeepAnonymous} subject=${v.key} on=${!!v.keepAnonymous} names=${v.keptNames || []} name=${v.name} ctx=${ctx} onDone=${load} />
        <${HistoryCard} history=${v.history} staff=${v.staff} />
      </aside>
      <div class="kd-main" style="display:grid;gap:1rem">
        <${ThankBox} gifts=${v.gifts} name=${v.name} ctx=${ctx} />
        <section class="card kd-sec" aria-labelledby="dn-giving-h">
          <header class="kd-sec__head"><h3 id="dn-giving-h">Giving</h3></header>
          <${GivingTiles} d=${d} />
        </section>
        <${Notes} subject=${v.key} notes=${v.notes} staff=${v.staff} name=${v.name} ctx=${ctx} onDone=${load} />
        <section class="card kd-sec" aria-labelledby="dn-names-h">
          <header class="kd-sec__head"><h3 id="dn-names-h">Names it gives under</h3>
            <button type="button" class="btn btn-ghost btn-sm" onClick=${() => setAdding(true)}>Add a Zeffy name</button></header>
          ${near.length ? html`<ul class="dn-plain">${near.map((n) => html`<li key=${n.id} class="dn-maybe">Maybe ${n.link === 'company' ? html`“${n.subject}”` : n.name}? <span class="dn-sub">${n.why}, ${usd(n.cents)} given</span>
            <span class="dn-row-do"><button type="button" class="btn btn-primary btn-sm" disabled=${busy} onClick=${() => say({ act: 'link', kind: n.link, subject: n.subject, org: v.key, asked: true }, `Its gifts count for ${v.name} now`)}>Yes, it’s ${v.name}</button>
            <button type="button" class="btn btn-ghost btn-sm" disabled=${busy} onClick=${() => say({ act: 'not', kind: n.link, subject: n.subject, org: v.key, asked: true })}>No</button></span></li>`)}</ul>` : null}
          ${v.names.length ? html`<ul class="dn-plain">${v.names.map((n) => html`<li key=${`${n.kind}:${n.subject}`}><strong>${n.name}</strong>
            <span class="dn-sub">${n.kind === 'company' ? 'A company name on gifts' : n.kind === 'payment' ? 'One gift, counted here by hand' : 'A Zeffy contact'} · ${n.how === 'same name' ? 'the same name, linked by itself' : n.how === 'linked' ? 'linked by a person' : n.how}</span>
            <span class="dn-row-do">${n.kind === 'contact' ? html`<a class="link" href=${zeffyContactUrl(n.subject)} target="_blank" rel="noopener">Open in Zeffy</a>` : null}
              <button type="button" class="link dn-linkbtn" onClick=${() => unlink(n)}>Take off</button></span></li>`)}</ul>`
          : html`<p class="dn-sub">No Zeffy names yet. Add the company name its gifts carry, or the Zeffy contact it gives as.</p>`}
        </section>
        ${v.people.length ? html`<section class="card kd-sec" aria-labelledby="dn-people-h">
          <header class="kd-sec__head"><h3 id="dn-people-h">Who gave for it</h3></header>
          <ul class="dn-plain">${v.people.map((p) => html`<li key=${p.key}>${p.self ? html`<span>${p.name} <span class="dn-sub">(its own record in Zeffy)</span></span>` : html`<a class="link" href=${`#donors/${encodeURIComponent(p.ref)}`}>${p.name}</a>`} <span class="dn-sub">${usd(p.cents)}, ${plural(p.gifts, 'gift')}</span></li>`)}</ul>
        </section>` : null}
        <section class="card kd-sec" aria-labelledby="dn-gifts-h">
          <header class="kd-sec__head"><h3 id="dn-gifts-h">Gifts <span class="count">${v.gifts.length}</span></h3></header>
          <${GiftList} gifts=${v.gifts} byWho=${true} staff=${v.staff} ctx=${ctx} />
        </section>
      </div>
    </div></div>
    ${adding ? html`<${Picker} title=${`Add a Zeffy name to ${v.name}`} sub="A company name its gifts carry, or the Zeffy contact it gives as. Every gift under it counts here." placeholder="Name or email in Zeffy"
      search=${findNames} onClose=${() => setAdding(false)}
      onPick=${async (x) => { const ok = await say({ act: 'link', kind: x.kind, subject: x.subject, org: v.key }, `“${x.name}” counts for ${v.name} now`); return ok; }} />` : null}
    ${renaming ? html`<${RenameDialog} name=${v.name} onClose=${() => setRenaming(false)} onSave=${(name) => say({ act: 'org-rename', key: v.key, name, was: v.name }, 'Renamed')} />` : null}`;
}

/** A new name for an organization kept here (a partner's name is changed in its partner card) */
function RenameDialog({ name, onSave, onClose }) {
  const box = useRef(null);
  const input = useRef(null);
  const [val, setVal] = useState(name);
  const [busy, setBusy] = useState(false);
  useDialog(box, onClose, busy);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  const save = async (e) => {
    e.preventDefault();
    const t = val.trim();
    if (!t || t === name) { onClose(); return; }
    setBusy(true);
    const ok = await onSave(t);
    setBusy(false);
    if (ok !== false) onClose();
  };
  return html`<div class="modal-overlay" onClick=${(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <div class="modal dn-rename" role="dialog" aria-modal="true" aria-labelledby="dn-rename-h" tabindex="-1" ref=${box}><form onSubmit=${save}>
      <h3 id="dn-rename-h">Rename ${name}</h3>
      <p>Only staff see this name. It isn’t on the website.</p>
      <label class="sr-only" for="dn-rename-input">Name</label>
      <input id="dn-rename-input" ref=${input} class="form-input" maxlength="120" value=${val} onInput=${(e) => setVal(e.target.value)} autocomplete="off" />
      <div class="modal-buttons"><button type="button" class="btn btn-ghost" onClick=${onClose} disabled=${busy}>Cancel</button>
        <button type="submit" class="btn btn-primary" disabled=${busy || !val.trim()}>${busy ? html`<span class="spinner spinner-14" />` : null}Save</button></div>
    </form></div></div>`;
}
