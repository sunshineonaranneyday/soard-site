/**
 * Admin → People → Applications: Advisory Board applications
 * ===========================================================================
 * Everyone who applied on /advisory-board/apply/ (and the applications sent
 * to the old Jotform form, brought in once). Each one opens in a panel:
 * how to reach them, every answer by step, where it stands (New, In
 * conversation, Joined, Not now), notes for staff, and Add to Advisory
 * Board, which puts them on People → Advisory (hidden from the public site
 * until staff show them) with their email as their private address, the way
 * Paste a list does, and their headshot as their photo: their sign-in to the
 * advisory page, reveal invites and advisory@ all follow from it, and with the
 * Advisory Board's emails on they're emailed how to sign in.
 *
 * Loaded on first visit from index.html (AdvisoryApplicationsLazy), which
 * passes `kit`: { team, onOpenPerson(slug), onTeamChanged() } (and api and toPersonRecord, which Add no longer
 * needs: the server adds them, functions/api/_advisory-add.js).
 * Server: functions/api/advisory-applications-admin.js.
 */

import { h, htm, useState, useEffect, useRef, useMemo, useCallback } from './vendor.js';
import { photoUrl, PHOTO_GOOD } from './team-shared.js';

const html = htm.bind(h);
const API = '/api/advisory-applications-admin';
const STATUS_COLOR = { new: '#2B6CB0', talking: '#B7791F', joined: '#2F7D4F', 'not-now': '#7C7D84' };
// Filters beside the statuses: Joined ones whose person has left, and New tests (neither counted under a status)
const EXTRA = [{ id: 'left', label: 'Left', hint: 'Joined, and has left the Advisory Board since' }, { id: 'test', label: 'Tests', hint: 'Test applications (their names start with Test)' }];
const NOTE_MAX = 4000; // (the server's: functions/api/_advisory-applications.js NOTE_MAX)
const STATUS_HINT = {
  new: 'Not looked at yet',
  talking: 'You’re talking with them',
  joined: 'On the Advisory Board',
  'not-now': 'Not moving forward for now',
};
const APPLY_PAGE = '/advisory-board/apply/';
/**
 * advisory@soardcharity.com as every box here says it: the group fills in by itself only with the Advisory Board's emails
 * on (functions/api/_advisory-heartbeat.js; Members: "The group fills in by itself once emails are on"), so with them off
 * it's theirs "once Advisory Board emails are on", never now (Advisory Board QA round 23)
 */
const groupAddress = (emailsOn) => `advisory@soardcharity.com${emailsOn ? '' : ' once Advisory Board emails are on'}`;

async function call(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
  let j = {};
  try { j = await r.json(); } catch { j = { success: false, error: 'The site didn’t answer just now. Please try again in a moment.' }; }
  if (!r.ok && j.success !== false) j.success = false;
  j.status = r.status;
  return j;
}

const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const longDate = (iso) => (iso ? new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '');
function ago(iso, now = Date.now()) {
  if (!iso) return '';
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 14) return `${Math.floor(s / 86400)}d ago`;
  return longDate(iso);
}
const work = (a) => [a.jobTitle, a.company].filter(Boolean).join(', ');
/** Their headshot as People shows a photo: a square of `px`, their face in the middle (Cloudflare's transform) */
const headshotSrc = (hs, px) => (hs?.url ? photoUrl({ photo: hs.url, photoSize: hs.width && hs.height ? [hs.width, hs.height] : null }, px) : '');
const list = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
/**
 * Who a new application emails, in words, as the server sends it (_advisory-applications.js staffRecipients): the
 * list, and the committee's members who have an email; with neither, info@soardcharity.com
 */
function whoHears(st) {
  const emails = st.staffEmails || [];
  const reached = (st.committeeMembers || []).filter((m) => m.hasEmail).map((m) => m.name);
  const committee = st.committee && reached.length ? `the ${st.committee} committee (${list(reached)})` : null;
  const all = [...(emails.length > 3 ? [plural(emails.length, 'person', 'people')] : emails), committee].filter(Boolean);
  // many: "hear" (two or more, or "5 people"); one address, or one committee, "hears"
  if (!all.length) return { text: 'info@soardcharity.com (nobody else is set)', many: false };
  return { text: list(all), many: all.length > 1 || emails.length > 3 };
}
// (a sentence that starts with "the … committee" gets its capital; an email address is never changed)
const capital = (t) => t.replace(/^the /, 'The ');
const shown = (a) => (a.preferredName && a.preferredName !== a.name.split(' ')[0] ? `${a.name} (${a.preferredName})` : a.name);

// ─── Styles (prefixed ava-, injected once) ─────────────────────────
const CSS = `
.ava { display: grid; gap: .9rem; min-width: 0; }
.ava > * { min-width: 0; }
.ava-head { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: .6rem 1rem; }
.ava-head.page-header { margin-bottom: 0; }
.ava-head-actions { display: flex; gap: .5rem; flex-wrap: wrap; }
.ava-toolbar { display: flex; flex-wrap: wrap; gap: .5rem .75rem; align-items: center; }
.ava-strip { display: flex; flex-wrap: wrap; gap: .35rem; flex: 1 1 auto; }
.ava-strip button { display: inline-flex; align-items: center; gap: .45rem; min-height: 34px; padding: .2rem .75rem; border: 1px solid var(--color-border); border-radius: 999px; background: var(--color-bg-card); color: var(--color-text-secondary); font: inherit; font-size: var(--fs-xs); font-weight: 600; cursor: pointer; }
.ava-strip button:hover { border-color: var(--color-border-strong); color: var(--color-text); }
.ava-strip button b { color: var(--color-text); font-variant-numeric: tabular-nums; }
.ava-strip button[aria-pressed="true"] { border-color: var(--c, var(--color-text)); background: color-mix(in srgb, var(--c, var(--color-text)) 9%, var(--color-bg-card)); color: var(--color-text); box-shadow: inset 0 0 0 1px var(--c, var(--color-text)); }
.ava-strip button.is-all[aria-pressed="true"] { background: var(--color-text); color: var(--color-bg-card); border-color: var(--color-text); box-shadow: none; }
.ava-strip button.is-all[aria-pressed="true"] b { color: inherit; }
.ava-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--c); flex: none; display: inline-block; }
.ava-search { flex: 0 1 260px; min-width: 0; }
.ava-search input { width: 100%; min-height: 36px; font-size: var(--fs-sm); }
.ava-list { list-style: none; margin: 0; padding: 0; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-card); overflow: hidden; }
.ava-row { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; gap: .35rem .85rem; align-items: center; padding: .8rem 1rem; border-bottom: 1px solid var(--color-border); cursor: pointer; background: none; border-left: 0; border-right: 0; border-top: 0; width: 100%; text-align: left; font: inherit; color: inherit; }
.ava-list li:last-child .ava-row { border-bottom: 0; }
.ava-row:hover { background: var(--color-bg-hover); }
.ava-row:focus-visible { outline: 2px solid var(--color-text); outline-offset: -2px; }
.ava-row.is-new .ava-name::after { content: ''; display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--tone-info-dot); margin-left: .45rem; vertical-align: middle; }
.ava-avatar { position: relative; overflow: hidden; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; font-size: var(--fs-xs); font-weight: 700; color: var(--tone-warn-fg); background: var(--tone-warn-bg); flex: none; }
.ava-avatar img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; background: var(--tone-warn-bg); }
.ava-shot { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
.ava-shot > a { position: relative; display: grid; place-items: center; flex: none; width: 128px; height: 128px; border-radius: 50%; overflow: hidden; background: var(--tone-warn-bg); color: var(--tone-warn-fg); font-weight: 700; font-size: var(--fs-lg); text-decoration: none; }
.ava-shot > a img { position: absolute; inset: 0; display: block; width: 100%; height: 100%; object-fit: cover; }
.ava-shot > a img[hidden] { display: none; } /* (one that didn't load: their initials show) */
.ava-full { display: inline-flex; align-items: center; min-height: 32px; }
.ava-note { padding: .55rem .75rem; border-radius: var(--radius-sm, 8px); background: var(--tone-warn-bg); color: var(--tone-warn-fg); font-size: var(--fs-sm); }
.ava-compare { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: .5rem 1rem; margin: .25rem 0 .75rem; font-size: var(--fs-sm); }
.ava-compare dt { color: var(--color-text-muted); }
.ava-compare dd { margin: 0; overflow-wrap: anywhere; display: flex; gap: .6rem; align-items: center; }
.ava-face { position: relative; flex: none; width: 40px; height: 40px; border-radius: 50%; overflow: hidden; display: grid; place-items: center; background: var(--tone-warn-bg); color: var(--tone-warn-fg); font-size: var(--fs-xs); font-weight: 700; }
.ava-face img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.ava-dialog p, .ava-dialog li, .ava-dialog dd { overflow-wrap: anywhere; }
@media (max-width: 600px) {
  .ava-dhead .ava-close { width: 44px; height: 44px; }
  .ava-strip button { min-height: 44px; }
  .ava-dhead p { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .ava-dhead h2 { overflow-wrap: break-word; hyphens: auto; }
  .ava-full { min-height: 44px; }
  .ava-contact dd a { display: inline-flex; align-items: center; min-height: 44px; }
  .ava-search input { min-height: 44px; }
  .ava .btn, .ava-drawer .btn, .ava-dialog .btn, .ava-dialog select { min-height: 44px; }
  .ava-head .page-sub a { display: inline-block; padding: 12px 0; margin: -12px 0; }
  .ava-picks .ava-pick { width: 100%; justify-content: center; }
}
.ava-note-count { margin: 0; font-size: var(--fs-xs); color: var(--color-text-muted); }
.ava-note-count.is-over { color: var(--tone-warn-fg); font-weight: 600; }
.ava-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.ava-shot p { margin: 0 0 .3rem; font-size: var(--fs-sm); color: var(--color-text-secondary); }
.ava-shot .is-soft { color: var(--tone-warn-fg); }
.ava-who { min-width: 0; display: grid; gap: .1rem; }
.ava-name { font-weight: 650; font-size: var(--fs-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ava-sub { font-size: var(--fs-xs); color: var(--color-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ava-why { font-size: var(--fs-xs); color: var(--color-text-secondary); overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; }
.ava-meta { display: grid; justify-items: end; gap: .3rem; }
.ava-when { font-size: var(--fs-2xs); color: var(--color-text-muted); white-space: nowrap; }
.ava-pill { display: inline-flex; align-items: center; gap: .35rem; font-size: var(--fs-2xs); font-weight: 650; padding: 3px 9px 3px 7px; border-radius: 999px; background: color-mix(in srgb, var(--c) 12%, white); color: color-mix(in srgb, var(--c) 80%, black); border: 1px solid color-mix(in srgb, var(--c) 28%, white); white-space: nowrap; }
.ava-pill::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: var(--c); }
.ava-tag { display: inline-flex; align-items: center; min-height: 20px; padding: .1rem .5rem; border-radius: 999px; background: var(--tone-neutral-bg); color: var(--tone-neutral-fg); font-size: var(--fs-2xs); font-weight: 600; white-space: nowrap; }
/* Empty, nobody matching, a load that failed: the admin's empty card */
.ava-zero { padding: 2.25rem 1.5rem; text-align: center; font-size: var(--fs-sm); line-height: 1.5; color: var(--color-text-secondary); border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-card); box-shadow: var(--shadow-sm); }
.ava-zero strong { display: block; margin-bottom: .25rem; font-size: var(--fs-base); font-weight: 600; color: var(--color-text); }
.ava-zero .btn { margin-top: .9rem; }

body.ava-drawer-open .toast-container { z-index: 1350; }
.ava-scrim { position: fixed; inset: 0; background: rgba(26,27,31,.36); z-index: 1200; animation: ava-fade .18s ease-out; }
.ava-drawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(760px, 100vw); background: var(--color-bg); z-index: 1201; box-shadow: var(--shadow-lg); display: flex; flex-direction: column; animation: ava-in .26s cubic-bezier(.2,.8,.2,1); }
.ava-drawer:focus { outline: none; }
@keyframes ava-in { from { transform: translateX(28px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes ava-fade { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .ava-drawer, .ava-scrim { animation: none; } }
.ava-dhead { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: .3rem .85rem; align-items: center; padding: .9rem 1.1rem; background: var(--color-bg-card); border-bottom: 1px solid var(--color-border); }
.ava-dhead .ava-avatar { width: 46px; height: 46px; font-size: var(--fs-sm); }
.ava-dhead h2 { margin: 0; font-size: var(--fs-lg); line-height: 1.25; font-family: inherit; text-transform: none; letter-spacing: -.01em; color: var(--color-text); overflow-wrap: anywhere; }
.ava-dhead p { margin: .15rem 0 0; font-size: var(--fs-xs); color: var(--color-text-secondary); }
.ava-close { width: 40px; height: 40px; display: inline-grid; place-items: center; border-radius: 10px; border: 1px solid var(--color-border); background: var(--color-bg-card); cursor: pointer; color: var(--color-text); }
.ava-close:hover { background: var(--color-bg-hover); }
.ava-close:focus-visible { outline: 2px solid var(--color-text); outline-offset: 1px; }
.ava-dbody { flex: 1; overflow-y: auto; padding: 1rem 1.1rem 2rem; display: grid; gap: .9rem; align-content: start; }
.ava-panel { background: var(--color-bg-card); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: .9rem 1rem; display: grid; gap: .6rem; }
.ava-panel h3 { margin: 0; font-size: var(--fs-2xs); text-transform: uppercase; letter-spacing: .05em; color: var(--color-text-secondary); }
.ava-actions { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; }
.ava-status { display: flex; flex-wrap: wrap; gap: .35rem; }
.ava-status button { display: inline-flex; align-items: center; gap: .4rem; min-height: 38px; padding: .3rem .8rem; border-radius: 999px; border: 1px solid var(--color-border); background: var(--color-bg-card); font: inherit; font-size: var(--fs-xs); font-weight: 600; color: var(--color-text-secondary); cursor: pointer; }
.ava-status button[aria-pressed="true"] { color: var(--color-text); border-color: var(--c); background: color-mix(in srgb, var(--c) 10%, var(--color-bg-card)); box-shadow: inset 0 0 0 1px var(--c); }
.ava-status button:focus-visible { outline: 2px solid var(--color-text); outline-offset: 1px; }
.ava-contact { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: .35rem .9rem; margin: 0; font-size: var(--fs-sm); }
.ava-contact dt { color: var(--color-text-muted); font-size: var(--fs-xs); padding-top: .1rem; }
.ava-contact dd { margin: 0; overflow-wrap: anywhere; white-space: pre-line; }
.ava-contact a { color: var(--color-text); }
.ava-qa { display: grid; gap: .75rem; }
.ava-q { font-size: var(--fs-xs); color: var(--color-text-muted); margin: 0 0 .15rem; line-height: 1.4; }
.ava-a { margin: 0; font-size: var(--fs-sm); line-height: 1.55; white-space: pre-line; overflow-wrap: anywhere; }
.ava-a.is-flag { color: var(--tone-warn-fg); background: var(--tone-warn-surface); border: 1px solid var(--tone-warn-line-strong); border-radius: 8px; padding: .35rem .55rem; justify-self: start; }
.ava-notes { list-style: none; margin: 0; padding: 0; display: grid; gap: .5rem; }
.ava-notes li { border-left: 3px solid var(--color-border-strong); padding: .1rem 0 .1rem .7rem; font-size: var(--fs-sm); white-space: pre-line; overflow-wrap: anywhere; }
.ava-notes small { display: block; color: var(--color-text-muted); font-size: var(--fs-2xs); margin-top: .15rem; }
.ava-note-form { display: grid; gap: .45rem; }
.ava-note-form textarea { min-height: 70px; }
.ava-note-form .btn { justify-self: end; }
.ava-foot { display: flex; justify-content: space-between; flex-wrap: wrap; gap: .5rem; align-items: center; font-size: var(--fs-xs); color: var(--color-text-muted); }
.ava-callout { font-size: var(--fs-xs); border-radius: 10px; padding: .6rem .75rem; background: var(--color-bg-secondary); border: 1px solid var(--color-border); color: var(--color-text-secondary); }
.ava-callout.is-good { background: var(--tone-success-surface); border-color: var(--tone-success-line); color: var(--tone-success-fg); }
.ava-overlay { z-index: 1300; }
.ava-dialog .kd-dialog__body > p { margin: 0 0 .75rem; font-size: var(--fs-sm); line-height: 1.55; color: var(--color-text-secondary); }
.ava-dialog .kd-dialog__body > p:last-child { margin-bottom: 0; }
.ava-dialog ul { margin: .25rem 0 .75rem 1.1rem; font-size: var(--fs-sm); line-height: 1.55; }
/* Several people it could be: each choice in the box with what it does, the box scrolling, never cut off below */
.ava-dialog ul.ava-picks { list-style: none; margin: .25rem 0 .75rem; padding: 0; display: grid; gap: .85rem; }
.ava-picks .ava-pick { white-space: normal; text-align: left; min-height: 44px; }
.ava-picks p { margin: .35rem 0 0; color: var(--color-text-secondary); }
@media (max-width: 640px) {
  .ava-row { grid-template-columns: 40px minmax(0, 1fr); }
  .ava-meta { grid-column: 2; justify-items: start; grid-auto-flow: column; justify-content: start; align-items: center; gap: .5rem; }
  .ava-search { flex: 1 1 100%; }
  .ava-dhead { padding: .75rem .8rem; }
  .ava-dbody { padding: .8rem .8rem 2rem; }
  .ava-contact { grid-template-columns: 1fr; gap: .1rem; }
  .ava-contact dd { margin-bottom: .45rem; }
  .ava-status button, .ava-actions .btn { min-height: 44px; }
}
`;
let _cssDone = false;
function injectCss() {
  if (_cssDone) return;
  const el = document.createElement('style');
  el.textContent = CSS;
  document.head.appendChild(el);
  _cssDone = true;
}

const Pill = ({ status, label }) => html`<span class="ava-pill" style=${`--c:${STATUS_COLOR[status] || '#7C7D84'}`}>${label}</span>`;
// Their headshot when there is one, over their initials (which show if the picture doesn't load)
const Avatar = ({ a, px = 40 }) => html`<span class="ava-avatar" style=${`--c:${STATUS_COLOR[a.status]}`} aria-hidden="true">${initials(a.name)}${a.headshot?.url
  ? html`<img src=${headshotSrc(a.headshot, px * 2)} alt="" width=${px} height=${px} loading="lazy" decoding="async" onError=${(e) => { e.currentTarget.hidden = true; }} />` : null}</span>`;

/** The admin's shared dialog (its kd-dialog classes): title and ✕, body, footer.
 *  Escape and the scrim close it (not while it works); Tab stays inside; focus goes
 *  back where it was. A [data-autofocus] element gets the focus first. */
let dlgSeq = 0;
function Dialog({ title, sub = '', children, footer = null, onClose, busy = false, size = 'md' }) {
  const ref = useRef(null);
  const idRef = useRef(null);
  if (!idRef.current) idRef.current = `ava-dlg-${++dlgSeq}`;
  const live = useRef({ busy, onClose });
  live.current = { busy, onClose };
  useEffect(() => {
    const prev = document.activeElement;
    document.body.classList.add('modal-open');
    const onKey = (e) => {
      if (e.key === 'Escape') { if (!live.current.busy) { e.preventDefault(); e.stopPropagation(); live.current.onClose(); } return; }
      if (e.key !== 'Tab') return;
      const f = [...(ref.current?.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])') || [])].filter((el) => el.getClientRects().length);
      if (!f.length) return;
      const inside = ref.current.contains(document.activeElement);
      if (e.shiftKey && (!inside || document.activeElement === f[0])) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && (!inside || document.activeElement === f[f.length - 1])) { e.preventDefault(); f[0].focus(); }
    };
    window.addEventListener('keydown', onKey, true);
    requestAnimationFrame(() => (ref.current?.querySelector('[data-autofocus], .kd-dialog__body textarea, .kd-dialog__body input, .kd-dialog__foot .btn-primary') || ref.current)?.focus());
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (document.querySelectorAll('.modal-overlay').length <= 1) document.body.classList.remove('modal-open');
      if (prev?.isConnected) prev.focus?.();
    };
  }, []);
  const id = idRef.current;
  return html`<div class="modal-overlay kd-overlay ava-overlay" onClick=${(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <div class=${`modal kd-dialog kd-dialog--${size} ava-dialog`} role="dialog" aria-modal="true" aria-labelledby=${id} ref=${ref} tabindex="-1">
      <div class="kd-dialog__head">
        <div class="kd-dialog__titles"><h2 id=${id}>${title}</h2>${sub ? html`<p class="kd-dialog__sub">${sub}</p>` : null}</div>
        <button type="button" class="kd-x" aria-label="Close" onClick=${onClose} disabled=${busy}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>
      <div class="kd-dialog__body" tabindex="0" role="group" aria-labelledby=${id}>${children}</div>
      ${footer ? html`<div class="kd-dialog__foot">${footer}</div>` : null}
    </div>
  </div>`;
}

// ─── The area ───────────────────────────────────────────────────────

export function AdvisoryApplications({ addToast, kit = {} }) {
  injectCss();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [filter, setFilter] = useState('');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState(() => (location.hash.match(/^#advisory-applications\/(adv-[0-9a-z-]+)/) || [])[1] || null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const navFrom = useRef(null); // up or down pressed: the next panel opens with the keys on that button again

  const load = useCallback(async () => {
    const j = await call(API);
    if (!j.success) { setErr(j.error || 'Couldn’t load the applications'); return; }
    setErr(null);
    setData(j);
    if (j.imported) addToast?.(`${plural(j.imported, 'application')} from the old form ${j.imported === 1 ? 'is' : 'are'} here now.`, 'info');
  }, []);
  useEffect(() => { load(); }, [load]);

  const open = (id) => {
    setOpenId(id);
    const base = location.hash.startsWith('#advisory-applications') || !id ? '#advisory-applications' : null;
    if (base) history.replaceState(null, '', `${location.pathname}${location.search}${id ? `${base}/${id}` : base}`);
  };

  const apps = data?.applications || [];
  // (a test is never New, as the tab's badge has it)
  // (a Joined one whose person has left the Advisory Board, or was deleted from People, isn't counted as Joined)
  const inStatus = (a, st) => (st === 'left' ? !!a.left : st === 'test' ? a.isTest && a.status === 'new'
    : a.status === st && !(st === 'new' && a.isTest) && !(st === 'joined' && a.left));
  const counts = useMemo(() => Object.fromEntries([...(data?.statuses || []), ...EXTRA].map((s) => [s.id, apps.filter((a) => inStatus(a, s.id)).length])), [data]);
  const ql = q.trim().toLowerCase();
  // The one open stays on the list while it's open (its status changed under a filter: still there, up and down still work)
  const list = apps.filter((a) => a.id === openId || ((!filter || inStatus(a, filter))
    && (!ql || [a.name, a.preferredName, a.company, a.jobTitle, a.email].some((v) => String(v || '').toLowerCase().includes(ql)))));
  const statusLabel = (id) => (data?.statuses || []).find((s) => s.id === id)?.label || id;

  // (left: as the server says now, so one brought back stops being Left without a reload)
  const replace = (app) => setData((d) => d && { ...d, applications: d.applications.map((x) => (x.id === app.id ? { ...x, ...app, left: !!app.left, notes: Array.isArray(app.notes) ? app.notes.length : app.notes } : x)) });
  const drop = (id) => setData((d) => d && { ...d, applications: d.applications.filter((x) => x.id !== id) });
  // After a delete: the keys on the row that took its place (else the last), not lost with the row that went
  const refocus = useRef(null);
  useEffect(() => {
    if (refocus.current == null) return;
    const at = refocus.current;
    refocus.current = null;
    requestAnimationFrame(() => {
      const rows = document.querySelectorAll('.ava-list .ava-row');
      (rows[Math.min(at, rows.length - 1)] || document.querySelector('.ava-search input') || document.querySelector('.ava-head-actions button'))?.focus();
    });
  }, [data]);

  if (err && !data) return html`<div class="ava"><div class="ava-zero"><strong>Couldn’t load the applications</strong>${err}<div><button class="btn btn-ghost btn-sm" onClick=${load}>Try again</button></div></div></div>`;
  if (!data) return html`<div class="ava"><div class="area-loading" aria-label="Loading the applications"><span class="spinner" /></div></div>`;

  const idx = list.findIndex((a) => a.id === openId);
  const hears = whoHears(data.settings);
  // Closed: the keys back on its row, or (a filter took it off the list) on the list
  // (an application found deleted while its panel was open: where its row was, for the keys once the panel closes)
  const goneAt = useRef(null);
  const backToList = (was) => requestAnimationFrame(() => {
    const rows = document.querySelectorAll('.ava-list .ava-row');
    const at = goneAt.current?.id === was ? goneAt.current.at : null;
    goneAt.current = null;
    (document.querySelector(`.ava-row[data-id="${was}"]`) || (at != null ? rows[Math.min(at, rows.length - 1)] : null) || document.querySelector('.ava-list .ava-row') || document.querySelector('.ava-search input') || document.querySelector('.ava-head-actions button'))?.focus();
  });
  return html`<div class="ava">
    <div class="page-header ava-head">
      <div>
        <h2>Advisory Board applications</h2>
        <p class="page-sub">From the <a href=${APPLY_PAGE} target="_blank" rel="noopener">Apply page</a>. Each applicant gets a copy of what they sent. ${capital(hears.text)} ${hears.many ? 'hear' : 'hears'} about each one by email, and it’s posted in Slack.</p>
      </div>
      <div class="ava-head-actions">
        <button class="btn btn-ghost btn-sm" onClick=${() => setSettingsOpen(true)}>Who hears about them</button>
      </div>
    </div>

    ${apps.length > 0 && html`<div class="ava-toolbar">
      <div class="ava-strip" role="group" aria-label="Show">
        <button class="is-all" aria-pressed=${!filter} onClick=${() => setFilter('')}>All <b>${apps.length}</b></button>
        ${(data.statuses || []).map((s) => html`<button key=${s.id} style=${`--c:${STATUS_COLOR[s.id]}`} aria-pressed=${filter === s.id} title=${STATUS_HINT[s.id]}
          onClick=${() => setFilter((f) => (f === s.id ? '' : s.id))}><span class="ava-dot"></span>${s.label} <b>${counts[s.id] || 0}</b></button>`)}
        ${EXTRA.filter((x) => counts[x.id] || filter === x.id).map((x) => html`<button key=${x.id} style="--c:#7C7D84" aria-pressed=${filter === x.id} title=${x.hint}
          onClick=${() => setFilter((f) => (f === x.id ? '' : x.id))}><span class="ava-dot"></span>${x.label} <b>${counts[x.id] || 0}</b></button>`)}
      </div>
      <label class="ava-search"><input class="form-input" type="search" placeholder="Search name, company, email" aria-label="Search applications" value=${q} onInput=${(e) => setQ(e.target.value)} /></label>
    </div>`}

    ${apps.length === 0 ? html`<div class="ava-zero"><strong>No applications yet</strong>When someone applies on the <a href=${APPLY_PAGE} target="_blank" rel="noopener">Advisory Board’s Apply page</a>, it shows here, and you get an email and a Slack post.</div>`
      : list.length === 0 ? html`<div class="ava-zero"><strong>Nobody matches</strong><button class="btn btn-ghost btn-sm" onClick=${() => { setFilter(''); setQ(''); }}>Show everyone</button></div>`
      : html`<ul class="ava-list">
        ${list.map((a) => html`<li key=${a.id}><button class=${`ava-row ${a.status === 'new' && !a.isTest ? 'is-new' : ''}`} data-id=${a.id} onClick=${() => open(a.id)}>
          <${Avatar} a=${a} />
          <span class="ava-who">
            <span class="ava-name">${shown(a)}</span>
            <span class="ava-sub">${work(a) || a.email || ''}</span>
            ${a.why && html`<span class="ava-why">${a.why}</span>`}
          </span>
          <span class="ava-meta">
            ${a.left ? html`<span class="ava-pill" style="--c:#7C7D84" title="Joined, and has left the Advisory Board since">Left</span>` : html`<${Pill} status=${a.status} label=${statusLabel(a.status)} />`}
            <span class="ava-when" title=${longDate(a.createdAt)}>${a.isTest ? html`<span class="ava-tag" title="A test: its email went only to the address on it">Test</span> ` : ''}${a.source === 'jotform' ? html`<span class="ava-tag" title="Sent before the website form">Earlier form</span> ` : ''}${ago(a.createdAt)}</span>
          </span>
        </button></li>`)}
      </ul>`}

    ${openId && html`<${Drawer} key=${openId} id=${openId} statuses=${data.statuses} kit=${kit} addToast=${addToast} boardEmails=${!!data.boardEmails} startOn=${navFrom.current}
      onClose=${() => { const was = openId; navFrom.current = null; open(null); backToList(was); }}
      onPrev=${idx > 0 ? () => { navFrom.current = 'prev'; open(list[idx - 1].id); } : null}
      onNext=${idx >= 0 && idx < list.length - 1 ? () => { navFrom.current = 'next'; open(list[idx + 1].id); } : null}
      onChanged=${replace} onRemoved=${(rid) => { refocus.current = Math.max(0, list.findIndex((a) => a.id === rid)); drop(rid); open(null); }}
      onGone=${(rid) => { goneAt.current = { id: rid, at: Math.max(0, list.findIndex((a) => a.id === rid)) }; drop(rid); }} />`}
    ${settingsOpen && html`<${SettingsDialog} settings=${data.settings} addToast=${addToast} onClose=${() => setSettingsOpen(false)}
      onSaved=${(s) => { setData((d) => ({ ...d, settings: s })); setSettingsOpen(false); }} />`}
  </div>`;
}

// ─── Add to Advisory Board: the confirm box, from the server's plan ─

/**
 * What Add will do, said before anything changes (functions/api/_advisory-add.js addPlan), every part of it:
 *   new      a new person on People → Advisory
 *   same     the person found by their email (or already linked): linked, nothing of theirs replaced
 *   choose   someone on People → Advisory has their name: the same person, or a different one (each says all it does)
 *   blocked  their email is someone's elsewhere on People, or the person is In memoriam: nobody can be added
 *   joined   already done
 * An email the sign-in can't use (plan.emailUsable false, an old application's) is never saved: said so.
 */
/**
 * Someone on People as a choice says them: their name, and when another choice has the same name, what tells them apart
 * (their organization, a former or current member, their email, else their People address), so no two buttons read alike
 */
function labelOf(x, list) {
  const key = (y) => String(y.name || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const twins = list.filter((y) => key(y) === key(x));
  if (twins.length < 2) return x.name;
  const ways = [(y) => y.organization, (y) => (y.status === 'alumni' ? 'a former member' : 'a current member'), (y) => y.email, (y) => y.slug];
  const way = ways.find((f) => { const v = twins.map((y) => String(f(y) || '').trim().toLowerCase()); return v.every(Boolean) && new Set(v).size === v.length; }) || ways[3];
  return `${x.name} (${way(x)})`;
}

function AddDialog({ app, plan, shot, soft, boardEmails, busy, onAdd, onClose }) {
  const p = plan.person || {};
  const appEmail = String(app.email || '').toLowerCase();
  const email = plan.emailUsable === false ? '' : appEmail; // the one they'd sign in with
  // Their email on file can't sign them in as themselves (a SOARD address, a group inbox): said, and it's never "kept
  // as their sign-in" or emailed how to sign in
  const fileOkOf = (x) => !!x.email && x.emailOk !== false;
  const fileOk = fileOkOf(p);
  // (a sign-in email that waits for their own address waits for Advisory Board emails too while they're off: one fact,
  // as the toast after the press says it, Advisory Board QA round 25)
  const offToo = boardEmails ? '' : ' and Advisory Board emails are turned on';
  const onFileOf = (x, many = false) => (x.email && !fileOkOf(x) ? html`<p class="ava-note">${many ? `${x.name}’s` : 'Their'} email on file, <strong>${x.email}</strong>, ${x.emailWhy === 'group'
    ? 'is a SOARD group inbox: everyone in the group reads it, so it can’t sign them in.'
    : x.emailWhy === 'staff' ? 'is a SOARD address, which signs in as staff, never as an Advisory Board member.' : 'can’t be used to sign in.'} Put their own on their People page: their sign-in email goes once it’s there${offToo}.</p>` : null);
  const onFile = onFileOf(p);
  // This application's email the sign-in can't use: said where it matters (never beside one of theirs that's kept)
  const unusable = plan.emailUsable === false && appEmail && appEmail !== p.email && !(plan.kind === 'same' && p.email)
    ? html`<p class="ava-note">${plan.emailWhy === 'group'
      ? html`<strong>${appEmail}</strong> is a SOARD group inbox: everyone in the group reads it, so it can’t be their sign-in email and isn’t saved.`
      : plan.emailWhy === 'staff' ? html`<strong>${appEmail}</strong> ${plan.emailAs ? html`signs in as <strong>${plan.emailAs}</strong>, a SOARD address, which` : 'is a SOARD address, which'} signs in as staff, never as an Advisory Board member, so it isn’t saved.`
        : html`This application’s email, <strong>${appEmail}</strong>, can’t be used to sign in, so it isn’t saved.`} ${plan.kind === 'choose' && p.email
      ? 'As a different person, they’d need their own on their People page to sign in and get reveal invites.'
      : `Add their own on their People page so they can sign in and get reveal invites: their sign-in email goes once it’s there${offToo}.`}</p>` : null;
  const softLine = soft && shot ? html`<p class="ava-note">Their headshot is ${shot.width} × ${shot.height} pixels, so it may look a little soft on the site.</p>` : null;
  const advisoryAt = groupAddress(boardEmails);
  // The address a choice leaves them signing in with ('': none): the same person's, kept when it can sign them in, else
  // this application's saved when it can be used (sameParts); someone new's, this application's when it can (newParts)
  const signInOf = (x) => (x.email ? (fileOkOf(x) ? x.email : '') : email);
  // A test (its name starts with Test): adding it makes a real Advisory Board member, so it's said first, with what they
  // get from the same facts as the rest of the box: reveal invites only with an email they'll sign in with, advisory@
  // only with that and Advisory Board emails on (Advisory Board QA round 24: it promised both beside "needs a working
  // email on their People page" and "isn't saved"). ins: the sign-in each choice in the box leaves them with
  const testLine = (ins) => {
    if (!app.isTest) return null;
    const off = boardEmails ? '' : ' (and advisory@ only once Advisory Board emails are on)';
    const gets = ins.every(Boolean) ? `who gets reveal invites and the emails to ${advisoryAt}`
      : !ins.some(Boolean) ? `who gets neither reveal invites nor the emails to advisory@soardcharity.com until a working email is on their People page${off}`
        : `who gets reveal invites and the emails to advisory@soardcharity.com only with a working email on their People page${off}`;
    return html`<p class="ava-note"><strong>This looks like a test application</strong> (its name starts with “Test”). Adding it makes a real Advisory Board member ${gets}. If it was only a test, cancel and delete the application instead.</p>`;
  };
  // Their sign-in email: now with the emails on, else once they're on; never again to someone who's had it
  const welcomes = (to, had = false) => (!to || had ? '' : boardEmails ? `emails ${to} how to sign in to the Advisory Board page` : `emails ${to} how to sign in once Advisory Board emails are turned on (they’re off now)`);
  const welcomeLine = (to, had) => { const w = welcomes(to, had); return w ? html`<li>${w},</li>` : null; };
  const face = (src, name) => html`<span class="ava-face">${initials(name)}${src ? html`<img src=${src} alt="" width="40" height="40" loading="lazy" onError=${(e) => { e.currentTarget.hidden = true; }} />` : null}</span>`;
  const press = (as, to = null) => () => { if (!busy) onAdd(as, to); };
  const wait = busy ? 'true' : null;
  const cancel = html`<button class="btn btn-ghost" data-autofocus onClick=${() => { if (!busy) onClose(); }} aria-disabled=${wait}>${plan.busy || plan.kind === 'blocked' || plan.kind === 'joined' ? 'Close' : 'Cancel'}</button>`;
  const statusLine = app.status === 'not-now' ? html`<p class="ava-note">This application is marked Not now${app.statusBy ? `, by ${app.statusBy}` : ''}.</p>` : null;
  const who = (x) => [x.where, x.email || 'no email on file', x.organization, x.status === 'alumni' ? 'a former member' : null].filter(Boolean).join(' · ');
  // A box opened again with a different answer (a press that stopped partway): the keys back on Cancel
  const firstPlan = useRef(true);
  const wasBusy = useRef(!!plan.busy);
  useEffect(() => {
    const fromWait = wasBusy.current && !plan.busy;
    const still = wasBusy.current && !!plan.busy;
    wasBusy.current = !!plan.busy;
    if (firstPlan.current) { firstPlan.current = false; return; }
    if (still && !plan.stuck) return; // (asked again, still waiting: the keys stay put, nothing said over and over)
    requestAnimationFrame(() => {
      const head = document.querySelector('.ava-dialog h2');
      // (the wait over, or taking longer: what the box says now is heard, from its heading)
      if ((fromWait || plan.stuck) && head) { head.setAttribute('tabindex', '-1'); head.focus(); return; }
      document.querySelector('.ava-dialog [data-autofocus]')?.focus();
    });
  }, [plan]);

  if (plan.busy) {
    // (a press from another application: adding someone on People this applicant could be, or someone with this name)
    const other = !!plan.busyOther;
    if (plan.busyDeleting) {
      return html`<${Dialog} title="This application is being deleted" onClose=${onClose} footer=${cancel}>
        <p role="status">${plan.stuck ? 'It’s taking longer than it should. Close this and look again in a minute.'
          : 'It’s being deleted in another tab, or by someone else. This box closes if it goes, and shows what Add does if it doesn’t.'}</p>
      <//>`;
    }
    if (plan.busyEditing && plan.busyGone) {
      // (theirs, or someone they could be, being deleted on People; or the record at the address they'd get, which the
      // delete frees: said as a delete, as the press says it, never "being changed")
      const address = plan.busyEditing === 'address';
      return html`<${Dialog} title=${address ? 'The web address they’d get is being freed' : plan.busyName ? `${plan.busyName} is being deleted on People` : 'A People record is being deleted'} onClose=${onClose} footer=${cancel}>
        <p role="status">${plan.stuck ? 'It’s taking longer than it should. Close this and press Add to Advisory Board again in a minute.'
          : address ? 'The web address this box would give them is being freed by a delete on People right now. Look again once that’s done.'
            : `${plan.busyName || 'That person'} is being deleted on People right now. Look again once that’s done.`}</p>
      <//>`;
    }
    if (plan.busyEditing) {
      // (theirs, or someone they could be, being renamed; or another record taking the address they'd get)
      const address = plan.busyEditing === 'address';
      return html`<${Dialog} title=${address ? 'The web address they’d get is being used on People' : plan.busyName ? `${plan.busyName}’s People record is being changed` : 'A People record is being changed'} onClose=${onClose} footer=${cancel}>
        <p role="status">${plan.stuck ? 'It’s taking longer than it should. Close this and press Add to Advisory Board again in a minute.'
          : address ? 'Someone is changing a People record to the web address this box would give them, right now. This box shows what Add does as soon as that’s done.'
            : `Someone is changing ${plan.busyName ? `${plan.busyName}’s` : 'that'} People record right now (its web address). This box shows what Add does as soon as that’s done.`}</p>
      <//>`;
    }
    return html`<${Dialog} title=${`Someone is adding ${(other && plan.busyName) || app.name} right now`} onClose=${onClose} footer=${cancel}>
      <p role="status">${plan.stuck ? 'It’s taking longer than it should. Close this and press Add to Advisory Board again in a minute: it finishes whatever stopped partway, and never adds them twice.'
        : other ? `Another press is adding ${plan.busyName ? `${plan.busyName}, who this could be,` : 'someone new with this name'} to the Advisory Board from another application (in another tab, or by someone else). This box shows what’s left as soon as it’s done.`
          : 'Another press (in another tab, or by someone else) is adding them. This box shows what’s left as soon as it’s done.'}</p>
    <//>`;
  }
  if (plan.kind === 'blocked' && plan.why === 'memorial') {
    return html`<${Dialog} title=${`${app.name} can’t be added`} onClose=${onClose} footer=${cancel}>
      <p>${p.name} is In memoriam on People → Advisory, so nobody can be added from this application.</p>
      <p>If this is someone else, add them by hand on People → Advisory.</p>
    <//>`;
  }
  if (plan.kind === 'blocked') {
    return html`<${Dialog} title=${`${app.name} can’t be added`} onClose=${onClose} footer=${cancel}>
      <p><strong>${app.email}</strong> is ${p.name}’s email on ${p.where}. Each person signs in with their own email, so nobody can be added with it.</p>
      <p>If ${p.name} is moving to the Advisory Board, change their group on their People page first, then press Add to Advisory Board again.</p>
    <//>`;
  }
  if (plan.kind === 'joined') {
    return html`<${Dialog} title=${`${app.name} is on the Advisory Board`} onClose=${onClose} footer=${cancel}>
      <p>This application is already linked to ${p.name} on People → Advisory.</p>
    <//>`;
  }
  // The same person, in words: what changes for them (sign-in, invites and advisory@ only when they didn't have them)
  // (what here rests on the headshot or the emails switch is in the plan's key: _advisory-add.js shotSaid, switchSaid)
  const sameParts = (x = p) => {
    const restored = x.status === 'alumni';
    const ok = fileOkOf(x);
    const signIn = signInOf(x); // kept, or saved ('': none that signs them in)
    const gains = restored || (!x.email && !!email); // newly on the sign-in, invites and advisory@
    return [
      `links this application to ${x.name}`,
      restored ? 'makes them active on the Advisory Board again (they’re a former member): back on the Advisory Board page for the other members, and hidden from the public site until you turn on Show on the site' : '',
      !x.hasPhoto && shot ? 'makes this headshot their photo (they have none)' : '',
      ok ? `keeps ${x.email} as their sign-in email` : !x.email && email ? `saves ${email} as their sign-in email` : '',
      gains && signIn ? 'lets them sign in to the Advisory Board page' : '',
      gains && signIn ? 'puts them on every reveal invite' : '',
      gains && signIn ? `puts them on ${advisoryAt}` : '',
      welcomes(signIn, x.welcomed),
    ].filter(Boolean);
  };
  const newParts = () => [
    `adds ${plan.asName || app.name} to People → Advisory as someone new${app.company ? `, at ${app.company}` : ''}${shot ? ', with this headshot as their photo' : ''}`,
    email ? `lets them sign in to the Advisory Board page with ${email}` : 'needs a working email on their People page before they can sign in or get invites',
    welcomes(email),
    email ? 'puts them on every reveal invite' : '',
    email ? `puts them on ${advisoryAt}` : '',
    'shows them to the other Advisory Board members on the Advisory Board page',
    'keeps them off the public site until you turn on Show on the site',
  ].filter(Boolean);
  const sentence = (parts) => `${parts.length > 1 ? `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}` : parts[0]}.`;
  const firstUp = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t); // (a choice's words under its button, as a sentence)

  if (plan.kind === 'choose') {
    const theirs = p.email && appEmail ? 'Their email on file isn’t the one on this application' : p.email ? 'This application has no email' : 'They have no email on file';
    // (more than one on People → Advisory could be them: each is shown, and staff say which, or someone new)
    const all = [p, ...(plan.others || [])];
    const many = all.length > 1;
    // (two with one name: each said with what tells them apart, so no two buttons read the same)
    const label = (x) => labelOf(x, all);
    // (one: the choice in the foot; several: each in the box with what it does, so however many and however long their
    // names, every one can be reached, on a phone too)
    const pick = (key, cls, onClick, words, does) => html`<li key=${key}><button class=${`btn ${cls} ava-pick`} onClick=${onClick} aria-disabled=${wait} aria-describedby=${`ava-does-${key}`}>${busy ? 'Adding…' : words}</button><p id=${`ava-does-${key}`}>${firstUp(sentence(does))}</p></li>`;
    // (one found by the web address the name would get has another name: never "the same Jordan Ames")
    return html`<${Dialog} title=${many ? `Is ${app.name} one of these people?` : plan.byAddress ? `Is ${app.name} the same person as ${p.name}?` : `Is this the same ${app.name}?`} busy=${busy} onClose=${onClose} footer=${many ? cancel : html`${cancel}
        <button class="btn btn-ghost" onClick=${press('new')} aria-disabled=${wait}>${busy ? 'Adding…' : 'A different person'}</button>
        <button class="btn btn-primary" onClick=${press('same')} aria-disabled=${wait}>${busy ? 'Adding…' : 'The same person'}</button>`}>
      ${testLine([...all.map(signInOf), email])}${statusLine}
      <p>${many ? (all.some((x) => x.addressOnly) ? `${all.length} people on People → Advisory could be them, by a name like this one or by the web address this name would get, so say who this is.` : `${all.length} people on People → Advisory have a name like this one, so say who this is.`) : plan.byAddress ? html`${p.name} on People → Advisory has the web address this name would get (${p.slug}). ${theirs}, so say who this is.` : html`Someone on People → Advisory has ${p.name === app.name ? 'this name' : 'a name like this one'}. ${theirs}, so say who this is.`}</p>
      <dl class="ava-compare">
        ${all.map((x) => html`<dt>On People</dt><dd>${face(x.photo, x.name)}<span><strong>${x.name}</strong><br />${who(x)}${many && x.addressOnly ? html`<br />Has the web address this name would get (${x.slug})` : null}</span></dd>`)}
        <dt>This application</dt><dd>${face(shot ? headshotSrc(shot, 80) : '', app.name)}<span><strong>${app.name}</strong><br />${[app.email || 'no email', app.company].filter(Boolean).join(' · ')}</span></dd>
      </dl>
      ${many ? html`<ul class="ava-picks">
          ${all.map((x) => pick(x.slug, 'btn-primary', press('same', x.slug), `It’s ${label(x)}`, sameParts(x)))}
          ${pick('new', 'btn-ghost', press('new'), 'A different person', newParts())}
        </ul>` : html`<ul>
          <li><strong>The same person</strong> ${sentence(sameParts())}</li>
          <li><strong>A different person</strong> ${sentence(newParts())}</li>
        </ul>`}
      <p>Either way, this application is marked Joined.</p>
      ${plan.namesakeToo ? html`<p class="ava-note">There’s already a ${plan.namesakeToo.name}${plan.namesakeToo.status === 'memorial' ? ' (In memoriam)' : ''} on ${plan.namesakeToo.where}.</p>` : null}
      ${many ? all.map((x) => onFileOf(x, true)) : onFile}
      ${unusable}
      ${softLine}
    <//>`;
  }
  if (plan.kind === 'same') {
    const parts = sameParts();
    return html`<${Dialog} title=${`Link ${app.name}`} busy=${busy} onClose=${onClose} footer=${html`${cancel}
        <button class="btn btn-primary" onClick=${press('same')} aria-disabled=${wait}>${busy ? 'Linking…' : 'Link them'}</button>`}>
      ${testLine([signInOf(p)])}${statusLine}
      <p>${p.name} is on People → Advisory${plan.why === 'email' ? ', with the same email' : ''}. This:</p>
      <ul>
        ${parts.map((t) => html`<li>${t},</li>`)}
        <li>and marks this application Joined.</li>
      </ul>
      <p>${p.status === 'alumni' ? 'The year they left is taken off their People page; nothing else on it changes.' : 'Nothing else on their People page changes.'}</p>
      ${onFile}
      ${unusable}
      ${!p.hasPhoto && shot ? softLine : null}
    <//>`;
  }
  // new
  return html`<${Dialog} title=${`Add ${app.name} to the Advisory Board`} busy=${busy} onClose=${onClose} footer=${html`${cancel}
      <button class="btn btn-primary" onClick=${press('new')} aria-disabled=${wait}>${busy ? 'Adding…' : 'Add them'}</button>`}>
    ${testLine([email])}${statusLine}
    <p>This:</p>
    <ul>
      <li>adds them to People → Advisory${plan.asName ? html` as <strong>${plan.asName}</strong>` : ''}${app.company ? `, at ${app.company}` : ''}${shot ? ', with their headshot as their photo' : ''},</li>
      ${email ? html`<li>lets them sign in to the Advisory Board page with <strong>${email}</strong>,</li>
      ${welcomeLine(email)}
      <li>adds them to every reveal invite,</li>
      <li>puts them on ${advisoryAt},</li>` : html`<li>needs a working email on their People page before they can sign in or get invites,</li>`}
      <li>shows them to the other Advisory Board members on the Advisory Board page,</li>
      <li>and marks this application Joined.</li>
    </ul>
    ${[plan.namesake, plan.namesakeToo].filter(Boolean).map((n) => html`<p class="ava-note">${n.addressOnly
      // (one with another name, found only by the address this name would get: never "already a Pat Smith". Someone with
      // the name itself elsewhere on People is named too, each as the box names them alone)
      ? html`${n.name}${n.status === 'memorial' ? ' (In memoriam)' : ''} on ${n.where} has the web address this name would get (${n.slug}), so ${app.name} is added as a new person at ${plan.slug}.`
      : html`There’s already a ${n.name}${n.status === 'memorial' ? ' (In memoriam)' : ''} on ${n.where}. ${app.name} is added as a new person.`}</p>`)}
    ${unusable}
    ${softLine}
    <p>The public site doesn’t show them until you${shot ? '' : ' add a photo,'} turn on Show on the site, then publish.</p>
  <//>`;
}

// ─── One application ────────────────────────────────────────────────

// A note being written, by application: closing the panel (Escape, up or down) never throws it away
const noteDrafts = new Map();

// (the words the server uses everywhere for an application deleted elsewhere: _advisory-applications.js)
const GONE_WORDS = 'This application isn’t here any more: it was deleted, maybe in another tab.';

function Drawer({ id, statuses, kit, addToast, onClose, onPrev, onNext, onChanged, onRemoved, onGone, boardEmails = false, startOn = null }) {
  const [app, setApp] = useState(null);
  const [err, setErr] = useState(null);
  const [tries, setTries] = useState(0);
  const [busy, setBusy] = useState(null);
  const [note, setNoteState] = useState(() => noteDrafts.get(id) || '');
  const setNote = (t) => { setNoteState(t); if (t) noteDrafts.set(id, t); else noteDrafts.delete(id); };
  const [confirm, setConfirm] = useState(null); // 'add' | 'remove'
  const panel = useRef(null);

  useEffect(() => {
    let live = true;
    call(`${API}?id=${encodeURIComponent(id)}`).then((j) => {
      if (!live) return;
      if (j.success) { setApp(j.application); setErr(null); return; }
      // (deleted, found by a look again while it showed: said as gone, as any press finding it so says it, never the copy from before)
      if (j.status === 404) { deletedNow(j); return; }
      setErr({ missing: false, words: j.error || 'Couldn’t load it' });
    });
    return () => { live = false; };
  }, [id, tries]);

  useEffect(() => {
    const prev = document.activeElement;
    document.body.classList.add('ava-drawer-open');
    document.body.style.overflow = 'hidden';
    // Up or down pressed: the keys stay on that button (the other one at an end of the list), else the panel
    const nav = startOn && [...(panel.current?.querySelectorAll('.ava-close') || [])].filter((b) => !b.disabled);
    const onNav = nav && (nav.find((b) => b.dataset.nav === startOn) || nav.find((b) => b.dataset.nav));
    (onNav || panel.current)?.focus();
    const onKey = (e) => {
      if (e.defaultPrevented || document.querySelector('.ava-dialog')) return;
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      // Tab stays in the panel (it's a dialog over the list), as the confirm boxes keep it in theirs
      if (e.key !== 'Tab' || !panel.current) return;
      const f = [...panel.current.querySelectorAll('button:not([disabled]), [href]:not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')].filter((el) => el.getClientRects().length);
      if (!f.length) return;
      const inside = panel.current.contains(document.activeElement);
      if (e.shiftKey && (!inside || document.activeElement === f[0] || document.activeElement === panel.current)) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && (!inside || document.activeElement === f[f.length - 1])) { e.preventDefault(); f[0].focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); document.body.classList.remove('ava-drawer-open'); document.body.style.overflow = ''; prev?.focus?.(); };
  }, []);

  const lastFail = useRef(0); // the status the last action failed with (404: deleted elsewhere)
  // Deleted elsewhere, found out by any press here: the box closes, the panel says so, and its row leaves the list
  const deletedNow = (j) => {
    setConfirm(null); setPlan(null); setApp(null); setErr({ missing: true, words: j.error }); onGone?.(id);
    // (the button pressed is gone with the rest: the keys on the panel, and its words read out, never lost to the page)
    requestAnimationFrame(() => panel.current?.focus());
  };
  const post = async (body, what) => {
    setBusy(what);
    const j = await call(API, body);
    setBusy(null);
    lastFail.current = j.success ? 0 : j.status || 0;
    if (!j.success) {
      addToast?.(j.error || 'That didn’t save', 'error');
      // Deleted elsewhere: the panel says so (nothing here can change it now)
      if (j.status === 404) deletedNow(j);
      // Changed elsewhere since this panel opened: shown as it is now, nothing done
      else if (j.status === 409 && j.application) { setApp(j.application); onChanged(j.application); }
      // Any other failure: the panel read again, quietly, so it shows what's true (a change that landed with its answer
      // lost shows as made: Advisory Board QA round 25), never only what it showed before the press
      else if (what !== 'remove') {
        const r = await call(`${API}?id=${encodeURIComponent(id)}`);
        if (r.success) { setApp(r.application); onChanged(r.application); }
      }
      return null;
    }
    // (an answer about the application with none to show: deleted in the moment, said so, never a panel stuck loading)
    if ('application' in j && !j.application) { lastFail.current = 404; deletedNow({ error: GONE_WORDS }); return null; }
    return j;
  };
  const [leaving, setLeaving] = useState(null); // a Joined application being moved to another status: asked first
  const setStatus = async (status, { sure = false } = {}) => {
    if (status === app.status) return;
    // Joined means on the Advisory Board, with their sign-in and welcome: Add to Advisory Board sets it, so the pill
    // opens its box (the server refuses Joined by hand too)
    if (status === 'joined') { openAdd(); return; }
    // Off Joined: they stay on the Advisory Board either way, so it's asked, and said how they really leave
    if (app.status === 'joined' && !sure) { setLeaving(status); return; }
    const j = await post({ status: { id, status, from: app.status } }, 'status');
    if (j) { setApp(j.application); onChanged(j.application); addToast?.(`Marked ${statuses.find((s) => s.id === status)?.label}`, 'info'); }
  };
  // (each note's own key, made once for the words in the box: pressed again after an answer that was lost, the note is
  // there once, never twice. New words, a new note)
  const noteKey = useRef({ text: null, key: '' });
  const addNote = async () => {
    if (noteKey.current.text !== note) noteKey.current = { text: note, key: `n${[...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('')}` };
    const j = await post({ note: { id, text: note, key: noteKey.current.key } }, 'note');
    if (j) { setApp(j.application); onChanged(j.application); setNote(''); document.getElementById('ava-note')?.focus(); } // (the keys back in the box, for another)
  };
  const remove = async () => {
    if (busy) return;
    const j = await post({ remove: { id } }, 'remove');
    if (j) { setConfirm(null); addToast?.(`${app.name}’s application was deleted from the site.`, 'info'); onRemoved(id); }
    else if (lastFail.current === 404) { setConfirm(null); onRemoved(id); } // (already deleted elsewhere: off the list too)
    else {
      // (it didn't go: the panel shows it as it is now, stopped partway with its headshot gone or just as it was, never
      // the copy from before the press with Add still offered)
      const r = await call(`${API}?id=${encodeURIComponent(id)}`);
      if (r.success) { setApp(r.application); onChanged(r.application); }
      else if (r.status === 404) deletedNow(r);
    }
  };
  // Being deleted in another tab right now: looked at again until it goes (the panel says so) or stops (said)
  useEffect(() => {
    if (!app?.deletingNow) return undefined;
    const t = setTimeout(() => setTries((n) => n + 1), 2000);
    return () => clearTimeout(t);
  }, [app, tries]);

  // Add to Advisory Board: the server works out who they are on People (by their email, then their name) and says
  // what it would do; the box says that; then the server does it in one go (functions/api/_advisory-add.js)
  // Who it's linked to, as the server read People just now (app.person); the admin's own copy of People only when
  // the server couldn't say (it can be from before this Add, or one made in another tab)
  const person = !app?.personSlug ? null
    : app.person !== undefined ? app.person
    : (kit.team || []).find((t) => t.slug === app.personSlug) || { slug: app.personSlug, name: app.name };
  const onBoardNow = !!person && (person.group || 'advisory') === 'advisory' && (person.status || 'active') === 'active';
  const linked = onBoardNow ? person : null;
  /*
   * The panel's line for an application linked but not marked Joined (a press that stopped partway), from the same facts
   * as the box and the toasts (Advisory Board QA round 25): their sign-in and welcome are promised only when Add leaves
   * them with an email that signs them in, the one on their People page, or, with none there, this application's
   * (app.emailWhy: why it can't, '' when it can, as the server reads it)
   */
  // (with Advisory Board emails off, only what's true of each, as the box and the toast after it say: their sign-in comes
  // with the add, whatever the switch, and only their welcome email waits for it (Advisory Board QA round 27: the panel
  // said their sign-in waited too, round 26's fix gone too far). boardEmails: the switch as the list read it, the box's
  // own fact before its plan)
  const partwayLine = (x) => {
    const appOk = !!app?.email && !app.emailWhy;
    const why = x.emailWhy ? 'their email on file can’t sign them in' : !app?.email ? 'this application has no email' : !appOk ? (app.emailWhy === 'group' ? 'this application’s email is a SOARD group inbox' : app.emailWhy === 'staff' ? 'this application’s email is a SOARD address, which signs in as staff' : 'this application’s email can’t be used to sign in') : '';
    return x.hasEmail || (!x.emailWhy && appOk)
      ? (boardEmails ? 'This application isn’t marked Joined: Add to Advisory Board below finishes adding them (their sign-in and welcome) and marks it Joined'
        : 'This application isn’t marked Joined: Add to Advisory Board below finishes adding them and marks it Joined. That lets them sign in; only their welcome email waits until Advisory Board emails are turned on (they’re off now)')
      : `This application isn’t marked Joined: Add to Advisory Board below marks it Joined. ${why.charAt(0).toUpperCase()}${why.slice(1)}, ${boardEmails ? 'so they get their sign-in and welcome once their own email is on their People page' : 'so they can sign in once their own email is on their People page, and their welcome email goes once it’s there and Advisory Board emails are turned on (they’re off now)'}`;
  };
  // Linked once, but that person's record was deleted, or they're not on the Advisory Board now: Add again, as the
  // server plans it (it brings back someone who left)
  const gone = !!app?.personSlug && app.person === null;
  const left = !!person && !onBoardNow;
  const shot = app?.headshot?.url ? app.headshot : null;
  const soft = !!shot && shot.width && shot.height && Math.min(shot.width, shot.height) < PHOTO_GOOD;
  const [plan, setPlan] = useState(null);
  // (a note's length as it's saved: the server trims it, so blank lines at its end never count)
  const noteLen = note.trim().length;
  // Another press adding them right now (another tab, someone else): the box waits and asks again until it's done,
  // never showing what's true halfway through it
  const busyTries = useRef(0);
  useEffect(() => {
    if (confirm !== 'add' || !plan?.busy) { busyTries.current = 0; return undefined; }
    if (plan.stuck) return undefined;
    const t = setTimeout(async () => {
      busyTries.current += 1;
      const again = await call(`${API}?plan=${encodeURIComponent(id)}`);
      if (!again.success) {
        // Deleted meanwhile: the box closes and the panel says so. Anything else: asked again, and "taking longer" in time
        if (again.status === 404) { deletedNow(again); return; }
        // A refusal in words (a delete in another tab that stopped partway): the wait is over, the box closes with them,
        // and the panel shows the application as it is now. Anything else: asked again, and "taking longer" in time
        if (again.status === 409 && again.error) {
          setConfirm(null); setPlan(null);
          addToast?.(again.error, 'error');
          const fresh = await call(`${API}?id=${encodeURIComponent(id)}`);
          if (fresh.success) { setApp(fresh.application); onChanged(fresh.application); } else if (fresh.status === 404) deletedNow(fresh);
          requestAnimationFrame(() => panel.current?.focus());
          return;
        }
        setPlan((was) => (was ? { ...was, ...(busyTries.current >= 40 ? { stuck: true } : {}) } : was));
        return;
      }
      setPlan(again.plan.busy && busyTries.current >= 40 ? { ...again.plan, stuck: true } : again.plan);
      if (!again.plan.busy) {
        const fresh = await call(`${API}?id=${encodeURIComponent(id)}`);
        if (fresh.success) { setApp(fresh.application); onChanged(fresh.application); }
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [plan, confirm]);
  // (the box: the headshot as the server read it for the box, a newer one sent since the panel opened included)
  const planShot = plan?.application?.headshot?.url ? plan.application.headshot : shot;
  const planSoft = !!planShot && planShot.width && planShot.height && Math.min(planShot.width, planShot.height) < PHOTO_GOOD;
  const focusNext = useRef(null); // after the box: where the keys go ('done' → the panel's new note)
  const openAdd = async () => {
    if (busy) return;
    setBusy('plan');
    const j = await call(`${API}?plan=${encodeURIComponent(id)}`);
    setBusy(null);
    if (!j.success) {
      addToast?.(j.error || 'Couldn’t check People just now. Try again in a moment.', 'error');
      if (j.status === 404) deletedNow(j);
      return;
    }
    setPlan(j.plan);
    setConfirm('add');
    // (added in another tab since this panel opened: the panel says so too, not only the box)
    if (j.plan.kind === 'joined' && app.status !== 'joined') {
      const fresh = await call(`${API}?id=${encodeURIComponent(id)}`);
      if (fresh.success) { setApp(fresh.application); onChanged(fresh.application); }
    }
  };
  // (only the email service's yes is "emailed": no answer that says either way leaves it owed, sent by itself under the
  // same key, which never sends a second; its own no is said as one, with what to do: Advisory Board QA round 26)
  const welcomeWords = (w) => (!w ? '' : w.sent ? 'They’ve been emailed how to sign in.'
    : w.waiting && w.why === 'owed' ? 'Their sign-in email goes in a few minutes.'
    : w.refused ? 'The email service refused their sign-in email, so it didn’t go. Check their email on their People page, then press Send the sign-in email on their row under Run it → Members.'
    // (one tried a day ago whose answer was lost: it may have gone, and the site never sends it again by itself)
    : w.unsure ? 'Their sign-in email may not have gone, and the site won’t send it again by itself. Their row under Run it → Members can send it again.'
    : w.waiting && w.why === 'send' ? 'Their sign-in email didn’t go just now. The site sends it again in a few minutes.'
    // (People or their email couldn't be read for it just now: never "add a working email", which they may have)
    : w.waiting && w.why === 'check' ? 'The site couldn’t check their email just now, so their sign-in email goes by itself in a few minutes.'
    : w.waiting && w.why === 'setup' ? 'Their sign-in email waits until the board’s sign-in is set up all the way (Board → Members says what’s left). It goes by itself once it is.'
    // (written down as waiting, the heartbeat sending it: a press that did all it had to, said from the box's plan, below)
    : w.waiting && w.why === 'later' ? 'Their sign-in email goes by itself in a few minutes.'
    : w.waiting ? 'Their sign-in email goes in a few minutes, once the sign-in knows them.'
      : w.off ? 'Advisory Board emails are off, so their sign-in email goes once those are turned on.'
        : w.noEmail ? 'Add a working email on their People page so they can sign in.'
          : w.error ? 'Their sign-in email didn’t go just now. The site sends it again in a few minutes.' : '');
  // (Advisory Board emails off, as the box's plan read them: a sign-in email waiting for their own address waits for those too)
  const offToo = () => (plan && plan.emailsOn === false ? ' and Advisory Board emails are turned on' : '');
  // What a press that went all the way says: who they are now, their sign-in email, their welcome (the server's answer)
  // (lead: the first line when it's said from the box's plan, which knows who they are, not what this press made)
  const doneWords = (p, w) => [
    p.lead ? p.lead : p.made ? `${p.name} is on the Advisory Board${p.photoAdded ? ', with their headshot as their photo' : ''}.`
      : `${app.name}’s application is linked to ${p.name} on People → Advisory.${p.restored ? ' They’re on the Advisory Board again, off the public site until you turn on Show on the site.' : ''}${p.photoAdded ? ' Their headshot is their photo now.' : ''}`,
    p.emailUnusable ? `${p.emailUnusable} ${p.emailWhy === 'group' ? 'is a SOARD group inbox' : p.emailWhy === 'staff' ? (p.emailAs ? `signs in as ${p.emailAs}, a SOARD address, which signs in as staff` : 'is a SOARD address, which signs in as staff') : 'can’t be used to sign in'}, so it wasn’t saved. Add their own on their People page: their sign-in email goes once it’s there${offToo()}.` : '',
    p.emailOnFile ? `Their email on file, ${p.emailOnFile.email}, ${p.emailOnFile.why === 'group' ? 'is a SOARD group inbox, so it can’t sign them in' : p.emailOnFile.why === 'staff' ? 'is a SOARD address, which signs in as staff' : 'can’t be used to sign in'}: put their own on their People page, and their sign-in email goes once it’s there${offToo()}.`
      : p.emailKept && p.email && p.email !== String(app.email || '').toLowerCase() ? `Their sign-in email stays ${p.email}.` : '',
    (p.emailUnusable || p.emailOnFile) && w?.noEmail ? '' : welcomeWords(w),
    p.made ? (p.photoAdded ? 'They stay off the public site until you turn on Show on the site.' : 'Add a photo on their People page, then turn on Show on the site and publish.') : '',
  ].filter(Boolean).join(' ');
  // The box closes on what's so now, the keys on the panel's new words
  const finished = (application, words, kind) => {
    setApp(application);
    onChanged(application);
    setConfirm(null);
    setPlan(null);
    focusNext.current = 'done';
    kit.onTeamChanged?.();
    addToast?.(words, kind);
  };
  const doAdd = async (as, to = null) => {
    if (busy) return;
    setBusy('add');
    const j = await call(API, { add: { id, as, seen: plan?.key || null, ...(to ? { to } : {}) } });
    setBusy(null);
    if (!j.success) {
      if (j.status === 404) { addToast?.(j.error || GONE_WORDS, 'error'); deletedNow(j); return; } // (deleted in another tab: nothing here can add it now)
      // What Add would do now (a press that stopped partway changes it): the box says it, and the next press does it
      const again = await call(`${API}?plan=${encodeURIComponent(id)}`);
      // The partway words name a press, Add to Advisory Board again. With nothing left to press (the application marked
      // Joined, their welcome written down before that), the press did all it had to: said as done, as a press that went
      // all the way says it, from what the box knows now, and the box closes; never "stopped partway … Press Add to
      // Advisory Board again" beside a box with only Close (Advisory Board QA round 24). The same for a box that can't
      // add anyone now: it says why, and nothing tells staff to press what isn't there
      const left = again.success && !again.plan.busy ? again.plan.kind : '';
      if (j.partway && left === 'joined') {
        const fresh = await call(`${API}?id=${encodeURIComponent(id)}`);
        const q = again.plan.person || {};
        const appEmail = String(again.plan.application?.email || app.email || '').trim().toLowerCase();
        const w = q.welcomed ? null : again.plan.welcomeWaiting ? (again.plan.emailsOn ? { waiting: true, why: 'later' } : { off: true }) : !q.email || q.emailOk === false ? { noEmail: true } : null;
        finished(fresh.success ? fresh.application : again.plan.application, doneWords({
          lead: `${q.name} is on the Advisory Board, and this application is linked to them on People → Advisory.`, name: q.name, emailKept: !!q.email, email: q.email || '',
          emailUnusable: !q.email && again.plan.emailUsable === false ? appEmail : '', emailWhy: again.plan.emailWhy, emailAs: again.plan.emailAs,
          emailOnFile: q.email && q.emailOk === false ? { email: q.email, why: q.emailWhy } : null,
        }, w), 'success');
        return;
      }
      if (!(j.partway && left === 'blocked')) addToast?.(j.error || 'That didn’t go through. Try again in a moment.', 'error');
      if (again.success) setPlan(again.plan);
      // (nothing can be added from it now, a delete in another tab that stopped partway: the box closes, its words said,
      // never left offering Add them to every press)
      else if (again.status === 409) { setConfirm(null); setPlan(null); }
      const fresh = await call(`${API}?id=${encodeURIComponent(id)}`);
      if (fresh.success) { setApp(fresh.application); onChanged(fresh.application); }
      if (!again.success && again.status === 409) requestAnimationFrame(() => panel.current?.focus());
      return; // (else the box stays open, the keys still on its button)
    }
    finished(j.application, doneWords(j.person || {}, j.welcome), j.welcome?.error || j.welcome?.refused ? 'error' : 'success');
  };
  // Done: the keys on what the panel says now (the button they pressed is gone)
  useEffect(() => {
    if (focusNext.current !== 'done' || confirm) return;
    focusNext.current = null;
    requestAnimationFrame(() => (panel.current?.querySelector('.ava-callout button') || panel.current?.querySelector('.ava-callout'))?.focus());
  }, [confirm, app]);

  const a = app?.answers || {};
  const flag = (sid, item) => (item.id === 'conflict' && item.value === 'Yes') || (item.id === 'meetings' && item.value === 'No') || (item.id === 'ambassador' && item.value === 'No');
  return html`<div>
    <div class="ava-scrim" onClick=${onClose}></div>
    <div class="ava-drawer" role="dialog" aria-modal="true" aria-label=${app ? `${app.name}’s application` : 'Application'} tabindex="-1" ref=${panel}>
      <div class="ava-dhead">
        ${app ? html`<${Avatar} a=${app} />` : html`<span></span>`}
        <div style="min-width:0">
          <h2>${app ? shown(app) : err ? (err.missing ? 'Application not found' : 'Couldn’t load it') : 'Loading…'}</h2>
          ${app && html`<p>${[work(app), `Applied ${longDate(app.createdAt)}`, app.source === 'jotform' ? 'before the website form' : null].filter(Boolean).join(' · ')}</p>`}
        </div>
        <div class="ava-actions">
          <button class="ava-close" data-nav="prev" onClick=${onPrev} disabled=${!onPrev} aria-label="Previous application" title="Previous">↑</button>
          <button class="ava-close" data-nav="next" onClick=${onNext} disabled=${!onNext} aria-label="Next application" title="Next">↓</button>
          <button class="ava-close" onClick=${onClose} aria-label="Close">✕</button>
        </div>
      </div>
      <div class="ava-dbody">
        ${err && html`<div class="ava-callout" role=${err.missing ? 'alert' : null}>${err.words}${err.missing ? null : html` <button class="btn btn-ghost btn-sm" onClick=${() => { setErr(null); setTries((n) => n + 1); }}>Try again</button>`}</div>`}
        ${!app && !err && html`<div class="ava-skel">Loading…</div>`}
        ${app && html`
          <section class="ava-panel" aria-label="Where it stands">
            <h3>Where it stands</h3>
            <div class="ava-status" role="group" aria-label="Status">
              ${statuses.map((s) => {
                const byAdd = s.id === 'joined' && app.status !== 'joined';
                return html`<button key=${s.id} style=${`--c:${STATUS_COLOR[s.id]}`} aria-pressed=${app.status === s.id} aria-disabled=${busy ? 'true' : null}
                  title=${byAdd ? 'Opens Add to Advisory Board, which marks it Joined' : STATUS_HINT[s.id]} onClick=${() => { if (!busy) setStatus(s.id); }}><span class="ava-dot"></span>${s.label}</button>`;
              })}
            </div>
            ${linked ? html`<div class="ava-callout is-good" tabindex="-1">On People → Advisory as ${linked.name}${linked.publishStatus === 'draft' ? ' (hidden from the public site for now)' : ''}${app.status !== 'joined' ? `. ${partwayLine(linked)}` : ''}. ${kit.onOpenPerson ? html`<button class="btn btn-ghost btn-sm" onClick=${() => kit.onOpenPerson(linked.slug)}>Open their page</button>` : ''}</div>` : null}
            ${app.deleting ? html`<div class="ava-callout" role="alert">${app.deletingNow ? 'This application is being deleted right now, in another tab or by someone else.'
                : 'Deleting this application didn’t finish: it’s still here. Press Delete application below to finish it.'}</div>`
              : linked && app.status === 'joined' ? null
              : html`${linked ? null : gone ? html`<p class="ava-note">This was linked to someone who isn’t on People any more.</p>`
                  : left ? html`<p class="ava-note">This was linked to ${person.name}, who isn’t on the Advisory Board now.</p>`
                    : app.status === 'joined' ? html`<p class="ava-note">This is marked Joined, but it isn’t linked to anyone on People now (the Notes say why).</p>` : null}<div class="ava-actions">
                  <button class="btn btn-primary btn-sm" aria-disabled=${busy ? 'true' : null} onClick=${openAdd}>${busy === 'plan' ? 'Checking People…' : 'Add to Advisory Board'}</button>
                  <span class="text-sm" style="color:var(--color-text-muted)">${app.email || linked?.hasEmail ? 'The next box says what happens before anything changes.'
                    // (no email here, and who they'll be isn't known until the box asks People: someone found there may have
                    // one. Linked, with none on their People page that signs them in: said)
                    : linked ? 'This application has no email, and they have none on their People page that signs them in, so they can’t sign in until one is added there.'
                      : 'This application has no email. The next box says whether they can sign in, before anything changes.'}</span>
                </div>`}
          </section>

          <section class="ava-panel" aria-label="Headshot">
            <h3>Headshot</h3>
            ${shot ? html`<div class="ava-shot">
                <a href=${shot.url} target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true"><span>${initials(app.name)}</span><img src=${headshotSrc(shot, 256)} alt="" width="128" height="128" loading="lazy" decoding="async" onError=${(e) => { e.currentTarget.hidden = true; }} /></a>
                <div>
                  ${shot.width && shot.height ? html`<p class=${Math.min(shot.width, shot.height) < PHOTO_GOOD ? 'is-soft' : ''}>${shot.width} × ${shot.height} pixels${Math.min(shot.width, shot.height) < PHOTO_GOOD ? ', so it may look a little soft on the site' : ''}</p>` : null}
                  <a class="link ava-full" href=${shot.url} target="_blank" rel="noopener noreferrer">Open full size<span class="ava-sr"> (${app.name}’s headshot)</span></a>
                </div>
              </div>`
              : html`<p class="text-sm" style="margin:0;color:var(--color-text-muted)">${app.deleting && app.hadHeadshot ? (app.deletingNow ? 'Not shown: this application is being deleted.' : 'Not shown: deleting this application didn’t finish (see above).')
                : app.source === 'jotform' ? 'None: they applied on the old form, which didn’t ask for one.' : 'None: they applied before the form asked for one.'}</p>`}
          </section>

          <section class="ava-panel" aria-label="How to reach them">
            <h3>How to reach them</h3>
            <dl class="ava-contact">
              ${a.email && html`<dt>Email</dt><dd><a href=${`mailto:${a.email}`}>${a.email}</a></dd>`}
              ${a.phone && html`<dt>Phone</dt><dd><a href=${`tel:${a.phone.replace(/[^\d+]/g, '')}`}>${a.phone}</a></dd>`}
              ${a.link && html`<dt>Online</dt><dd><a href=${a.link} target="_blank" rel="noopener noreferrer">${a.link.replace(/^https?:\/\/(www\.)?/, '')}</a></dd>`}
              ${a.address && html`<dt>Home</dt><dd>${a.address}</dd>`}
            </dl>
          </section>

          ${app.sections.filter((s) => s.id !== 'you').map((s) => html`<section class="ava-panel" key=${s.id} aria-label=${s.title}>
            <h3>${s.title}</h3>
            <div class="ava-qa">
              ${s.items.map((it) => html`<div key=${it.id}><p class="ava-q">${it.label}</p><p class=${`ava-a ${flag(s.id, it) ? 'is-flag' : ''}`}>${it.value}</p></div>`)}
            </div>
          </section>`)}

          <section class="ava-panel" aria-label="Notes">
            <h3>Notes ${app.notes.length ? `(${app.notes.length})` : ''}</h3>
            ${app.notes.length > 0 && html`<ul class="ava-notes">${app.notes.map((n, i) => html`<li key=${i}>${n.text}<small>${[n.by, ago(n.at)].filter(Boolean).join(' · ')}</small></li>`)}</ul>`}
            <div class="ava-note-form">
              <label class="sr-only" for="ava-note" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Add a note</label>
              <textarea id="ava-note" class="form-input" placeholder="A note for staff: a call, next steps…" value=${note} onInput=${(e) => setNote(e.target.value)}
                aria-describedby="ava-note-count" onKeyDown=${(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && noteLen && noteLen <= NOTE_MAX) addNote(); }}></textarea>
              ${noteLen > NOTE_MAX - 400 ? html`<p id="ava-note-count" class=${`ava-note-count ${noteLen > NOTE_MAX ? 'is-over' : ''}`} aria-live="polite">${noteLen.toLocaleString('en-US')} of ${NOTE_MAX.toLocaleString('en-US')} characters${noteLen > NOTE_MAX ? ': shorten it, or split it in two' : ''}</p>` : null}
              <button class="btn btn-primary btn-sm" aria-disabled=${!noteLen || noteLen > NOTE_MAX || busy ? 'true' : null} onClick=${() => { if (noteLen && noteLen <= NOTE_MAX && !busy) addNote(); }}>${busy === 'note' ? 'Saving…' : 'Add note'}</button>
            </div>
          </section>

          <div class="ava-foot">
            <span>${app.statusAt ? `Marked ${statuses.find((s) => s.id === app.status)?.label} ${ago(app.statusAt)}${app.statusBy ? ` by ${app.statusBy}` : ''}` : ''}</span>
            <button class="btn btn-ghost btn-sm btn-row-danger" style="position:static" onClick=${() => setConfirm('remove')}>Delete application</button>
          </div>
        `}
      </div>
    </div>
    ${confirm === 'add' && app && plan && html`<${AddDialog} app=${plan.application || app} plan=${plan} shot=${planShot} soft=${planSoft} boardEmails=${plan.emailsOn ?? boardEmails} busy=${busy === 'add'}
      onAdd=${doAdd} onClose=${() => { if (busy !== 'add') { setConfirm(null); setPlan(null); } }} />`}
    ${leaving && app && html`<${Dialog} title=${`Mark ${app.name}’s application ${statuses.find((s) => s.id === leaving)?.label}?`} size="sm" busy=${busy === 'status'} onClose=${() => setLeaving(null)}
      footer=${html`
        <button class="btn btn-ghost" data-autofocus onClick=${() => setLeaving(null)}>Keep it Joined</button>
        <button class="btn btn-primary" onClick=${async () => { const to = leaving; setLeaving(null); await setStatus(to, { sure: true }); }}>Mark it ${statuses.find((s) => s.id === leaving)?.label}</button>`}>
      <p>This only changes the application. ${linked ? `${linked.name} stays on the Advisory Board${linked.hasEmail ? (boardEmails ? `, with their sign-in, reveal invites and ${groupAddress(true)}` : `, with their sign-in and reveal invites, and on ${groupAddress(false)}`) : ''}: Move to alumni on their People page is how someone leaves.${linked.emailWhy ? ` Their email on file ${linked.emailWhy === 'group' ? 'is a SOARD group inbox' : linked.emailWhy === 'staff' ? 'is a SOARD address, which signs in as staff' : 'can’t be used to sign in'}, so they can’t sign in to the Advisory Board page until their own is on their People page.`
        : linked.hasEmail === false ? ' They have no sign-in email on their People page, so they can’t sign in or get reveal invites until one is added.' : ''}` : 'Whoever it’s linked to on People isn’t changed.'}</p>
    <//>`}
    ${confirm === 'remove' && app && html`<${Dialog} title=${`Delete ${app.name}’s application?`} size="sm" busy=${busy === 'remove'} onClose=${() => setConfirm(null)}
      footer=${html`
        <button class="btn btn-ghost" data-autofocus onClick=${() => { if (busy !== 'remove') setConfirm(null); }} aria-disabled=${busy === 'remove' ? 'true' : null}>Keep it</button>
        <button class="btn btn-danger" onClick=${remove} aria-disabled=${busy === 'remove' ? 'true' : null}>${busy === 'remove' ? 'Deleting…' : 'Delete application'}</button>`}>
      <p>Their answers and contact details leave the site for good.${shot ? ' Their headshot goes too, unless it’s someone’s photo on People (now, or in its History).' : ''} Use this when someone asks to be removed, or for a test.${app.personSlug ? ' Their page on People → Advisory stays.' : ''}</p>
    <//>`}
  </div>`;
}

// ─── Who hears about a new application ──────────────────────────────

function SettingsDialog({ settings, addToast, onClose, onSaved }) {
  const [text, setText] = useState(settings.staffEmails.join('\n'));
  const [committee, setCommittee] = useState(settings.committee || '');
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const j = await call(API, { settings: { staffEmails: text, committee } });
    setBusy(false);
    if (!j.success) { setProblem(j.problems?.staffEmails || j.error || 'That didn’t save'); return; }
    addToast?.('Saved. The next application emails them.', 'info');
    onSaved(j.settings);
  };
  const members = committee === settings.committee ? settings.committeeMembers || [] : null;
  const noEmail = (members || []).filter((m) => !m.hasEmail).map((m) => m.name);
  return html`<${Dialog} title="Who hears about new applications" busy=${busy} onClose=${onClose}
    footer=${html`
      <button class="btn btn-ghost" onClick=${() => { if (!busy) onClose(); }} aria-disabled=${busy ? 'true' : null}>Cancel</button>
      <button class="btn btn-primary" onClick=${() => { if (!busy) save(); }} aria-disabled=${busy ? 'true' : null}>${busy ? 'Saving…' : 'Save'}</button>`}>
    <p>Each new application emails these people, with the applicant’s contact details and answers, and posts to Slack without them. A test application (a name starting with TEST) emails only the address on it.</p>
    <div class="form-group">
      <label class="form-label" for="ava-staff">Emails, one per line</label>
      <textarea id="ava-staff" class="form-input" rows="3" spellcheck=${false} value=${text} onInput=${(e) => { setText(e.target.value); setProblem(null); }}></textarea>
      ${problem ? html`<p class="form-hint ink-warn ava-strong" role="alert">${problem}</p>` : settings.isDefault ? html`<p class="form-hint">Until someone saves this, it goes to ${settings.staffEmails.join(', ')}.</p>` : null}
    </div>
    <div class="form-group">
      <label class="form-label" for="ava-committee">And the board committee</label>
      <select id="ava-committee" class="form-select" value=${committee} onChange=${(e) => { setCommittee(e.target.value); setProblem(null); }}>
        <option value="">No committee</option>
        ${(settings.committees || []).map((c) => html`<option key=${c} value=${c}>${c}</option>`)}
      </select>
      ${committee && html`<p class="form-hint">${members === null
        ? `Board members on the ${committee} committee get them, using their private email from People → Board.`
        : members.length
          ? html`On it now: ${list(members.map((m) => m.name))}.${noEmail.length ? html` <strong>${list(noEmail)} ${noEmail.length === 1 ? 'has' : 'have'} no email yet</strong>: add it on their page in People → Board.` : ''}`
          : html`Nobody on People → Board is on the ${committee} committee yet. Open the board member who leads it, add ${committee} under Committees, and they’ll get these from then on.`}</p>`}
    </div>
  <//>`;
}

/** The tab's badge: how many are New (People → Applications) */
export async function newCount() {
  const j = await call(`${API}?count=1`);
  return j.success ? j.new : 0;
}
