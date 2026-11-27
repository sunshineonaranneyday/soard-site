/**
 * Admin → Photos & Videos (#media), and the same on its own page (/admin/media/)
 * ===========================================================================
 * Peter, Nov 25 2026: "i need to create a photo/video gallery for my social
 * media person to download any photo or video asset that we have ... and
 * include a list of recent activities or something related to our reveals
 * and events". Nov 26: "include all photos and vidoes that we have now?",
 * "the login for this should only ahve access to this in the admin too for
 * specific users like our social media person", "can this also show the JT
 * photos too?", "the search has to be top tier, epic, amazing".
 *
 * Search first: one box over every photo and video SOARD has (the website,
 * the Drive archive, JobTread, Stream, YouTube; functions/api/_media-index.js),
 * found by name, year, stage, room, photographer, folder or what's in the
 * picture (every photo is described for search). Albums and filters are
 * suggested as you type; results come with counts to narrow by; "/" jumps to
 * the box from anywhere.
 *
 * Without a search: What's happening (reveals and events coming up and just
 * done, new photos as they come in) and every album, each opening to what its
 * page shows and then everything else: the archive, JobTread, the library.
 * Photos are picked anywhere (an album, a search, several albums) and download
 * as one ZIP; one at a time full size; videos as MP4s.
 *
 * Staff also see who signs in for Photos & Videos only and how the index is
 * doing. Those people (./functions/api/_media-people.js) open /admin/media/,
 * see only public albums, and before photos only once the address check passed
 * them; the server holds to that whatever this page asks.
 *
 * Addresses: #media, #media/events, #media/community, #media/library,
 * #media/kid/<slug>, #media/event/<slug>, #media/community/<slug>,
 * #media/album/<key>, #media/search/<words>?kind=&stage=&source=&year=&album=&sort=
 * Server: /api/media-admin, /api/media-download, /api/media-thumb.
 */

import { h, htm, useState, useEffect, useMemo, useRef } from './vendor.js';
import { useDialog } from './dialog.js';
import * as M from './media-shared.js';

const html = htm.bind(h);
const API = '/api/media-admin';
const DL = '/api/media-download';
const SITE = 'https://sunshineonaranneyday.com';
const SIGN_IN = `${SITE}/admin/media/`;

const TABS = [['kid', 'Reveals', 'reveals'], ['event', 'Events', 'events'], ['community', 'Community', 'community'], ['library', 'Library', 'library'], ['videos', 'Videos', 'videos']];
const SOURCE_WORD = { site: 'Website', drive: 'Drive archive', jobtread: 'JobTread', stream: 'Stream', youtube: 'YouTube', inbox: 'Sent in' };
const STAGE_WORD = { Before: 'Before', During: 'During', After: 'After', none: 'Unsorted' };
const KIND_WORD = { photo: 'Photos', video: 'Videos' };

// ─── Address ──────────────────────────────────────────────────────
const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
const FILTERS = ['kind', 'stage', 'source', 'year', 'album'];
export function readHash(hash = location.hash) {
  const m = String(hash).match(/^#media(?:\/([^?]*))?(?:\?(.*))?$/);
  if (!m) return null;
  const parts = String(m[1] || '').split('/').filter(Boolean);
  const qs = new URLSearchParams(m[2] || '');
  if (parts[0] === 'search') {
    const filters = Object.fromEntries(FILTERS.map((k) => [k, qs.get(k)]).filter(([, v]) => v));
    return { view: 'search', q: dec(parts.slice(1).join('/')), filters, sort: qs.get('sort') || 'best', tab: 'kid' };
  }
  if (['kid', 'event', 'community'].includes(parts[0]) && parts[1]) return { view: 'album', album: `${parts[0]}:${dec(parts[1])}`, tab: parts[0] };
  if (parts[0] === 'album' && parts[1]) return { view: 'album', album: dec(parts.slice(1).join('/')), tab: 'library' };
  const tab = TABS.find(([, , seg]) => seg === parts[0])?.[0] || 'kid';
  return tab === 'videos' ? { view: 'search', q: '', filters: { kind: 'video' }, sort: 'newest', tab } : { view: 'home', tab };
}
export function hashFor(r) {
  if (r.view === 'album') {
    const [kind, ...rest] = r.album.split(':');
    return ['kid', 'event', 'community'].includes(kind) ? `#media/${kind}/${encodeURIComponent(rest.join(':'))}` : `#media/album/${encodeURIComponent(r.album)}`;
  }
  if (r.view === 'search') {
    const qs = new URLSearchParams(Object.entries(r.filters || {}).filter(([, v]) => v));
    if (r.sort && r.sort !== 'best') qs.set('sort', r.sort);
    return `#media/search/${encodeURIComponent(r.q || '')}${qs.toString() ? `?${qs}` : ''}`;
  }
  return r.tab && r.tab !== 'kid' ? `#media/${TABS.find(([k]) => k === r.tab)?.[2] || ''}` : '#media';
}

// ─── Words ────────────────────────────────────────────────────────
const n0 = (n) => Number(n || 0).toLocaleString('en-US');
const plural = (n, one, many = `${one}s`) => `${n0(n)} ${n === 1 ? one : many}`;
const shortDay = (date) => (date ? new Date(`${String(date).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');
const longDay = (date) => (date ? new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');
export const duration = (s) => {
  if (!Number.isFinite(s) || s <= 0) return '';
  const t = Math.round(s);
  const hh = Math.floor(t / 3600);
  const mm = Math.floor((t % 3600) / 60);
  const ss = String(t % 60).padStart(2, '0');
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
};
export const bytes = (n) => {
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  return `${Math.max(1, Math.round(n / 1e3))} KB`;
};
const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/['’]s\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const isNew = (ms) => !!ms && Date.now() - ms < M.NEW_DAYS * 86_400_000;
const roleWord = { photo: null, 'pair-before': 'Before', 'pair-after': 'After', before: 'Before' };
const ago = (iso) => {
  const t = Date.parse(iso || '');
  if (!t) return 'never';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 2) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)} hr ago`;
  return shortDay(iso);
};

async function api(url, opts = {}) {
  const r = await fetch(url, { cache: 'no-store', ...opts });
  const j = await r.json().catch(() => ({}));
  // A Photos & Videos sign-in that landed somewhere else: its own page
  if (r.status === 403 && j.media && !location.pathname.startsWith('/admin/media')) location.replace(j.media);
  if (!r.ok || j.ok === false) throw Object.assign(new Error(j.error || `The server answered ${r.status}`), { status: r.status });
  return j;
}
async function copy(text, addToast, what = 'Copied') {
  try { await navigator.clipboard.writeText(text); addToast(what, 'success'); } catch { addToast('Couldn’t copy. Select the words and copy them yourself.', 'error'); }
}

// ─── Icons ────────────────────────────────────────────────────────
const svg = (d, size = 16) => html`<svg xmlns="http://www.w3.org/2000/svg" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
const I = {
  download: (s) => svg(html`<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>`, s),
  copy: (s) => svg(html`<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>`, s),
  check: (s) => svg(html`<path d="M20 6 9 17l-5-5"/>`, s),
  play: (s) => svg(html`<polygon points="6 3 20 12 6 21 6 3" fill="currentColor"/>`, s),
  out: (s) => svg(html`<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>`, s),
  x: (s) => svg(html`<path d="M18 6 6 18M6 6l12 12"/>`, s),
  left: (s) => svg(html`<path d="m15 18-6-6 6-6"/>`, s),
  right: (s) => svg(html`<path d="m9 18 6-6-6-6"/>`, s),
  back: (s) => svg(html`<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>`, s),
  search: (s) => svg(html`<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>`, s),
  cal: (s) => svg(html`<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>`, s),
  live: (s) => svg(html`<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/>`, s),
  camera: (s) => svg(html`<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>`, s),
  video: (s) => svg(html`<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>`, s),
  reel: (s) => svg(html`<rect x="2" y="2" width="20" height="20" rx="5"/><path d="M2 8h20M8 2l3 6M14 2l3 6"/><path d="m10 12 5 3-5 3z"/>`, s),
  party: (s) => svg(html`<path d="M5.8 11.3 2 22l10.7-3.79"/><path d="M4 3h.01M22 8h.01M15 2h.01M22 20h.01"/><path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z"/>`, s),
  folder: (s) => svg(html`<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>`, s),
  lock: (s) => svg(html`<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>`, s),
  people: (s) => svg(html`<circle cx="9" cy="7" r="3"/><path d="M3 21v-1a5 5 0 0 1 10 0v1"/><circle cx="17" cy="9" r="2.5"/><path d="M15 21v-.5a4 4 0 0 1 6.5-3.1"/>`, s),
  inbox: (s) => svg(html`<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>`, s),
  phone: (s) => svg(html`<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>`, s),
  mail: (s) => svg(html`<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>`, s),
  spark: (s) => svg(html`<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>`, s),
};
const ACT_ICON = { reveal: I.cal, event: I.party, live: I.live, reel: I.reel, revealed: I.party, 'event-past': I.party, photos: I.camera };

// ─── Styles ───────────────────────────────────────────────────────
const STYLES = `
.md { display: grid; gap: 1.25rem; }
.md h3 { margin: 0; font-size: var(--fs-md); }
.md-muted { color: var(--color-text-secondary); }
.md-small { font-size: var(--fs-xs); color: var(--color-text-secondary); }
.md-link { color: var(--color-text); text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--color-border-strong); }
.md-link:hover { text-decoration-color: currentColor; }
.md-linkbtn { all: unset; cursor: pointer; color: var(--color-text); font-weight: 700; text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--color-border-strong); }
.md-linkbtn:hover { text-decoration-color: currentColor; }
.md :is(.md-linkbtn, .md-card, .md-tile button, .md-tile a, .md-vthumb, .md-chipbtn, .md-sugg__item):focus-visible { outline: 2px solid var(--color-text); outline-offset: 2px; }

/* Header and the search box */
.md-head { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 0.75rem 1.5rem; }
.md-head h2 { margin: 0; font-size: var(--fs-2xl); letter-spacing: -0.02em; }
.md-head p { margin: 0.25rem 0 0; color: var(--color-text-secondary); font-size: var(--fs-sm); max-width: 62ch; }
.md-head__actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.md-searchwrap { position: sticky; top: 0; z-index: 20; padding: 0.5rem 0; margin: -0.5rem 0; background: linear-gradient(var(--color-bg) 75%, transparent); }
.md-search { position: relative; }
.md-search__box { display: flex; align-items: center; gap: 0.65rem; height: 56px; padding: 0 0.6rem 0 1.1rem; border: 1.5px solid var(--color-border-strong); border-radius: 14px; background: var(--color-bg-card); box-shadow: var(--shadow-sm); color: var(--color-text-secondary); transition: border-color .15s, box-shadow .15s; }
.md-search__box:focus-within { border-color: var(--color-text); box-shadow: 0 0 0 4px var(--color-primary-ring), var(--shadow-md); }
.md-search__box input { flex: 1; min-width: 0; border: 0; outline: 0; background: none; font: inherit; font-size: var(--fs-md); color: var(--color-text); }
.md-search__box input::placeholder { color: var(--color-text-muted); }
.md-kbd { font-size: var(--fs-2xs); font-weight: 600; color: var(--color-text-muted); border: 1px solid var(--color-border-strong); border-radius: 6px; padding: 0.1rem 0.45rem; }
.md-search__scope { display: inline-flex; align-items: center; gap: 0.3rem; padding: 0.25rem 0.35rem 0.25rem 0.65rem; border-radius: 999px; background: var(--color-text); color: var(--color-bg-card); font-size: var(--fs-xs); font-weight: 650; white-space: nowrap; }
.md-search__scope button { all: unset; cursor: pointer; display: grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; }
.md-search__scope button:hover { background: rgba(255,255,255,0.2); }
.md-sugg { position: absolute; left: 0; right: 0; top: calc(100% + 6px); background: var(--color-bg-card); border: 1px solid var(--color-border); border-radius: 14px; box-shadow: var(--shadow-lg); padding: 0.4rem; max-height: min(70vh, 520px); overflow: auto; }
.md-sugg__h { margin: 0.45rem 0.6rem 0.25rem; font-size: var(--fs-2xs); font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-text-secondary); }
.md-sugg__item { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 0.7rem; width: 100%; padding: 0.45rem 0.6rem; border-radius: 9px; cursor: pointer; font-size: var(--fs-sm); }
.md-sugg__item[aria-selected="true"], .md-sugg__item:hover { background: var(--color-bg-hover); }
.md-sugg__item img, .md-sugg__ph { width: 40px; height: 40px; border-radius: 8px; object-fit: cover; background: var(--color-bg-secondary); flex-shrink: 0; display: grid; place-items: center; color: var(--color-text-muted); }
.md-sugg__item strong { font-weight: 650; }
.md-sugg__meta { margin-left: auto; font-size: var(--fs-xs); color: var(--color-text-secondary); white-space: nowrap; }
.md-sugg__hint { margin: 0.35rem 0.6rem 0.4rem; font-size: var(--fs-xs); color: var(--color-text-secondary); }
mark.md-hl { background: var(--color-primary-bg); color: inherit; box-shadow: inset 0 -2px 0 var(--color-primary); border-radius: 2px; }

/* The index's state, for staff */
.md-status { display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem 1rem; font-size: var(--fs-xs); color: var(--color-text-secondary); }
.md-status .md-bar { width: 90px; height: 6px; border-radius: 99px; background: var(--color-bg-secondary); overflow: hidden; display: inline-block; vertical-align: middle; margin-right: 0.35rem; }
.md-status .md-bar span { display: block; height: 100%; background: var(--color-primary); }
.md-sources { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.6rem; margin-top: 0.6rem; }
.md-source { padding: 0.65rem 0.8rem; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-card); font-size: var(--fs-xs); display: grid; gap: 0.15rem; }
.md-source strong { font-size: var(--fs-sm); }
.md-bad { color: var(--tone-danger-fg); }

/* What's happening */
.md-now { padding: 1.25rem 1.25rem 0.5rem; margin: 0; }
.md-now__head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 0.25rem 1rem; margin-bottom: 0.75rem; }
.md-now__head h3 { font-size: var(--fs-lg); letter-spacing: -0.01em; }
.md-now__cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr); gap: 0 2rem; }
.md-now__col h4 { margin: 0 0 0.25rem; font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-text-secondary); }
.md-acts { list-style: none; margin: 0; padding: 0; }
.md-act { display: grid; grid-template-columns: 32px minmax(0, 1fr) auto; gap: 0.75rem; align-items: start; padding: 0.7rem 0; border-top: 1px solid var(--color-border); }
.md-acts > .md-act:first-child { border-top: 0; }
.md-act__icon { width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; background: var(--tone-neutral-bg); color: var(--tone-neutral-fg); }
.md-act--reveal .md-act__icon, .md-act--event .md-act__icon { background: var(--color-primary-bg); color: var(--color-primary-ink); }
.md-act--live .md-act__icon, .md-act--reel .md-act__icon { background: var(--tone-danger-bg); color: var(--tone-danger-fg); }
.md-act--photos .md-act__icon { background: var(--tone-info-bg); color: var(--tone-info-fg); }
.md-act__when { margin: 0; font-size: var(--fs-xs); color: var(--color-text-secondary); }
.md-act__title { margin: 0.1rem 0 0; font-size: var(--fs-sm); line-height: 1.35; }
.md-act__detail { margin: 0.1rem 0 0; font-size: var(--fs-xs); color: var(--color-text-secondary); }
.md-act__links { display: flex; flex-wrap: wrap; gap: 0.25rem 0.85rem; margin-top: 0.3rem; font-size: var(--fs-xs); }
.md-act__links a, .md-act__links button { display: inline-flex; align-items: center; gap: 0.25rem; }
.md-act__thumbs { display: flex; gap: 4px; }
.md-act__thumbs img { width: 44px; height: 44px; object-fit: cover; border-radius: 6px; background: var(--color-bg-secondary); display: block; }
.md-act__thumbs .is-video { width: 78px; }
.md-tentative { display: inline-block; margin-left: 0.35rem; padding: 0 0.4rem; border-radius: 999px; font-size: var(--fs-2xs); font-weight: 600; background: var(--tone-warn-bg); color: var(--tone-warn-fg); vertical-align: 1px; }
.md-more { margin: 0.25rem 0 0.75rem; }
.md-empty-line { margin: 0.5rem 0 1rem; font-size: var(--fs-sm); color: var(--color-text-secondary); }

/* Tabs, chips, cards */
.md-tabs { margin-bottom: 0; }
.md-tab-n { margin-left: 0.35rem; font-weight: 500; color: var(--color-text-muted); }
.md-tools { display: flex; flex-wrap: wrap; gap: 0.6rem 1rem; align-items: center; }
.md-chips { display: flex; flex-wrap: wrap; gap: 0.35rem; align-items: center; }
.md-chipbtn { border: 1px solid var(--color-border-strong); background: var(--color-bg-card); color: var(--color-text); border-radius: 999px; padding: 0.3rem 0.75rem; font: inherit; font-size: var(--fs-xs); font-weight: 600; cursor: pointer; white-space: nowrap; }
.md-chipbtn:hover { border-color: var(--color-text); }
.md-chipbtn[aria-pressed="true"] { background: var(--color-text); border-color: var(--color-text); color: var(--color-bg-card); }
.md-chipbtn .md-n { font-weight: 500; opacity: 0.7; margin-left: 0.3rem; }
.md-chipbtn:disabled { opacity: 0.45; cursor: default; }
.md-chiplabel { font-size: var(--fs-2xs); font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-text-secondary); margin-right: 0.2rem; }
.md-facets { display: grid; gap: 0.5rem; }
.md-count-line { margin: 0; font-size: var(--fs-xs); color: var(--color-text-secondary); }
.md-select { height: 32px; border: 1px solid var(--color-border-strong); border-radius: 8px; background: var(--color-bg-card); padding: 0 0.5rem; font: inherit; font-size: var(--fs-xs); color: var(--color-text); }
.md-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 1rem; }
.md-grid--small { grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); }
.md-card { display: flex; flex-direction: column; border: 1px solid var(--color-border); border-radius: var(--radius-lg); overflow: hidden; background: var(--color-bg-card); color: inherit; text-decoration: none; transition: box-shadow 0.15s, transform 0.15s; }
.md-card:hover { box-shadow: var(--shadow-md); transform: translateY(-1px); }
.md-card__img { position: relative; aspect-ratio: 4 / 3; background: var(--color-bg-secondary); }
.md-card__img img { width: 100%; height: 100%; object-fit: cover; display: block; }
.md-card__none { position: absolute; inset: 0; display: grid; place-items: center; color: var(--color-text-muted); }
.md-card__chips { position: absolute; left: 0.5rem; top: 0.5rem; right: 0.5rem; display: flex; flex-wrap: wrap; gap: 0.3rem; }
.md-chip { display: inline-flex; align-items: center; gap: 0.25rem; padding: 0.15rem 0.5rem; border-radius: 999px; font-size: var(--fs-2xs); font-weight: 700; line-height: 1.4; background: rgba(255,255,255,0.94); color: #1A1B1F; box-shadow: 0 1px 2px rgba(0,0,0,0.15); white-space: nowrap; }
.md-chip--new { background: var(--color-primary); color: #1A1B1F; }
.md-chip--live { background: #B42318; color: #fff; }
.md-chip--staff { background: #1A1B1F; color: #fff; }
.md-card__body { display: grid; gap: 0.15rem; padding: 0.7rem 0.85rem 0.8rem; }
.md-card__name { font-weight: 700; font-size: var(--fs-sm); overflow-wrap: anywhere; }
.md-card__meta { font-size: var(--fs-xs); color: var(--color-text-secondary); }
.md-group-h { margin: 0.5rem 0 0; font-size: var(--fs-sm); color: var(--color-text-secondary); font-weight: 650; }

/* An album */
.md-back { display: inline-flex; align-items: center; gap: 0.35rem; justify-self: start; }
.md-album__head { display: flex; flex-wrap: wrap; gap: 1rem 1.5rem; align-items: flex-end; justify-content: space-between; }
.md-album__head h2 { margin: 0; font-size: var(--fs-2xl); letter-spacing: -0.02em; line-height: 1.15; }
.md-album__head h2 span { color: var(--color-text-muted); font-weight: 500; }
.md-album__meta { margin: 0.35rem 0 0; color: var(--color-text-secondary); font-size: var(--fs-sm); }
.md-album__actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.md-note { padding: 0.7rem 0.9rem; border-radius: var(--radius-md); background: var(--tone-warn-bg); color: var(--tone-warn-fg); font-size: var(--fs-sm); display: flex; gap: 0.5rem; align-items: center; }
.md-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 0.75rem; }
.md-fact { margin: 0; padding: 0.85rem 1rem; display: grid; gap: 0.35rem; align-content: start; }
.md-fact__label { font-size: var(--fs-2xs); font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-text-secondary); }
.md-fact__value { font-size: var(--fs-sm); font-weight: 600; overflow-wrap: anywhere; }
.md-fact__row { display: flex; flex-wrap: wrap; gap: 0.35rem; }
.md-caption { white-space: pre-wrap; margin: 0; font-size: var(--fs-sm); line-height: 1.55; max-height: 14rem; overflow: auto; }
.md-sec { display: grid; gap: 0.75rem; }
.md-sec__head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem 1rem; }
.md-sec__head h3 .md-muted { font-weight: 500; }
.md-sec__head p { margin: 0.15rem 0 0; }
.md-sec__tools { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; }

/* Photos */
.md-pgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 0.5rem; }
.md-pairs { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1rem; }
.md-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 0.35rem; }
.md-tile { position: relative; aspect-ratio: 1; border-radius: var(--radius-md); overflow: hidden; background: var(--color-bg-secondary); }
.md-tile.is-sel { box-shadow: 0 0 0 3px var(--color-text); }
.md-tile.is-held img { filter: grayscale(0.6) brightness(0.85); }
.md-tile__open { all: unset; display: block; width: 100%; height: 100%; cursor: zoom-in; }
.md-tile__open img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.2s; }
.md-tile:hover .md-tile__open img { transform: scale(1.03); }
.md-tile__ph { width: 100%; height: 100%; display: grid; place-items: center; color: var(--color-text-muted); }
.md-tile__check, .md-tile__dl { position: absolute; top: 0.4rem; width: 30px; height: 30px; display: grid; place-items: center; border-radius: 50%; border: 0; cursor: pointer; background: rgba(255,255,255,0.92); color: #1A1B1F; box-shadow: 0 1px 3px rgba(0,0,0,0.25); opacity: 0; transition: opacity 0.12s; }
.md-tile__check { left: 0.4rem; }
.md-tile__dl { right: 0.4rem; }
.md-tile:hover .md-tile__check, .md-tile:hover .md-tile__dl, .md-tile:focus-within .md-tile__check, .md-tile:focus-within .md-tile__dl, .md-picking .md-tile__check, .md-tile.is-sel .md-tile__check { opacity: 1; }
.md-tile.is-sel .md-tile__check { background: var(--color-text); color: var(--color-bg-card); }
.md-tile__check svg { opacity: 0.35; }
.md-tile.is-sel .md-tile__check svg { opacity: 1; }
.md-tile__tags { position: absolute; left: 0.4rem; bottom: 0.4rem; right: 0.4rem; display: flex; flex-wrap: wrap; gap: 0.25rem; pointer-events: none; }
.md-tile__dur { position: absolute; right: 0.4rem; bottom: 0.4rem; padding: 0.05rem 0.4rem; border-radius: 4px; background: rgba(0,0,0,0.75); color: #fff; font-size: var(--fs-2xs); font-weight: 700; }
.md-tile__play { position: absolute; left: 50%; top: 50%; translate: -50% -50%; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; background: rgba(255,255,255,0.9); color: #1A1B1F; padding-left: 3px; box-sizing: border-box; pointer-events: none; }
@media (hover: none) { .md-tile__check, .md-tile__dl { opacity: 1; } }
.md-pickbar { position: sticky; bottom: 1rem; z-index: 25; justify-self: center; display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 1rem; padding: 0.6rem 0.75rem 0.6rem 1.1rem; border-radius: 999px; background: #1A1B1F; color: #fff; box-shadow: var(--shadow-lg); font-size: var(--fs-sm); font-weight: 600; }
.md-pickbar .btn-ghost { background: transparent; color: #fff; border: 1px solid rgba(255,255,255,0.35); box-shadow: none; }
.md-pickbar .btn-ghost:hover:not(:disabled) { background: rgba(255,255,255,0.12); color: #fff; }
.md-pickbar small { font-weight: 500; opacity: 0.75; }

/* Videos */
.md-vgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1rem; }
.md-vcard { display: flex; flex-direction: column; border: 1px solid var(--color-border); border-radius: var(--radius-lg); overflow: hidden; background: var(--color-bg-card); }
.md-vcard.is-sel { box-shadow: 0 0 0 3px var(--color-text); }
.md-vthumb { all: unset; position: relative; display: block; aspect-ratio: 16 / 9; overflow: hidden; background: #1A1B1F; cursor: pointer; }
.md-vthumb img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; opacity: 0.92; }
.md-vthumb__play { position: absolute; left: 50%; top: 50%; translate: -50% -50%; width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center; background: rgba(255,255,255,0.92); color: #1A1B1F; padding-left: 3px; box-sizing: border-box; }
.md-vthumb__dur { position: absolute; right: 0.45rem; bottom: 0.45rem; padding: 0.05rem 0.4rem; border-radius: 4px; background: rgba(0,0,0,0.75); color: #fff; font-size: var(--fs-2xs); font-weight: 700; }
.md-vthumb__kind { position: absolute; left: 0.45rem; top: 0.45rem; display: flex; gap: 0.25rem; }
.md-vcard__body { display: grid; gap: 0.2rem; padding: 0.75rem 0.85rem 0.85rem; flex: 1; align-content: start; }
.md-vcard__label { margin: 0; font-weight: 700; font-size: var(--fs-sm); overflow-wrap: anywhere; }
.md-vcard__meta { margin: 0; font-size: var(--fs-xs); color: var(--color-text-secondary); }
.md-vcard__actions { display: flex; flex-wrap: wrap; gap: 0.4rem 0.75rem; align-items: center; margin-top: 0.5rem; font-size: var(--fs-xs); }
.md-vcard__actions a.md-link, .md-vcard__actions button.md-linkbtn { display: inline-flex; align-items: center; gap: 0.25rem; font-weight: 500; }
.md-making { font-size: var(--fs-xs); color: var(--color-text-secondary); }

/* Viewer and dialogs */
.md-lb { position: fixed; inset: 0; z-index: 1000; background: rgba(12,12,14,0.94); color: #fff; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; outline: none; }
.md-lb__bar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 0.75rem; padding: 0.75rem 1rem; }
.md-lb__title { flex: 1; min-width: 0; font-size: var(--fs-sm); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin: 0; }
.md-lb__title span { color: rgba(255,255,255,0.65); font-weight: 500; }
.md-lb .btn-ghost { background: transparent; color: #fff; border: 1px solid rgba(255,255,255,0.35); box-shadow: none; }
.md-lb .btn-ghost:hover { background: rgba(255,255,255,0.12); color: #fff; }
.md-lb__stage { position: relative; min-height: 0; overflow: hidden; }
.md-lb__stage img { position: absolute; inset: 0 3.5rem; margin: auto; max-width: calc(100% - 7rem); max-height: 100%; object-fit: contain; display: block; }
.md-lb__stage .md-lb__frame { position: absolute; inset: 0; margin: auto; width: min(calc(100% - 2rem), calc((100vh - 9rem) * 16 / 9)); aspect-ratio: 16 / 9; max-height: 100%; border: 0; background: #000; }
.md-lb__nav { position: absolute; top: 50%; translate: 0 -50%; width: 44px; height: 44px; border-radius: 50%; border: 0; display: grid; place-items: center; cursor: pointer; background: rgba(255,255,255,0.14); color: #fff; }
.md-lb__nav:hover { background: rgba(255,255,255,0.25); }
.md-lb__nav:disabled { opacity: 0.3; cursor: default; }
.md-lb__prev { left: 0.5rem; }
.md-lb__next { right: 0.5rem; }
.md-lb__alt { margin: 0; padding: 0.6rem 1rem 1rem; font-size: var(--fs-xs); color: rgba(255,255,255,0.78); text-align: center; min-height: 1rem; }
.md-lb button:focus-visible, .md-lb a:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.md-modal-bg { position: fixed; inset: 0; z-index: 900; background: rgba(26,27,31,0.45); display: grid; place-items: center; padding: 1rem; }
.md-modal { width: min(560px, 100%); max-height: calc(100vh - 2rem); overflow: auto; background: var(--color-bg-card); border-radius: 16px; box-shadow: var(--shadow-lg); padding: 1.25rem 1.25rem 1rem; display: grid; gap: 0.9rem; outline: none; }
.md-modal h2 { margin: 0; font-size: var(--fs-lg); }
.md-people { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.4rem; }
.md-people li { display: flex; align-items: center; gap: 0.75rem; padding: 0.55rem 0.7rem; border: 1px solid var(--color-border); border-radius: 10px; }
.md-people li div { flex: 1; min-width: 0; }
.md-people strong { display: block; font-size: var(--fs-sm); }
.md-form { display: grid; grid-template-columns: 1fr 1.3fr auto; gap: 0.5rem; align-items: end; }
.md-form label { display: grid; gap: 0.2rem; font-size: var(--fs-xs); font-weight: 600; color: var(--color-text-secondary); }
.md-form input { height: 38px; border: 1px solid var(--color-border-strong); border-radius: 8px; padding: 0 0.6rem; font: inherit; font-size: var(--fs-sm); color: var(--color-text); background: var(--color-bg-card); }
.md-modal--wide { width: min(760px, 100%); }
.md-send { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
.md-send__box { border: 1px solid var(--color-border); border-radius: 12px; padding: 0.85rem 0.95rem; display: grid; gap: 0.4rem; align-content: start; }
.md-send__box h3 { display: flex; align-items: center; gap: 0.4rem; margin: 0; font-size: var(--fs-sm); }
.md-send__addr { font-size: var(--fs-lg); font-weight: 700; letter-spacing: -0.01em; overflow-wrap: anywhere; }
.md-steps { margin: 0; padding-left: 1.1rem; display: grid; gap: 0.25rem; font-size: var(--fs-sm); color: var(--color-text-secondary); }
.md-msgs { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.35rem; max-height: 280px; overflow: auto; }
.md-msgs li { display: flex; align-items: center; gap: 0.6rem; padding: 0.5rem 0.65rem; border: 1px solid var(--color-border); border-radius: 10px; font-size: var(--fs-sm); }
.md-msgs li div { flex: 1; min-width: 0; }
.md-msgs li.is-held { border-color: var(--tone-warn-line); background: var(--tone-warn-surface); }
.md-quote { margin: 0; padding: 0.55rem 0.75rem; border-left: 3px solid var(--color-primary); background: var(--color-bg-secondary); border-radius: 0 8px 8px 0; font-size: var(--fs-sm); }
.md-pickalbums { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.25rem; max-height: 320px; overflow: auto; }
@media (max-width: 560px) { .md-send { grid-template-columns: 1fr; } }
.md-signlink { display: flex; gap: 0.5rem; align-items: center; padding: 0.55rem 0.7rem; border-radius: 10px; background: var(--color-bg-secondary); font-size: var(--fs-sm); }
.md-signlink code { flex: 1; min-width: 0; overflow-wrap: anywhere; font: inherit; font-weight: 600; }

@media (max-width: 900px) { .md-now__cols { grid-template-columns: 1fr; } .md-album__head h2 { font-size: var(--fs-xl); } }
@media (max-width: 560px) {
  .md-head h2 { font-size: var(--fs-xl); }
  .md-grid, .md-grid--small { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.6rem; }
  .md-pgrid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.3rem; }
  .md-pairs { grid-template-columns: 1fr; }
  .md-act { grid-template-columns: 28px minmax(0, 1fr); }
  .md-act__thumbs { display: none; }
  .md-lb__stage img { inset: 0 0.5rem; max-width: calc(100% - 1rem); }
  .md-lb__nav { width: 36px; height: 36px; background: rgba(0,0,0,0.5); }
  .md-pickbar { border-radius: var(--radius-lg); }
  .md-search__box { height: 50px; }
  .md-kbd { display: none; }
  .md-form { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) { .md-card, .md-tile__open img { transition: none; } .md-card:hover { transform: none; } }

/* On its own page */
.md-page { max-width: 1280px; margin: 0 auto; padding: 0 1.25rem 3rem; }
.md-topbar { display: flex; align-items: center; gap: 0.75rem; padding: 0.9rem 0; margin-bottom: 0.5rem; }
.md-topbar img { width: 36px; height: 36px; border-radius: 50%; }
.md-topbar strong { font-size: var(--fs-md); }
.md-topbar span { margin-left: auto; font-size: var(--fs-xs); color: var(--color-text-secondary); }
@media (max-width: 560px) { .md-topbar__who { display: none; } .md-topbar strong { font-size: var(--fs-sm); } }
.md-toasts { position: fixed; right: 1rem; bottom: 1rem; z-index: 1100; display: grid; gap: 0.5rem; }
.md-toast { background: #1A1B1F; color: #fff; padding: 0.7rem 1rem; border-radius: 10px; box-shadow: var(--shadow-lg); font-size: var(--fs-sm); max-width: 360px; }
.md-toast.is-error { background: #B42318; }
`;
function useStyles() {
  if (typeof document !== 'undefined' && !document.getElementById('md-styles')) {
    const s = document.createElement('style');
    s.id = 'md-styles';
    s.textContent = STYLES;
    document.head.appendChild(s);
  }
}

// ─── Items: one shape for every tile ───────────────────────────────
/** A page's own photo as an item (its download names it the way the page numbers it) */
const pageItem = (album, f) => ({
  id: `img:${f.id}`, kind: 'photo', source: 'site', albumName: album.name, album: album.key, alt: f.alt || null,
  thumb: M.imgSrc(f.id, 'w=360,h=360,fit=cover,gravity=auto,q=70'), full: M.imgSrc(f.id, 'w=2000,h=2000,fit=scale-down,q=85'),
  name: M.photoFileName(album, f), added: f.added, tag: roleWord[f.role] || null,
  download: `${DL}?item=${encodeURIComponent(`img:${f.id}`)}&album=${encodeURIComponent(album.key)}`,
});
const itemCaption = (it) => it.alt || it.description || it.title || '';
const itemWhen = (it) => shortDay(it.takenAt || it.addedAt);

// ─── The area ─────────────────────────────────────────────────────
export function MediaArea({ addToast: addToastIn = null, standalone = false }) {
  useStyles();
  const [toasts, setToasts] = useState([]);
  const addToast = addToastIn || ((msg, type = 'info') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  });
  const [route, setRoute] = useState(() => readHash() || { view: 'home', tab: 'kid' });
  const [home, setHome] = useState(null);
  const [homeErr, setHomeErr] = useState(null);
  const [picked, setPicked] = useState(() => new Map()); // item id → item
  const [people, setPeople] = useState(false);
  const [send, setSend] = useState(false);
  const [moving, setMoving] = useState(null); // picked sent-in files, to another album

  const load = async () => {
    try { const j = await api(API); setHome(j); setHomeErr(null); } catch (e) { setHomeErr(e.message); }
  };
  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 5 * 60_000);
    return () => clearInterval(t);
  }, []);

  const go = (r, { push = true } = {}) => {
    setRoute(r);
    const to = hashFor(r);
    if (location.hash !== to) history[push ? 'pushState' : 'replaceState'](null, '', to);
    if (r.view !== 'search') requestAnimationFrame(() => (document.querySelector('.main') || document.scrollingElement)?.scrollTo?.({ top: 0 }));
  };
  useEffect(() => {
    const on = () => { const r = readHash(); if (r) setRoute(r); };
    window.addEventListener('popstate', on);
    window.addEventListener('hashchange', on);
    const nav = (e) => { if (e.detail === 'media') { setRoute({ view: 'home', tab: 'kid' }); if (location.hash !== '#media') history.replaceState(null, '', '#media'); } };
    window.addEventListener('soard-nav', nav);
    return () => { window.removeEventListener('popstate', on); window.removeEventListener('hashchange', on); window.removeEventListener('soard-nav', nav); };
  }, []);

  const staff = home?.me?.role === 'staff';
  const albums = home?.albums || [];
  const byKey = useMemo(() => new Map(albums.map((a) => [a.key, a])), [albums]);
  const open = (key) => go({ view: 'album', album: key, tab: key.split(':')[0] });
  const toggle = (it) => setPicked((m) => { const n = new Map(m); if (n.has(it.id)) n.delete(it.id); else n.set(it.id, it); return n; });
  const pickAll = (list, on = true) => setPicked((m) => { const n = new Map(m); for (const it of list) if (it.kind === 'photo' && it.download) { if (on) n.set(it.id, it); else n.delete(it.id); } return n; });
  const ctx = { staff, addToast, open, picked, toggle, pickAll, byKey, go, route };

  let body;
  if (route.view === 'album') body = html`<${AlbumView} key=${route.album} albumKey=${route.album} card=${byKey.get(route.album)} ctx=${ctx} onBack=${() => (history.length > 1 ? history.back() : go({ view: 'home', tab: route.tab }))} />`;
  else if (route.view === 'search') body = html`<${Results} key="results" route=${route} ctx=${ctx} albums=${albums} />`;
  else body = html`<${Home} home=${home} error=${homeErr} onRetry=${load} tab=${route.tab} ctx=${ctx} />`;

  const totals = home?.totals;
  return html`
    <div class="md ${picked.size ? 'md-picking' : ''}">
      ${route.view === 'home' && html`
        <div class="md-head">
          <div>
            <h2>Photos & Videos</h2>
            <p>${totals ? `${n0(totals.photos)} photos and ${n0(totals.videos)} videos from the website, the Drive archive, JobTread, Stream and YouTube. Photos download full size; videos as MP4s.` : 'Every photo and video SOARD has, ready to download.'}</p>
          </div>
          ${staff && html`<div class="md-head__actions">
            ${home?.inbox?.ready ? html`<button class="btn btn-ghost btn-sm" onClick=${() => setSend(true)}>${I.inbox(14)} Send photos in</button>` : null}
            <button class="btn btn-ghost btn-sm" onClick=${() => setPeople(true)}>${I.people(14)} Who can sign in${home?.people?.length ? ` (${home.people.length})` : ''}</button>
          </div>`}
        </div>`}
      <${SearchBar} route=${route} ctx=${ctx} albums=${albums} totals=${totals} />
      ${route.view === 'home' && staff && home?.facts && html`<${IndexStatus} facts=${home.facts} />`}
      ${body}
      ${picked.size ? html`<${PickBar} picked=${picked} clear=${() => setPicked(new Map())} addToast=${addToast} staff=${staff} onMove=${(list) => setMoving(list)} />` : null}
      ${people && html`<${PeopleDialog} home=${home} setHome=${setHome} addToast=${addToast} onClose=${() => setPeople(false)} />`}
      ${send && html`<${SendDialog} addToast=${addToast} ctx=${ctx} onClose=${() => { setSend(false); load(); }} />`}
      ${moving && html`<${MoveDialog} items=${moving} albums=${albums} addToast=${addToast} onClose=${() => setMoving(null)}
        onMoved=${() => { setMoving(null); setPicked(new Map()); load(); window.dispatchEvent(new Event('md-reload-album')); }} />`}
      ${!addToastIn && html`<div class="md-toasts" aria-live="polite">${toasts.map((t) => html`<div key=${t.id} class="md-toast ${t.type === 'error' ? 'is-error' : ''}">${t.msg}</div>`)}</div>`}
    </div>`;
}

/** The page for the people who sign in for Photos & Videos only (/admin/media/) */
export function MediaPage() {
  const [me, setMe] = useState(null);
  useEffect(() => { api(`${API}?me=1`).then((j) => setMe(j.me)).catch(() => setMe({})); }, []);
  return html`
    <div class="md-page">
      <header class="md-topbar">
        <img src="/cdn-cgi/imagedelivery/ROYFuPmfN2vPS6mt5sCkZQ/brand-logo-admin/w=128" alt="" width="36" height="36" />
        <strong>SOARD Photos & Videos</strong>
        <span><span class="md-topbar__who">${me?.email || ''} · </span>${me?.role === 'staff' ? html`<a class="md-link" href="/admin/#media">Back to the admin</a> · ` : ''}<a class="md-link" href="/cdn-cgi/access/logout">Sign out</a></span>
      </header>
      <${MediaArea} standalone />
    </div>`;
}

// ─── Search ───────────────────────────────────────────────────────
const RECENT_KEY = 'soard-media-recent';
const recentSearches = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').slice(0, 6); } catch { return []; } };
const rememberSearch = (q) => { try { const list = [q, ...recentSearches().filter((x) => x !== q)].slice(0, 8); localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* private mode */ } };

/** Albums that match what's typed: every word in the name or year (from its start), or near it for a slip */
export function albumMatches(albums, q, max = 6) {
  const words = fold(q).split(' ').filter(Boolean);
  if (!words.length) return [];
  const near = (a, b) => {
    if (Math.abs(a.length - b.length) > 1 || a.length < 4) return false;
    let i = 0;
    let j = 0;
    let edits = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
    }
    return edits + (a.length - i) + (b.length - j) <= 1;
  };
  const scored = [];
  for (const a of albums) {
    const name = fold(`${a.name} ${a.year || ''}`).split(' ');
    let score = 0;
    let all = true;
    for (const w of words) {
      if (name.some((t) => t === w)) score += 3;
      else if (name.some((t) => t.startsWith(w))) score += 2;
      else if (name.some((t) => near(t, w))) score += 1;
      else { all = false; break; }
    }
    if (all) scored.push([score + (a.public === false ? -0.5 : 0) + (a.photos ? 0.2 : 0), a]);
  }
  return scored.sort((x, y) => y[0] - x[0] || String(y[1].year || '').localeCompare(String(x[1].year || ''))).slice(0, max).map(([, a]) => a);
}

const FILTER_SUGGEST = [
  ['before', { stage: 'Before' }, 'Before photos'], ['after', { stage: 'After' }, 'After and reveal photos'], ['during', { stage: 'During' }, 'Construction progress'],
  ['progress', { stage: 'During' }, 'Construction progress'], ['video', { kind: 'video' }, 'Videos only'], ['videos', { kind: 'video' }, 'Videos only'],
  ['drive', { source: 'drive' }, 'From the Drive archive'], ['archive', { source: 'drive' }, 'From the Drive archive'], ['jobtread', { source: 'jobtread' }, 'From JobTread'], ['youtube', { source: 'youtube' }, 'On YouTube'],
];

function SearchBar({ route, ctx, albums, totals }) {
  const inSearch = route.view === 'search';
  const scope = route.view === 'album' ? route.album : inSearch ? route.filters?.album || null : null;
  const [draft, setDraft] = useState(inSearch ? route.q : '');
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(-1);
  const box = useRef(null);
  const input = useRef(null);
  const timer = useRef(null);
  useEffect(() => {
    if (inSearch && route.q !== draft && document.activeElement !== input.current) setDraft(route.q);
    // (an album opens with an empty box, its own name on it as the scope)
    if (!inSearch) { setDraft(''); setOpen(false); }
  }, [route.view, route.album, route.q]);
  // "/" from anywhere on the page: the box
  useEffect(() => {
    const k = (e) => {
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '') && !document.activeElement?.isContentEditable) { e.preventDefault(); input.current?.focus(); input.current?.select(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  useEffect(() => {
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, []);
  // (a box emptied and typed into again is a new search: the chips picked for the last one go, the album stays)
  const fresh = useRef(false);
  const run = (q, extra = {}) => {
    clearTimeout(timer.current);
    const kept = inSearch && !fresh.current ? route.filters : {};
    fresh.current = false;
    const filters = { ...kept, ...(scope ? { album: scope } : {}), ...extra };
    ctx.go({ view: 'search', q, filters, sort: inSearch ? route.sort : 'best', tab: route.tab }, { push: !inSearch });
  };
  // Results as you type, a beat after the last key
  const onInput = (v) => {
    if (!v.trim()) fresh.current = true;
    setDraft(v);
    setOpen(true);
    setSel(-1);
    clearTimeout(timer.current);
    if (v.trim() || inSearch) timer.current = setTimeout(() => run(v), 260);
  };
  const matches = useMemo(() => albumMatches(albums, draft, 6), [albums, draft]);
  const words = fold(draft).split(' ');
  const filterSugg = FILTER_SUGGEST.filter(([w]) => words.includes(w)).filter((x, i, all) => all.findIndex((y) => y[2] === x[2]) === i).slice(0, 3);
  const recent = !draft.trim() ? recentSearches() : [];
  const options = [
    ...matches.map((a) => ({ type: 'album', a, act: () => { setOpen(false); rememberSearch(draft.trim()); ctx.open(a.key); } })),
    ...filterSugg.map(([, f, label]) => ({ type: 'filter', label, act: () => { setOpen(false); run(draft, f); } })),
    ...recent.map((q) => ({ type: 'recent', q, act: () => { setDraft(q); setOpen(false); run(q); } })),
  ];
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setSel((s) => Math.min(options.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(-1, s - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (sel >= 0 && options[sel]) options[sel].act();
      else { setOpen(false); if (draft.trim()) rememberSearch(draft.trim()); run(draft); }
    } else if (e.key === 'Escape') {
      if (open) { setOpen(false); e.stopPropagation(); } else if (draft) { setDraft(''); if (inSearch) ctx.go({ view: 'home', tab: 'kid' }); }
    }
  };
  const scopeAlbum = scope ? ctx.byKey.get(scope) : null;
  const placeholder = scope ? `Search ${scopeAlbum?.name || 'this album'}…` : `Search ${totals ? n0(totals.photos + totals.videos) : 'every'} photos and videos: a kid, an event, a year, “girl in a pink room”…`;
  const hl = (text) => {
    const w = fold(draft).split(' ').filter((x) => x.length > 1);
    if (!w.length) return text;
    const re = new RegExp(`\\b(${w.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'ig');
    const parts = String(text).split(re);
    return parts.map((p, i) => (i % 2 ? html`<mark class="md-hl">${p}</mark>` : p));
  };
  return html`
    <div class="md-searchwrap">
      <div class="md-search" ref=${box}>
        <label class="md-search__box">
          ${I.search(20)}
          <span class="sr-only">Search photos and videos</span>
          <input ref=${input} type="search" value=${draft} placeholder=${placeholder} autocomplete="off" spellcheck="false"
            role="combobox" aria-expanded=${open && options.length > 0} aria-controls="md-sugg" aria-activedescendant=${sel >= 0 ? `md-sugg-${sel}` : null}
            onInput=${(e) => onInput(e.target.value)} onFocus=${() => setOpen(true)} onKeyDown=${onKey} />
          ${scope && html`<span class="md-search__scope">In ${scopeAlbum?.name || 'this album'}<button type="button" aria-label="Search everything" onClick=${(e) => { e.preventDefault(); run(draft, { album: null }); }}>${I.x(12)}</button></span>`}
          ${!draft && html`<span class="md-kbd" aria-hidden="true">/</span>`}
        </label>
        ${open && options.length > 0 && html`
          <div class="md-sugg" id="md-sugg" role="listbox" aria-label="Suggestions">
            ${matches.length ? html`<p class="md-sugg__h">Albums</p>` : null}
            ${options.map((o, i) => html`
              ${o.type === 'filter' && (i === 0 || options[i - 1].type !== 'filter') ? html`<p class="md-sugg__h">Narrow to</p>` : null}
              ${o.type === 'recent' && (i === 0 || options[i - 1].type !== 'recent') ? html`<p class="md-sugg__h">Recent searches</p>` : null}
              <button type="button" id=${`md-sugg-${i}`} role="option" aria-selected=${sel === i} class="md-sugg__item" onMouseEnter=${() => setSel(i)} onClick=${o.act}>
                ${o.type === 'album' ? html`
                  ${o.a.cover ? html`<img src=${o.a.cover} alt="" loading="lazy" />` : html`<span class="md-sugg__ph">${I.folder(16)}</span>`}
                  <span><strong>${hl(o.a.name)}</strong>${o.a.year && o.a.kind !== 'event' ? html` <span class="md-muted">${o.a.year}</span>` : ''}${o.a.public === false ? html` <span class="md-chip md-chip--staff">Not public</span>` : ''}</span>
                  <span class="md-sugg__meta">${[o.a.photos && plural(o.a.photos, 'photo'), o.a.videos && plural(o.a.videos, 'video')].filter(Boolean).join(' · ')}</span>`
                : o.type === 'filter' ? html`<span class="md-sugg__ph">${I.spark(16)}</span><span>${o.label}${draft.trim() ? html` <span class="md-muted">· “${draft.trim()}”</span>` : ''}</span>`
                : html`<span class="md-sugg__ph">${I.search(16)}</span><span>${o.q}</span>`}
              </button>`)}
            <p class="md-sugg__hint">Enter searches every photo and video. Try a year, “before”, “video”, “drive” or what’s in the picture.</p>
          </div>`}
      </div>
    </div>`;
}

function Results({ route, ctx, albums }) {
  const [res, setRes] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(null);
  const ask = useRef(null);
  const key = JSON.stringify([route.q, route.filters, route.sort]);
  const fetchPage = async (offset = 0) => {
    ask.current?.abort();
    const ctl = new AbortController();
    ask.current = ctl;
    const qs = new URLSearchParams({ search: route.q || '', sort: route.sort || 'best', offset: String(offset) });
    for (const [k, v] of Object.entries(route.filters || {})) if (v) qs.set(k, v);
    setBusy(true);
    try {
      const j = await api(`${API}?${qs}`, { signal: ctl.signal });
      setRes((r) => (offset && r ? { ...j, items: [...r.items, ...j.items] } : j));
      setErr(null);
    } catch (e) { if (e.name !== 'AbortError') setErr(e.message); } finally { if (ask.current === ctl) setBusy(false); }
  };
  useEffect(() => { fetchPage(0); }, [key]);
  const setFilter = (k, v) => ctx.go({ ...route, filters: { ...route.filters, [k]: route.filters?.[k] === v ? null : v } }, { push: false });
  const matched = route.q ? albumMatches(albums, route.q, 4) : [];
  const items = res?.items || [];
  const photos = items.filter((i) => i.kind === 'photo');
  const videos = items.filter((i) => i.kind === 'video');
  const manyAlbums = new Set(photos.map((p) => p.album)).size > 1;
  const facet = (dim, label, words, { max = 8 } = {}) => {
    const list = (res?.facets?.[dim] || []).slice(0, max);
    if (list.length < 2 && !route.filters?.[dim]) return null;
    return html`<div class="md-chips" role="group" aria-label=${label}>
      <span class="md-chiplabel">${label}</span>
      ${list.map((f) => {
        // (a word typed that is a filter, "after" or "2019", shows as its chip pressed)
        const typed = !route.filters?.[dim] && String(res?.query?.[dim] ?? '') === f.value;
        return html`<button key=${f.value} class="md-chipbtn" aria-pressed=${route.filters?.[dim] === f.value || typed} title=${typed ? 'From the words you typed' : null}
          onClick=${() => (typed ? null : setFilter(dim, f.value))}>${words?.[f.value] || f.value}<span class="md-n">${n0(f.n)}</span></button>`;
      })}
    </div>`;
  };
  const corrected = res?.query?.corrected || [];
  return html`
    <div class="md-sec">
      <div class="md-sec__head">
        <p class="md-count-line" role="status" style="font-size:var(--fs-sm)">
          ${!res ? 'Searching…' : res.total ? html`<strong style="color:var(--color-text)">${n0(res.total)}</strong> ${res.total === 1 ? 'result' : 'results'}${route.q ? html` for “${route.q}”` : ''}` : route.q ? `Nothing found for “${route.q}”` : 'Nothing here'}
          ${corrected.length ? html` · showing results for <strong>${corrected.map(([, b]) => b).join(' ')}</strong> (you typed ${corrected.map(([a]) => a).join(' ')})` : ''}
          ${busy && res ? html` <span class="spinner" style="width:12px;height:12px;vertical-align:-1px" />` : ''}
        </p>
        <div class="md-sec__tools">
          <label class="md-small">Sort <select class="md-select" value=${route.sort || 'best'} onChange=${(e) => ctx.go({ ...route, sort: e.target.value }, { push: false })}>
            <option value="best">Best match</option><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
          <button class="btn btn-ghost btn-sm" onClick=${() => ctx.go({ view: 'home', tab: route.tab === 'videos' ? 'kid' : route.tab || 'kid' })}>${I.x(13)} Close search</button>
        </div>
      </div>
      ${matched.length ? html`<div class="md-grid md-grid--small">${matched.map((a) => html`<${AlbumCard} key=${a.key} album=${a} open=${ctx.open} />`)}</div>` : null}
      ${res && html`<div class="md-facets">
        ${facet('kind', 'Type', KIND_WORD)}
        ${facet('stage', 'Stage', STAGE_WORD)}
        ${facet('source', 'From', SOURCE_WORD)}
        ${facet('year', 'Year', null, { max: 12 })}
        ${route.filters?.album && html`<div class="md-chips"><span class="md-chiplabel">Album</span><button class="md-chipbtn" aria-pressed="true" onClick=${() => setFilter('album', route.filters.album)}>${ctx.byKey.get(route.filters.album)?.name || route.filters.album} ✕</button></div>`}
      </div>`}
      ${err && html`<div class="card empty" role="alert"><p class="empty__title">The search didn’t answer</p><p class="empty__text">${err}</p><div class="empty__actions"><button class="btn btn-ghost btn-sm" onClick=${() => fetchPage(0)}>Try again</button></div></div>`}
      ${videos.length ? html`<div class="md-vgrid">${videos.map((v) => html`<${ItemVideoCard} key=${v.id} item=${v} ctx=${ctx} showAlbum onPlay=${() => setViewing({ video: v })} />`)}</div>` : null}
      ${photos.length ? html`
        <div class="md-sec__head"><span></span><div class="md-sec__tools"><button class="btn btn-ghost btn-sm" onClick=${() => ctx.pickAll(photos)}>Pick these ${n0(photos.length)}</button></div></div>
        <div class="md-pgrid">${photos.map((it, i) => html`<${Tile} key=${it.id} item=${it} ctx=${ctx} showAlbum=${manyAlbums} onOpen=${() => setViewing({ list: photos, i })} />`)}</div>` : null}
      ${res && items.length < res.total && html`<button class="btn btn-ghost" style="justify-self:center" disabled=${busy} onClick=${() => fetchPage(items.length)}>${busy ? 'Loading…' : `Show more (${n0(res.total - items.length)} left)`}</button>`}
      ${res && !res.total && html`<div class="card empty"><p class="empty__title">${route.q ? `Nothing matches “${route.q}”` : 'Nothing here'}${Object.values(route.filters || {}).some(Boolean) ? ' with these filters' : ''}</p>
        <p class="empty__text">Try fewer words, a kid’s or event’s name, a year, or what’s in the picture (“wheelchair”, “dog”, “mural”).</p>
        ${Object.values(route.filters || {}).some(Boolean) && html`<div class="empty__actions"><button class="btn btn-ghost btn-sm" onClick=${() => ctx.go({ ...route, filters: {} }, { push: false })}>Clear filters</button></div>`}</div>`}
      ${viewing?.list && html`<${Viewer} list=${viewing.list} start=${viewing.i} ctx=${ctx} onClose=${() => setViewing(null)} />`}
      ${viewing?.video && html`<${VideoViewer} title=${viewing.video.albumName} label=${viewing.video.title || viewing.video.name || 'Video'} uid=${viewing.video.uid} onClose=${() => setViewing(null)} />`}
    </div>`;
}

// ─── The home ─────────────────────────────────────────────────────
function Home({ home, error, onRetry, tab, ctx }) {
  const albums = home?.albums || [];
  const counts = {
    kid: albums.filter((a) => a.kind === 'kid').length, event: albums.filter((a) => a.kind === 'event').length,
    community: albums.filter((a) => a.kind === 'community').length, library: albums.filter((a) => a.kind === 'library').length,
  };
  if (!home && !error) return html`<div style="text-align:center;padding:3rem"><span class="spinner" /></div>`;
  if (!home) return html`<div class="card empty" role="alert"><p class="empty__title">Photos & Videos didn’t load</p><p class="empty__text">${error}</p><div class="empty__actions"><button class="btn btn-ghost btn-sm" onClick=${onRetry}>Try again</button></div></div>`;
  return html`
    <${Happening} activity=${home.activity} ctx=${ctx} />
    <div class="hub-tabs md-tabs" role="tablist" aria-label="Albums">
      ${TABS.map(([k, label]) => html`
        <button key=${k} role="tab" aria-selected=${tab === k} class="hub-tab ${tab === k ? 'active' : ''}"
          onClick=${() => (k === 'videos' ? ctx.go({ view: 'search', q: '', filters: { kind: 'video' }, sort: 'newest', tab: 'videos' }) : ctx.go({ view: 'home', tab: k }, { push: false }))}>
          ${label}${counts[k] != null ? html`<span class="md-tab-n">${n0(counts[k])}</span>` : null}
        </button>`)}
    </div>
    <${Albums} kind=${tab} list=${albums.filter((a) => a.kind === tab)} ctx=${ctx} />`;
}

function Happening({ activity, ctx }) {
  const [more, setMore] = useState(false);
  if (!activity) return null;
  const recent = more ? activity.recent : activity.recent.slice(0, 6);
  return html`
    <section class="card md-now" aria-labelledby="md-now-h">
      <div class="md-now__head"><h3 id="md-now-h">What’s happening</h3></div>
      <div class="md-now__cols">
        <div class="md-now__col">
          <h4>Coming up</h4>
          ${activity.ahead.length ? html`<ul class="md-acts">${activity.ahead.map((x) => html`<${ActItem} key=${x.key} item=${x} ctx=${ctx} />`)}</ul>` : html`<p class="md-empty-line">No reveals or events on the calendar yet.</p>`}
        </div>
        <div class="md-now__col">
          <h4>Recently</h4>
          ${recent.length ? html`<ul class="md-acts">${recent.map((x) => html`<${ActItem} key=${x.key} item=${x} ctx=${ctx} />`)}</ul>` : html`<p class="md-empty-line">Nothing new in the last ${M.RECENT_DAYS} days.</p>`}
          ${activity.recent.length > 6 && html`<button class="btn btn-ghost btn-sm md-more" onClick=${() => setMore(!more)}>${more ? 'Show less' : `Show ${activity.recent.length - 6} more`}</button>`}
        </div>
      </div>
    </section>`;
}

function ActItem({ item: x, ctx }) {
  const album = x.album ? ctx.byKey.get(x.album) : null;
  const icon = (ACT_ICON[x.kind] || I.cal)(16);
  const title = album
    ? html`<a class="md-linkbtn" href=${hashFor({ view: 'album', album: album.key })} onClick=${(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); ctx.open(album.key); }}>${x.title}</a>`
    : html`<strong>${x.title}</strong>`;
  const thumbs = x.video
    ? [html`<img class="is-video" src=${M.streamThumb(x.video, { width: 160, height: 90, time: x.at })} alt="" loading="lazy" />`]
    : (x.thumbs || []).slice(0, 3).map((id) => html`<img src=${/^(https?:)?\//.test(id) ? id : M.imgSrc(id, 'w=96,h=96,fit=cover,gravity=auto,q=65')} alt="" loading="lazy" />`);
  return html`
    <li class="md-act md-act--${x.kind}">
      <span class="md-act__icon" aria-hidden="true">${icon}</span>
      <div>
        <p class="md-act__when">${x.when}</p>
        <p class="md-act__title">${title}${x.kind === 'reveal' && !x.confirmed ? html`<span class="md-tentative">Tentative</span>` : null}</p>
        ${x.detail && html`<p class="md-act__detail">${x.detail}</p>`}
        ${(x.links?.length || x.caption) && html`
          <div class="md-act__links">
            ${x.links.map((l) => html`<a class="md-link" href=${/^https?:/.test(l.url) ? l.url : `${SITE}${l.url}`} target="_blank" rel="noopener">${l.label} ${I.out(11)}</a>`)}
            ${x.caption && html`<button class="md-linkbtn" style="font-weight:500" onClick=${() => copy(x.caption, ctx.addToast, 'Caption copied')}>${I.copy(11)} Copy caption</button>`}
          </div>`}
      </div>
      ${thumbs.length ? html`<div class="md-act__thumbs">${thumbs}</div>` : html`<span />`}
    </li>`;
}

function Albums({ kind, list, ctx }) {
  const [year, setYear] = useState('');
  useEffect(() => setYear(''), [kind]);
  const years = useMemo(() => [...new Set(list.map((a) => a.year).filter(Boolean))].sort((a, b) => b - a), [list]);
  const shown = list.filter((a) => !year || String(a.year) === year);
  if (kind === 'library') {
    const groups = [['library', 'Website folders'], ['archive', 'Drive archive folders'], ['jobtread', 'JobTread jobs no page is matched to (staff only)']];
    return html`${groups.map(([g, label]) => {
      const inGroup = list.filter((a) => (a.group || 'library') === g).sort((a, b) => b.photos + b.videos - (a.photos + a.videos));
      return inGroup.length ? html`<p class="md-group-h">${label}</p><div class="md-grid">${inGroup.map((a) => html`<${AlbumCard} key=${a.key} album=${a} open=${ctx.open} />`)}</div>` : null;
    })}
    ${!list.length && html`<div class="card empty"><p class="empty__title">The library is still being read</p><p class="empty__text">Folders from the website, the Drive archive and YouTube appear here as the index reads them.</p></div>`}`;
  }
  return html`
    ${years.length > 1 && html`
      <div class="md-chips" role="group" aria-label="Year">
        <button class="md-chipbtn" aria-pressed=${!year} onClick=${() => setYear('')}>All years</button>
        ${years.slice(0, 12).map((y) => html`<button key=${y} class="md-chipbtn" aria-pressed=${year === String(y)} onClick=${() => setYear(String(y))}>${y}</button>`)}
      </div>`}
    ${shown.length
      ? html`<div class="md-grid">${shown.map((a) => html`<${AlbumCard} key=${a.key} album=${a} open=${ctx.open} />`)}</div>`
      : html`<div class="card empty"><p class="empty__title">Nothing here yet</p></div>`}`;
}

function AlbumCard({ album: a, open }) {
  const chips = [];
  if (a.public === false) chips.push(html`<span class="md-chip md-chip--staff">${I.lock(11)} Not public yet</span>`);
  if (a.date && a.kind === 'kid' && a.date >= M.easternDay(Date.now())) chips.push(html`<span class="md-chip">${I.cal(11)} Reveal ${shortDay(a.date).replace(/, \d{4}$/, '')}</span>`);
  if (a.newest && isNew(Date.parse(a.newest))) chips.push(html`<span class="md-chip md-chip--new">New</span>`);
  if (a.live) chips.push(html`<span class="md-chip md-chip--live">${I.live(11)} Live reveal</span>`);
  const when = a.kind === 'event' && a.date ? shortDay(a.date) : a.year ? String(a.year) : '';
  const extra = (a.sources?.drive || 0) + (a.sources?.jobtread || 0);
  return html`
    <a class="md-card" href=${hashFor({ view: 'album', album: a.key })} onClick=${(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); open(a.key); }}>
      <span class="md-card__img">
        ${a.cover ? html`<img src=${a.cover} alt="" loading="lazy" decoding="async" />` : html`<span class="md-card__none">${a.kind === 'library' ? I.folder(26) : I.camera(26)}</span>`}
        ${chips.length ? html`<span class="md-card__chips">${chips}</span>` : null}
      </span>
      <span class="md-card__body">
        <span class="md-card__name">${a.name}</span>
        <span class="md-card__meta">${[when, a.photos && plural(a.photos, 'photo'), a.videos && plural(a.videos, 'video')].filter(Boolean).join(' · ')}</span>
        ${extra ? html`<span class="md-card__meta">${[a.sources?.drive && `${n0(a.sources.drive)} in the archive`, a.sources?.jobtread && `${n0(a.sources.jobtread)} in JobTread`].filter(Boolean).join(' · ')}</span>` : null}
      </span>
    </a>`;
}

// ─── One album ────────────────────────────────────────────────────
const STAGES = ['Before', 'During', 'After', 'none'];
function AlbumView({ albumKey, card, ctx, onBack }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [viewing, setViewing] = useState(null);
  const fetchAlbum = () => api(`${API}?album=${encodeURIComponent(albumKey)}`).then(setData).catch((e) => setErr(e));
  useEffect(() => { fetchAlbum(); }, [albumKey]);
  useEffect(() => { window.addEventListener('md-reload-album', fetchAlbum); return () => window.removeEventListener('md-reload-album', fetchAlbum); }, [albumKey]);
  if (err) {
    return html`<div class="md">
      <button class="btn btn-ghost btn-sm md-back" onClick=${onBack}>${I.back()} Back</button>
      <div class="card empty"><p class="empty__title">${err.status === 404 ? 'This album isn’t one you can open' : 'The album didn’t load'}</p>
        <p class="empty__text">${err.status === 404 ? 'It may not be on the website yet, or its page was taken down.' : err.message}</p></div>
    </div>`;
  }
  if (!data) return html`<div style="text-align:center;padding:3rem"><span class="spinner" /></div>`;
  const a = data.album;
  const s = data.sections;
  const record = a.kind !== 'library';
  const gallery = a.files.filter((f) => f.role === 'photo').map((f) => pageItem(a, f));
  const pairFiles = a.files.filter((f) => f.role === 'pair-before' || f.role === 'pair-after');
  const pairItems = pairFiles.map((f) => pageItem(a, f));
  const pairs = [...new Set(pairFiles.map((f) => f.n))].map((n) => pairItems.filter((_, i) => pairFiles[i].n === n));
  const befores = a.files.filter((f) => f.role === 'before').map((f) => pageItem(a, f));
  const page = a.page ? `${SITE}${a.page}` : null;
  const allPhotos = [...gallery, ...pairItems, ...befores, ...s.site, ...(s.inbox || []), ...s.drive, ...s.jobtread];
  const totalVideos = a.videos.length + s.videos.length;
  const metaBits = [
    a.kind === 'kid' && a.date ? `${a.date > M.easternDay(Date.now()) ? 'Reveal' : 'Revealed'} ${longDay(a.date)}` : a.kind === 'event' && a.date ? longDay(a.date) : '',
    (a.rooms || []).join(' and '),
    allPhotos.length && plural(allPhotos.length, 'photo'),
    totalVideos && plural(totalVideos, 'video'),
  ].filter(Boolean);
  const open = (list, i) => setViewing({ list, i });
  return html`
    <div class="md">
      <button class="btn btn-ghost btn-sm md-back" onClick=${onBack}>${I.back()} Back</button>
      <div class="md-album__head">
        <div>
          <h2>${a.name}${a.year && a.kind !== 'event' ? html` <span>${a.year}</span>` : null}</h2>
          ${metaBits.length ? html`<p class="md-album__meta">${metaBits.join(' · ')}</p>` : null}
        </div>
        <div class="md-album__actions">
          ${a.files.length ? html`<a class="btn btn-primary" href=${`${DL}?album=${encodeURIComponent(a.key)}&zip=all`} download onClick=${() => ctx.addToast(`Your ZIP of the page’s ${plural(a.files.length, 'photo')} is downloading.`, 'success')}>${I.download(15)} Download the page’s photos</a>` : null}
        </div>
      </div>
      ${a.public === false && html`<div class="md-note">${I.lock(16)} Not on the website yet: only staff see this album. Don’t post from it until the page is live.</div>`}

      ${record && html`<div class="md-facts">
        ${a.photographer && html`
          <div class="card md-fact">
            <span class="md-fact__label">Photographer</span>
            <span class="md-fact__value">${a.photographer}</span>
            <div class="md-fact__row">
              <button class="btn btn-ghost btn-sm" onClick=${() => copy(`Photos by ${a.photographer}`, ctx.addToast, 'Photo credit copied')}>${I.copy(13)} Copy credit</button>
              ${a.photographerUrl && html`<a class="btn btn-ghost btn-sm" href=${a.photographerUrl} target="_blank" rel="noopener">${I.out(13)} Their site</a>`}
            </div>
          </div>`}
        ${page && html`<div class="card md-fact">
          <span class="md-fact__label">On the website</span>
          <span class="md-fact__value">${page.replace(/^https:\/\//, '')}</span>
          <div class="md-fact__row">
            <button class="btn btn-ghost btn-sm" onClick=${() => copy(page, ctx.addToast, 'Link copied')}>${I.copy(13)} Copy link</button>
            <a class="btn btn-ghost btn-sm" href=${page} target="_blank" rel="noopener">${I.out(13)} Open</a>
          </div>
        </div>`}
        ${a.kind === 'event' && a.location && html`<div class="card md-fact"><span class="md-fact__label">Where</span><span class="md-fact__value">${a.location}</span>${a.time && html`<span class="md-small">${a.time}</span>`}</div>`}
      </div>`}

      ${a.caption && html`
        <section class="card md-sec" style="margin:0;padding:1rem 1.1rem" aria-labelledby="md-cap-h">
          <div class="md-sec__head"><h3 id="md-cap-h">Caption from the Reel</h3>
            <button class="btn btn-ghost btn-sm" onClick=${() => copy(a.caption, ctx.addToast, 'Caption copied')}>${I.copy(13)} Copy caption</button></div>
          <p class="md-caption">${a.caption}</p>
        </section>`}

      ${totalVideos ? html`
        <section class="md-sec" aria-labelledby="md-v-h">
          <div class="md-sec__head"><h3 id="md-v-h">Videos <span class="md-muted">${totalVideos}</span></h3></div>
          <div class="md-vgrid">
            ${a.videos.map((v) => html`<${PageVideoCard} key=${v.key} album=${a} video=${v} fact=${data.facts?.[v.uid]} ctx=${ctx} onPlay=${() => setViewing({ video: { uid: v.uid, start: v.start, label: v.label, title: a.name } })} />`)}
            ${s.videos.map((v) => html`<${ItemVideoCard} key=${v.id} item=${v} ctx=${ctx} onPlay=${() => setViewing({ video: { uid: v.uid, label: v.title || v.name, title: a.name } })} />`)}
          </div>
        </section>` : null}

      ${gallery.length ? html`<${Section} id="md-p" title="On the website" note="The photos on the page, as the page shows them" items=${gallery} ctx=${ctx} onOpen=${open} />` : null}
      ${pairs.length ? html`
        <section class="md-sec" aria-labelledby="md-ba-h">
          <div class="md-sec__head"><h3 id="md-ba-h">Before and after <span class="md-muted">${pairs.length}</span></h3></div>
          <div class="md-pairs">${pairs.map((pr, i) => html`<div class="md-pair" key=${i}>${pr.map((it) => html`<${Tile} key=${it.id + it.tag} item=${it} ctx=${ctx} onOpen=${() => open(pairItems, pairItems.indexOf(it))} />`)}</div>`)}</div>
        </section>` : null}
      ${befores.length ? html`<${Section} id="md-b" title="Before photos" items=${befores} ctx=${ctx} onOpen=${open} />` : null}
      ${s.site.length ? html`<${Section} id="md-s" title=${record ? 'More website photos' : 'Photos'} note=${record ? 'Uploaded for this page but not on it now' : ''} items=${s.site} ctx=${ctx} onOpen=${open} />` : null}
      ${s.drive.length ? html`<${Section} id="md-d" title="Photo archive" note="The originals from the Drive, full size" items=${s.drive} ctx=${ctx} onOpen=${open} stages />` : null}
      ${s.inbox?.length ? html`<${Section} id="md-i" title="Sent in by the team" note="Emailed or texted to Photos & Videos" items=${s.inbox} ctx=${ctx} onOpen=${open} stages />` : null}
      ${s.jobtread.length ? html`<${Section} id="md-j" title="JobTread" note="From the job: the crew’s photos as the build went" items=${s.jobtread} ctx=${ctx} onOpen=${open} stages />` : null}
      ${!allPhotos.length && !totalVideos ? html`<div class="card empty"><p class="empty__title">No photos or videos yet</p></div>` : null}

      ${viewing?.list && html`<${Viewer} list=${viewing.list} start=${viewing.i} ctx=${ctx} onClose=${() => setViewing(null)} />`}
      ${viewing?.video && html`<${VideoViewer} title=${viewing.video.title} label=${viewing.video.label} uid=${viewing.video.uid} start=${viewing.video.start} onClose=${() => setViewing(null)} />`}
    </div>`;
}

/** A section of photos: Before, During, After to narrow to; pick all; shown 120 at a time */
function Section({ id, title, note = '', items, ctx, onOpen, stages = false }) {
  const [stage, setStage] = useState('');
  const [shown, setShown] = useState(120);
  const counts = useMemo(() => { const c = {}; for (const it of items) { const k = it.stage || 'none'; c[k] = (c[k] || 0) + 1; } return c; }, [items]);
  const list = stage ? items.filter((it) => (it.stage || 'none') === stage) : items;
  const usable = list.filter((it) => it.download);
  const allPicked = usable.length > 0 && usable.every((it) => ctx.picked.has(it.id));
  return html`
    <section class="md-sec" aria-labelledby=${`${id}-h`}>
      <div class="md-sec__head">
        <div><h3 id=${`${id}-h`}>${title} <span class="md-muted">${n0(items.length)}</span></h3>${note && html`<p class="md-small">${note}</p>`}</div>
        <div class="md-sec__tools">
          ${stages && Object.keys(counts).length > 1 && html`<div class="md-chips" role="group" aria-label="Stage">
            <button class="md-chipbtn" aria-pressed=${!stage} onClick=${() => setStage('')}>All</button>
            ${STAGES.filter((st) => counts[st]).map((st) => html`<button key=${st} class="md-chipbtn" aria-pressed=${stage === st} onClick=${() => setStage(st)}>${STAGE_WORD[st]}<span class="md-n">${n0(counts[st])}</span></button>`)}
          </div>`}
          ${usable.length ? html`<button class="btn btn-ghost btn-sm" onClick=${() => ctx.pickAll(usable, !allPicked)}>${allPicked ? 'Unpick these' : `Pick ${stage ? 'these' : 'all'} ${n0(usable.length)}`}</button>` : null}
        </div>
      </div>
      <div class="md-pgrid">${list.slice(0, shown).map((it, i) => html`<${Tile} key=${it.id} item=${it} ctx=${ctx} onOpen=${() => onOpen(list, i)} />`)}</div>
      ${list.length > shown && html`<button class="btn btn-ghost" style="justify-self:center" onClick=${() => setShown(shown + 240)}>Show more (${n0(list.length - shown)} left)</button>`}
    </section>`;
}

function Tile({ item: it, ctx, onOpen, showAlbum = false }) {
  const sel = ctx.picked.has(it.id);
  const tags = [];
  if (it.tag) tags.push(html`<span class="md-chip">${it.tag}</span>`);
  else if (it.stage && it.source !== 'site') tags.push(html`<span class="md-chip">${it.stage}</span>`);
  if (it.held) tags.push(html`<span class="md-chip md-chip--staff" title=${it.why || ''}>${I.lock(10)} Staff only</span>`);
  if (it.sender) tags.push(html`<span class="md-chip">${I.inbox(10)} ${it.sender}</span>`);
  if (showAlbum && it.albumName) tags.push(html`<span class="md-chip">${it.albumName}</span>`);
  const label = `${it.albumName || 'Photo'}${it.name ? `, ${it.name}` : ''}`;
  return html`
    <div class="md-tile ${sel ? 'is-sel' : ''} ${it.held ? 'is-held' : ''}">
      <button class="md-tile__open" onClick=${onOpen} aria-label=${`Open ${label}`} title=${[itemCaption(it), it.held ? `Staff only: ${it.why || ''}` : ''].filter(Boolean).join('\n')}>
        ${it.thumb ? html`<img src=${it.thumb} alt=${itemCaption(it)} loading="lazy" decoding="async" onError=${(e) => { e.target.style.visibility = 'hidden'; }} />` : html`<span class="md-tile__ph">${I.camera(22)}</span>`}
      </button>
      ${it.download && html`<button class="md-tile__check" aria-pressed=${sel} aria-label=${`Pick ${label}`} title=${sel ? 'Picked' : 'Pick'} onClick=${() => ctx.toggle(it)}>${I.check(15)}</button>`}
      ${it.download && html`<a class="md-tile__dl" href=${it.download} download aria-label=${`Download ${label}`} title="Download full size">${I.download(15)}</a>`}
      ${tags.length ? html`<span class="md-tile__tags">${tags}</span>` : null}
    </div>`;
}

function Viewer({ list, start, ctx, onClose }) {
  const box = useRef(null);
  const [i, setI] = useState(start);
  useDialog(box, onClose);
  const it = list[i];
  const prev = () => setI((n) => Math.max(0, n - 1));
  const next = () => setI((n) => Math.min(list.length - 1, n + 1));
  useEffect(() => {
    const k = (e) => { if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); } else if (e.key === 'ArrowRight') { e.preventDefault(); next(); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [list.length]);
  useEffect(() => { const n = list[i + 1]; if (n?.full || n?.thumb) { const im = new Image(); im.src = n.full || n.thumb; } }, [i]);
  if (!it) return null;
  const cap = itemCaption(it);
  return html`
    <div class="md-lb" role="dialog" aria-modal="true" aria-label=${`${it.albumName || 'Photo'}: ${i + 1} of ${list.length}`} tabindex="-1" ref=${box}>
      <div class="md-lb__bar">
        <p class="md-lb__title">${it.albumName || ''} <span>· ${i + 1} of ${n0(list.length)}${it.name ? ` · ${it.name}` : ''}${it.stage ? ` · ${it.stage}` : ''}${itemWhen(it) ? ` · ${itemWhen(it)}` : ''}${it.source ? ` · ${SOURCE_WORD[it.source] || ''}` : ''}</span></p>
        ${it.album && !ctx.route?.album && html`<button class="btn btn-ghost btn-sm" onClick=${() => { onClose(); ctx.open(it.album); }}>Open album</button>`}
        ${cap && html`<button class="btn btn-ghost btn-sm" onClick=${() => copy(cap, ctx.addToast, 'Description copied')}>${I.copy(13)} Copy description</button>`}
        ${it.download && html`<a class="btn btn-primary btn-sm" href=${it.download} download>${I.download(14)} Download</a>`}
        <button class="btn btn-ghost btn-sm" onClick=${onClose} aria-label="Close">${I.x(16)}</button>
      </div>
      <div class="md-lb__stage">
        <img key=${it.id} src=${it.full || it.thumb} alt=${cap} />
        <button class="md-lb__nav md-lb__prev" onClick=${prev} disabled=${i === 0} aria-label="Previous">${I.left(22)}</button>
        <button class="md-lb__nav md-lb__next" onClick=${next} disabled=${i === list.length - 1} aria-label="Next">${I.right(22)}</button>
      </div>
      <p class="md-lb__alt">${it.held ? html`<strong>Staff only:</strong> ${it.why} · ` : ''}${cap}</p>
    </div>`;
}

// ─── Videos ───────────────────────────────────────────────────────
/** A video the page itself shows (its makeover video, live reveal, Reel clip, event or project video) */
function PageVideoCard({ album, video: v, fact, ctx, onPlay }) {
  const yt = v.kind === 'link' ? (String(v.url || '').match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([\w-]{11})/) || [])[1] : '';
  const thumb = v.uid ? M.streamThumb(v.uid, { time: v.start != null ? v.start + Math.min(5, (v.seconds || 10) / 2) : null }) : yt ? `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` : '';
  const secs = v.kind === 'reel' ? v.seconds : fact?.seconds;
  const meta = [secs ? (secs < 120 ? `${secs} seconds` : duration(secs)) : '', v.kind !== 'reel' && fact?.bytes ? bytes(fact.bytes) : '', v.date ? `${v.kind === 'reel' ? 'Posted' : 'Live'} ${shortDay(v.date)}` : ''].filter(Boolean).join(' · ');
  const kindChip = v.kind === 'live' ? html`<span class="md-chip md-chip--live">${I.live(11)} Live</span>` : v.kind === 'reel' ? html`<span class="md-chip">${I.reel(11)} Reel</span>` : null;
  const direct = v.kind === 'reel' && v.start != null;
  return html`
    <div class="md-vcard">
      ${v.uid
        ? html`<button class="md-vthumb" onClick=${onPlay}><span class="sr-only">Play ${v.label.toLowerCase()}</span>${thumb && html`<img src=${thumb} alt="" loading="lazy" />`}<span class="md-vthumb__play">${I.play(20)}</span>${secs ? html`<span class="md-vthumb__dur">${duration(secs)}</span>` : null}${kindChip && html`<span class="md-vthumb__kind">${kindChip}</span>`}</button>`
        : html`<a class="md-vthumb" href=${v.url} target="_blank" rel="noopener"><span class="sr-only">Open ${v.label.toLowerCase()}</span>${thumb && html`<img src=${thumb} alt="" loading="lazy" />`}<span class="md-vthumb__play">${I.out(18)}</span></a>`}
      <div class="md-vcard__body">
        <p class="md-vcard__label">${v.label}</p>
        ${meta && html`<p class="md-vcard__meta">${meta}</p>`}
        <div class="md-vcard__actions">
          ${v.uid ? html`<${VideoDownload} href=${`${DL}?album=${encodeURIComponent(album.key)}&video=${encodeURIComponent(v.key)}`}
            prepare=${direct ? null : `${API}?album=${encodeURIComponent(album.key)}&mp4=${encodeURIComponent(v.key)}`} label=${`${v.label.toLowerCase()} of ${album.name}`} ctx=${ctx} />`
            : html`<a class="md-link" href=${v.url} target="_blank" rel="noopener">${I.out(12)} ${yt ? 'Open on YouTube' : 'Open'}</a>`}
          ${v.links.map((l) => html`<a class="md-link" href=${l.url} target="_blank" rel="noopener">${I.out(12)} ${l.label}</a>`)}
          ${v.caption && html`<button class="md-linkbtn" onClick=${() => copy(v.caption, ctx.addToast, 'Caption copied')}>${I.copy(12)} Caption</button>`}
        </div>
      </div>
    </div>`;
}

/** A video from the index: Stream (play, MP4 once made), the Drive archive or JobTread (the original), YouTube (a link) */
function ItemVideoCard({ item: v, ctx, onPlay, showAlbum = false }) {
  const secs = v.seconds;
  const meta = [secs ? (secs < 120 ? `${secs} seconds` : duration(secs)) : '', bytes(v.size), itemWhen(v), v.sender ? `From ${v.sender}` : SOURCE_WORD[v.source]].filter(Boolean).join(' · ');
  // (a sent-in video is named by its file; who sent it is in the line under)
  const label = v.source === 'inbox' ? v.name || 'Video' : v.title || v.name || 'Video';
  const playable = (v.source === 'stream' || v.source === 'inbox') && v.uid;
  const thumbEl = v.thumb ? html`<img src=${v.thumb} alt="" loading="lazy" onError=${(e) => { e.target.style.visibility = 'hidden'; }} />` : null;
  return html`
    <div class="md-vcard ${v.held ? 'is-held' : ''}">
      ${playable
        ? html`<button class="md-vthumb" onClick=${onPlay}><span class="sr-only">Play ${label}</span>${thumbEl}<span class="md-vthumb__play">${I.play(20)}</span>${secs ? html`<span class="md-vthumb__dur">${duration(secs)}</span>` : null}</button>`
        : v.url ? html`<a class="md-vthumb" href=${v.url} target="_blank" rel="noopener"><span class="sr-only">Open ${v.title || 'video'} on YouTube</span>${thumbEl}<span class="md-vthumb__play">${I.out(18)}</span>${secs ? html`<span class="md-vthumb__dur">${duration(secs)}</span>` : null}</a>`
        : html`<span class="md-vthumb" style="cursor:default">${thumbEl}<span class="md-vthumb__play">${I.video(18)}</span>${secs ? html`<span class="md-vthumb__dur">${duration(secs)}</span>` : null}${v.stage ? html`<span class="md-vthumb__kind"><span class="md-chip">${v.stage}</span></span>` : null}</span>`}
      <div class="md-vcard__body">
        ${showAlbum && v.albumName && html`<a class="md-linkbtn" style="font-size:var(--fs-sm)" href=${hashFor({ view: 'album', album: v.album })} onClick=${(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); ctx.open(v.album); }}>${v.albumName}</a>`}
        <p class="md-vcard__label">${label}</p>
        ${meta && html`<p class="md-vcard__meta">${meta}</p>`}
        ${v.held && html`<p class="md-vcard__meta">${I.lock(11)} Staff only: ${v.why}</p>`}
        <div class="md-vcard__actions">
          ${v.source === 'youtube' ? html`<a class="md-link" href=${v.url} target="_blank" rel="noopener">${I.out(12)} Open on YouTube</a>`
            : v.source === 'stream' || v.source === 'inbox' ? html`<${VideoDownload} href=${v.download} prepare=${`${API}?item=${encodeURIComponent(v.id)}&mp4=1`} label=${label} ctx=${ctx} />`
            : html`<a class="btn btn-ghost btn-sm" href=${v.download} download>${I.download(14)} Download${v.size ? ` (${bytes(v.size)})` : ''}</a>`}
        </div>
      </div>
    </div>`;
}

/**
 * Download MP4. Stream makes a video's MP4 on the first ask: the button says how far along it is, and the download
 * starts by itself once it's ready (while the page is open). A Reel clip (prepare null) is cut as it downloads
 */
function VideoDownload({ href, prepare, label, ctx }) {
  const [state, setState] = useState(prepare ? null : { ready: true });
  const timer = useRef(null);
  const link = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const check = async (fromClick) => {
    try {
      const j = await api(prepare);
      if (j.ready) {
        setState({ ready: true });
        if (!fromClick) ctx.addToast(`The ${label} is ready. It’s downloading now.`, 'success');
        requestAnimationFrame(() => link.current?.click());
        return;
      }
      setState({ making: true, percent: j.percent || 0 });
      timer.current = setTimeout(() => check(false), 5000);
    } catch (e) { setState({ error: e.message }); }
  };
  if (state?.ready) return html`<a ref=${link} class="btn btn-primary btn-sm" href=${href} download>${I.download(14)} Download MP4</a>`;
  if (state?.making) return html`<span class="md-making" role="status"><span class="spinner" style="width:12px;height:12px;vertical-align:-1px" /> Stream is making the MP4${state.percent ? `, ${state.percent}%` : ''}. It can take a few minutes.</span>`;
  return html`
    <button class="btn btn-ghost btn-sm" onClick=${() => { setState({ making: true, percent: 0 }); check(true); }}>${I.download(14)} Download MP4</button>
    ${state?.error && html`<span class="md-making" style="color:var(--tone-danger-fg)">${state.error}</span>`}`;
}

function VideoViewer({ title, label, uid, start = null, onClose }) {
  const box = useRef(null);
  useDialog(box, onClose);
  return html`
    <div class="md-lb" role="dialog" aria-modal="true" aria-label=${`${title || ''}: ${label}`} tabindex="-1" ref=${box}>
      <div class="md-lb__bar">
        <p class="md-lb__title">${title || ''} <span>· ${label}</span></p>
        <button class="btn btn-ghost btn-sm" onClick=${onClose} aria-label="Close">${I.x(16)}</button>
      </div>
      <div class="md-lb__stage"><iframe class="md-lb__frame" src=${M.streamEmbed(uid, { start })} title=${label} allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
      <p class="md-lb__alt">${start != null ? 'The Reel starts here in the recording. Download MP4 saves just the clip.' : ''}</p>
    </div>`;
}

// ─── Picking and the ZIP ──────────────────────────────────────────
function PickBar({ picked, clear, addToast, staff = false, onMove = null }) {
  const formRef = useRef(null);
  const list = [...picked.values()];
  const albums = new Set(list.map((it) => it.albumName)).size;
  const tooMany = list.length > M.ZIP_MAX;
  const size = list.reduce((s, it) => s + (Number(it.size) || 0), 0);
  const go = () => {
    if (tooMany) { addToast(`At most ${M.ZIP_MAX} photos in one ZIP. Unpick some.`, 'error'); return; }
    formRef.current.querySelector('[name=items]').value = list.map((it) => it.id).join('\n');
    formRef.current.submit();
    addToast(`Your ZIP of ${plural(list.length, 'photo')} is downloading. A big one takes a moment to start.`, 'success');
  };
  return html`
    <div class="md-pickbar" role="region" aria-label="Picked photos">
      <span>${plural(list.length, 'photo')} picked${albums > 1 ? html` <small>from ${albums} albums</small>` : ''}${size ? html` <small>· about ${bytes(size)}</small>` : ''}</span>
      <button class="btn btn-primary btn-sm" onClick=${go} disabled=${tooMany}>${I.download(14)} Download ZIP</button>
      ${staff && list.every((it) => String(it.id).startsWith('inb:')) ? html`<button class="btn btn-ghost btn-sm" onClick=${() => onMove?.(list)}>Move to album…</button>` : null}
      <button class="btn btn-ghost btn-sm" onClick=${clear}>Clear</button>
      <form ref=${formRef} method="POST" action=${DL} target="md-dl" hidden><input type="hidden" name="items" value="" /></form>
      <iframe name="md-dl" title="Downloads" hidden></iframe>
    </div>`;
}

// ─── Staff: who signs in, and how the index is doing ─────────────
function IndexStatus({ facts }) {
  const [open, setOpen] = useState(false);
  const c = facts.counts || {};
  const photos = Object.values(c).reduce((s, x) => s + (x.photo || 0), 0);
  const described = Math.max(0, photos - (facts.undescribed || 0));
  const pct = photos ? Math.round((described / photos) * 100) : 0;
  const src = facts.sources || {};
  const errors = Object.entries(src).filter(([, s]) => s.error);
  return html`
    <div>
      <div class="md-status">
        <span><span class="md-bar"><span style=${`width:${pct}%`} /></span>${pct}% of photos described for search</span>
        ${facts.unchecked ? html`<span>${n0(facts.unchecked)} before photos waiting for the address check</span>` : null}
        ${facts.held ? html`<span>${n0(facts.held)} held by it (staff only)</span>` : null}
        ${errors.length ? html`<span class="md-bad">${errors.length} source${errors.length === 1 ? '' : 's'} couldn’t be read</span>` : null}
        <button class="md-linkbtn" style="font-weight:500" onClick=${() => setOpen(!open)}>${open ? 'Hide details' : 'Details'}</button>
      </div>
      ${open && html`<div class="md-sources">
        ${['site', 'drive', 'jobtread', 'stream', 'youtube'].map((k) => html`
          <div class="md-source" key=${k}>
            <strong>${SOURCE_WORD[k]}</strong>
            <span>${n0(c[k]?.photo || 0)} photos · ${n0(c[k]?.video || 0)} videos</span>
            <span>${src[k]?.cursor != null ? `Reading now: ${src[k].note || ''}` : src[k]?.doneAt ? `Read ${ago(src[k].doneAt)}` : 'Not read yet'}</span>
            ${src[k]?.error && html`<span class="md-bad">${src[k].error}</span>`}
          </div>`)}
      </div>`}
    </div>`;
}

function PeopleDialog({ home, setHome, addToast, onClose }) {
  const box = useRef(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  useDialog(box, onClose, busy);
  const people = home?.people || [];
  const act = async (body) => {
    setBusy(true);
    try {
      const j = await api(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      setHome((h) => ({ ...h, people: j.people }));
      if (j.access?.configured && !j.access.ok) addToast(`Saved. Cloudflare Access hasn’t taken it yet: ${j.access.error || 'it will try again in a few minutes'}`, 'error');
      else addToast(body.act === 'add-person' ? `${body.name || body.email} can sign in now` : 'Taken off', 'success');
      if (body.act === 'add-person') { setName(''); setEmail(''); }
    } catch (e) { addToast(e.message, 'error'); } finally { setBusy(false); }
  };
  return html`
    <div class="md-modal-bg" onClick=${(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div class="md-modal" role="dialog" aria-modal="true" aria-labelledby="md-people-h" tabindex="-1" ref=${box}>
        <h2 id="md-people-h">Who can sign in for Photos & Videos</h2>
        <p class="md-small" style="margin:0">They sign in with a code emailed to their address and see Photos & Videos only, nothing else in the admin: albums on the website, and before photos once the address check has passed them. A soardcharity.com address added here is limited the same way.</p>
        ${people.length ? html`<ul class="md-people">${people.map((p) => html`
          <li key=${p.email}><div><strong>${p.name || p.email}</strong><span class="md-small">${p.name ? `${p.email} · ` : ''}${p.lastSeen ? `last here ${ago(p.lastSeen)}` : 'hasn’t signed in yet'}</span></div>
            <button class="btn btn-ghost btn-sm" disabled=${busy} onClick=${() => act({ act: 'remove-person', email: p.email })}>Take off</button></li>`)}</ul>`
          : html`<p class="md-small" style="margin:0">Nobody yet.</p>`}
        <form class="md-form" onSubmit=${(e) => { e.preventDefault(); if (email.trim()) act({ act: 'add-person', email: email.trim(), name: name.trim() }); }}>
          <label>Name<input value=${name} onInput=${(e) => setName(e.target.value)} placeholder="Their name" /></label>
          <label>Email<input type="email" value=${email} onInput=${(e) => setEmail(e.target.value)} placeholder="name@example.com" required /></label>
          <button class="btn btn-primary" type="submit" disabled=${busy || !email.trim()}>Add</button>
        </form>
        <div class="md-signlink"><span class="md-small">Their link:</span><code>${SIGN_IN}</code><button class="btn btn-ghost btn-sm" onClick=${() => copy(SIGN_IN, addToast, 'Link copied')}>${I.copy(13)} Copy</button></div>
        ${home?.access && !home.access.ok && home.access.configured && html`<p class="md-small md-bad" style="margin:0">Cloudflare Access isn’t taking the list right now${home.access.error ? `: ${home.access.error}` : ''}. New people can’t sign in until it does.</p>`}
        <div style="display:flex;justify-content:flex-end"><button class="btn btn-ghost" onClick=${onClose} disabled=${busy}>Done</button></div>
      </div>
    </div>`;
}

// ─── Staff: photos sent in by email or text ───────────────────────
const prettyPhone = (p) => { const d = String(p || '').replace(/\D/g, ''); const n = d.length === 11 && d[0] === '1' ? d.slice(1) : d; return n.length === 10 ? `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}` : p; };
function SendDialog({ addToast, ctx, onClose }) {
  const box = useRef(null);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '' });
  useDialog(box, onClose, busy);
  const load = () => api(`${API}?inbox=1`).then(setData).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const act = async (body, done = 'Done') => {
    setBusy(true);
    try {
      await api(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      addToast(done, 'success');
      await load();
      return true;
    } catch (e) { addToast(e.message, 'error'); return false; } finally { setBusy(false); }
  };
  const held = (data?.messages || []).filter((m) => m.state === 'held');
  return html`
    <div class="md-modal-bg" onClick=${(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div class="md-modal md-modal--wide" role="dialog" aria-modal="true" aria-labelledby="md-send-h" tabindex="-1" ref=${box}>
        <h2 id="md-send-h">Send photos in</h2>
        ${err && html`<p class="md-small md-bad" style="margin:0">${err}</p>`}
        ${!data && !err && html`<p style="text-align:center"><span class="spinner" /></p>`}
        ${data && html`
          <div class="md-send">
            <div class="md-send__box">
              <h3>${I.mail(15)} Email</h3>
              <span class="md-send__addr">${data.address}</span>
              <div class="md-fact__row"><button class="btn btn-ghost btn-sm" onClick=${() => copy(data.address, addToast, 'Address copied')}>${I.copy(13)} Copy</button></div>
              <span class="md-small">${data.emailReady ? 'Full size: attach photos and videos, or share them to Mail and pick Actual Size. Big videos can go as Mail Drop links.' : 'Not connected yet: the email Worker and its key aren’t set up.'}</span>
            </div>
            <div class="md-send__box">
              <h3>${I.phone(15)} Text</h3>
              ${data.number
                ? html`<span class="md-send__addr">${prettyPhone(data.number)}</span>
                  <div class="md-fact__row"><button class="btn btn-ghost btn-sm" onClick=${() => copy(prettyPhone(data.number), addToast, 'Number copied')}>${I.copy(13)} Copy</button></div>
                  <span class="md-small">${data.text?.connected === false ? html`<span class="md-bad">Twilio isn’t sending its texts here any more.</span>` : 'Phone carriers shrink texted photos (to about 1 MB) and cut long videos. Email keeps them full size.'}</span>`
                : html`<span class="md-small">SOARD Photos gets a number of its own (a toll-free one that takes photos and videos). Twilio charges for the number each month and a little for each text.</span>
                  <div class="md-fact__row"><button class="btn btn-primary btn-sm" disabled=${busy} onClick=${() => act({ act: 'setup-text-number' }, 'The text number is set up')}>Set up the text number</button></div>`}
            </div>
          </div>
          <ol class="md-steps">
            <li>Put the kid’s or event’s name in the subject or the text (“Colin demo day”) and the files go to that album. Without one, they go by where and when they were taken, else to Sent in by the team.</li>
            <li>“Before”, “progress” or “reveal” in the words sorts them too.</li>
            <li>Anything from someone not on the list waits below for a look, and nobody is answered.</li>
          </ol>

          <div class="md-sec" style="gap:0.5rem">
            <h3>Who can send</h3>
            <p class="md-small" style="margin:0">Anyone with a soardcharity.com email, and staff phones on Reveals → Settings → Alerts. Add anyone else here.</p>
            ${data.senders.length ? html`<ul class="md-people">${data.senders.map((p) => html`
              <li key=${p.id}><div><strong>${p.name}</strong><span class="md-small">${[p.email, p.phone && prettyPhone(p.phone)].filter(Boolean).join(' · ')}</span></div>
                <button class="btn btn-ghost btn-sm" disabled=${busy} onClick=${() => act({ act: 'remove-sender', id: p.id }, 'Taken off')}>Take off</button></li>`)}</ul>` : null}
            <form class="md-form" style="grid-template-columns:1fr 1.2fr 1fr auto" onSubmit=${async (e) => { e.preventDefault(); if (await act({ act: 'add-sender', ...form }, `${form.name} can send photos in`)) setForm({ name: '', email: '', phone: '' }); }}>
              <label>Name<input value=${form.name} onInput=${(e) => setForm({ ...form, name: e.target.value })} placeholder="Their name" required /></label>
              <label>Email<input type="email" value=${form.email} onInput=${(e) => setForm({ ...form, email: e.target.value })} placeholder="name@example.com" /></label>
              <label>Phone<input type="tel" value=${form.phone} onInput=${(e) => setForm({ ...form, phone: e.target.value })} placeholder="(404) 555-0123" /></label>
              <button class="btn btn-primary" type="submit" disabled=${busy || !form.name.trim() || (!form.email.trim() && !form.phone.trim())}>Add</button>
            </form>
          </div>

          <div class="md-sec" style="gap:0.5rem">
            <h3>Answering the sender</h3>
            <p class="md-small" style="margin:0">${data.replies ? 'On: each sender on the list is answered.' : 'Off: nobody is answered yet. When it’s on, each sender on the list gets one of these:'}</p>
            <p class="md-quote">${data.wording.filed}</p>
            <p class="md-quote">${data.wording.unfiled}</p>
          </div>

          <div class="md-sec" style="gap:0.5rem">
            <h3>Sent in lately${held.length ? html` <span class="md-chip md-chip--staff">${held.length} waiting for a look</span>` : ''}</h3>
            ${data.messages.length ? html`<ul class="md-msgs">${data.messages.map((m) => html`
              <li key=${m.id} class=${m.state === 'held' ? 'is-held' : ''}>
                ${m.channel === 'text' ? I.phone(15) : I.mail(15)}
                <div><strong>${m.fromName || m.from}</strong> <span class="md-small">${ago(m.receivedAt)} · ${plural(m.files || 0, 'file')}${m.album ? ` · ${ctx.byKey.get(m.album)?.name || (m.album === 'lib:inbox' ? 'Sent in by the team' : m.album)}` : ''}</span>
                  ${m.subject || m.note ? html`<span class="md-small" style="display:block">“${[m.subject, m.note].filter(Boolean).join(' · ').slice(0, 120)}”</span>` : null}
                  ${m.state === 'held' ? html`<span class="md-small md-bad" style="display:block">${m.why}</span>` : m.error ? html`<span class="md-small md-bad" style="display:block">${m.error}</span>` : null}</div>
                ${m.state === 'held' ? html`<button class="btn btn-ghost btn-sm" disabled=${busy} onClick=${() => act({ act: 'let-through', id: m.id }, 'Let through and filed')}>Let through</button>` : null}
                <button class="btn btn-ghost btn-sm" disabled=${busy} onClick=${() => act({ act: 'delete-message', id: m.id }, 'Deleted')}>Delete</button>
              </li>`)}</ul>` : html`<p class="md-small" style="margin:0">Nothing yet.</p>`}
          </div>`}
        <div style="display:flex;justify-content:flex-end"><button class="btn btn-ghost" onClick=${onClose} disabled=${busy}>Done</button></div>
      </div>
    </div>`;
}

function MoveDialog({ items, albums, addToast, onClose, onMoved }) {
  const box = useRef(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  useDialog(box, onClose, busy);
  const list = (q.trim() ? albumMatches(albums, q, 12) : albums.filter((a) => a.kind !== 'library').slice(0, 12)).filter((a) => a.kind !== 'library' || a.key === 'lib:inbox');
  const move = async (a) => {
    setBusy(true);
    try {
      const j = await api(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ act: 'move', ids: items.map((it) => it.id), album: a.key }) });
      addToast(`${plural(j.moved, 'file')} moved to ${a.name}`, 'success');
      onMoved();
    } catch (e) { addToast(e.message, 'error'); } finally { setBusy(false); }
  };
  return html`
    <div class="md-modal-bg" onClick=${(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div class="md-modal" role="dialog" aria-modal="true" aria-labelledby="md-move-h" tabindex="-1" ref=${box}>
        <h2 id="md-move-h">Move ${plural(items.length, 'file')} to…</h2>
        <label class="md-search__box" style="height:44px"><span class="sr-only">Find an album</span>${I.search(16)}<input value=${q} placeholder="A kid, an event, a project" onInput=${(e) => setQ(e.target.value)} /></label>
        <ul class="md-pickalbums">${list.map((a) => html`<li key=${a.key}><button class="md-sugg__item" disabled=${busy} onClick=${() => move(a)}>
          ${a.cover ? html`<img src=${a.cover} alt="" loading="lazy" />` : html`<span class="md-sugg__ph">${I.folder(16)}</span>`}
          <span><strong>${a.name}</strong>${a.year && a.kind !== 'event' ? html` <span class="md-muted">${a.year}</span>` : ''}</span></button></li>`)}</ul>
        <div style="display:flex;justify-content:flex-end"><button class="btn btn-ghost" onClick=${onClose} disabled=${busy}>Cancel</button></div>
      </div>
    </div>`;
}
