/**
 * Admin → Photos & Videos (#media)
 * ===========================================================================
 * Peter, Nov 25 2026: "i need to create a photo/video gallery for my social
 * media person to download any photo or video asset that we have ... and
 * include a list of recent activities or something related to our reveals
 * and events".
 *
 * At the top, What's happening: reveals and events coming up, and what just
 * happened (a reveal that went live, its Reel, new photos as they come in).
 * Below, an album for every kid, event and community project on the website,
 * and every video in one place. Any photo downloads full size, one at a time
 * or as a ZIP of the album or of the ones picked; any video downloads as an
 * MP4. An album holds exactly what its public page shows
 * (./media-shared.js), so nothing private can be downloaded from here.
 *
 * Addresses: #media (reveals), #media/events, #media/community, #media/videos,
 * #media/kid/<slug>, #media/event/<slug>, #media/community/<slug>.
 * Server: /api/media-admin (schedule, live reveals, video lengths, MP4s),
 * /api/media-download (the files).
 */

import { h, htm, useState, useEffect, useMemo, useRef } from './vendor.js';
import { useDialog } from './dialog.js';
import * as M from './media-shared.js';

const html = htm.bind(h);
const API = '/api/media-admin';
const DL = '/api/media-download';
const SITE = 'https://sunshineonaranneyday.com';

const KINDS = [['kid', 'Reveals', 'reveals'], ['event', 'Events', 'events'], ['community', 'Community', 'community'], ['videos', 'Videos', 'videos']];
const BACK_TO = { kid: 'All reveals', event: 'All events', community: 'All community projects', videos: 'All videos' };

// ─── Address ──────────────────────────────────────────────────────
const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
export function readHash(hash = location.hash) {
  const m = String(hash).match(/^#media(?:\/([^?]*))?/);
  if (!m) return null;
  const parts = String(m[1] || '').split('/').filter(Boolean).map(dec);
  if (['kid', 'event', 'community'].includes(parts[0]) && parts[1]) return { tab: parts[0], album: `${parts[0]}:${parts[1]}` };
  const tab = KINDS.find(([, , seg]) => seg === parts[0])?.[0];
  return { tab: tab || 'kid' };
}
export const hashFor = (r) => (r.album
  ? `#media/${r.album.split(':')[0]}/${encodeURIComponent(r.album.split(':').slice(1).join(':'))}`
  : r.tab && r.tab !== 'kid' ? `#media/${KINDS.find(([k]) => k === r.tab)?.[2] || ''}` : '#media');

// ─── Words ────────────────────────────────────────────────────────
const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const shortDay = (date) => (date ? new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');
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
const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const isNew = (ms) => !!ms && Date.now() - ms < M.NEW_DAYS * 86_400_000;
const roleWord = { photo: 'Photo', 'pair-before': 'Before', 'pair-after': 'After', before: 'Before' };

const photoHref = (album, f) => `${DL}?album=${encodeURIComponent(album.key)}&image=${encodeURIComponent(f.id)}`;
const zipAllHref = (album) => `${DL}?album=${encodeURIComponent(album.key)}&zip=all`;
const videoHref = (album, v) => `${DL}?album=${encodeURIComponent(album.key)}&video=${encodeURIComponent(v.key)}`;
const youTubeId = (url) => (String(url || '').match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([\w-]{11})/) || [])[1] || '';

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
  reel: (s) => svg(html`<rect x="2" y="2" width="20" height="20" rx="5"/><path d="M2 8h20M8 2l3 6M14 2l3 6"/><path d="m10 12 5 3-5 3z"/>`, s),
  party: (s) => svg(html`<path d="M5.8 11.3 2 22l10.7-3.79"/><path d="M4 3h.01M22 8h.01M15 2h.01M22 20h.01"/><path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10"/><path d="m11.25 7.25.31-1.66"/><path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z"/>`, s),
};
const ACT_ICON = { reveal: I.cal, event: I.party, live: I.live, reel: I.reel, revealed: I.party, 'event-past': I.party, photos: I.camera };

// ─── Styles ───────────────────────────────────────────────────────
const STYLES = `
.md { display: grid; gap: 1.5rem; }
.md h3 { margin: 0; font-size: var(--fs-md); }
.md-muted { color: var(--color-text-secondary); }
.md-link { color: var(--color-text); text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--color-border-strong); }
.md-link:hover { text-decoration-color: currentColor; }
.md-linkbtn { all: unset; cursor: pointer; color: var(--color-text); font-weight: 700; text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--color-border-strong); }
.md-linkbtn:hover { text-decoration-color: currentColor; }
.md-linkbtn:focus-visible, .md-card:focus-visible, .md-tile button:focus-visible, .md-tile a:focus-visible, .md-vthumb:focus-visible { outline: 2px solid var(--color-text); outline-offset: 2px; }

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

/* Tabs and tools */
.md-tabs { margin-bottom: 0; }
.md-tab-n { margin-left: 0.35rem; font-weight: 500; color: var(--color-text-muted); }
.md-tools { display: flex; flex-wrap: wrap; gap: 0.6rem 1rem; align-items: center; }
.md-search { display: flex; align-items: center; gap: 0.5rem; min-width: min(100%, 340px); padding: 0 0.75rem; height: 40px; border: 1px solid var(--color-border-strong); border-radius: var(--radius-md); background: var(--color-bg-card); color: var(--color-text-secondary); }
.md-search:focus-within { border-color: var(--color-text); box-shadow: 0 0 0 3px var(--color-primary-ring); }
.md-search input { flex: 1; min-width: 0; border: 0; outline: 0; background: none; font: inherit; font-size: var(--fs-sm); color: var(--color-text); }
.md-chips { display: flex; flex-wrap: wrap; gap: 0.35rem; }
.md-chips button { border: 1px solid var(--color-border-strong); background: var(--color-bg-card); color: var(--color-text); border-radius: 999px; padding: 0.3rem 0.75rem; font: inherit; font-size: var(--fs-xs); font-weight: 600; cursor: pointer; }
.md-chips button[aria-pressed="true"] { background: var(--color-text); border-color: var(--color-text); color: var(--color-bg-card); }
.md-count-line { margin: 0; font-size: var(--fs-xs); color: var(--color-text-secondary); }

/* Album cards */
.md-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 1rem; }
.md-card { display: flex; flex-direction: column; border: 1px solid var(--color-border); border-radius: var(--radius-lg); overflow: hidden; background: var(--color-bg-card); color: inherit; text-decoration: none; transition: box-shadow 0.15s, transform 0.15s; }
.md-card:hover { box-shadow: var(--shadow-md); transform: translateY(-1px); }
.md-card__img { position: relative; aspect-ratio: 4 / 3; background: var(--color-bg-secondary); }
.md-card__img img { width: 100%; height: 100%; object-fit: cover; display: block; }
.md-card__none { position: absolute; inset: 0; display: grid; place-items: center; color: var(--color-text-muted); }
.md-card__chips { position: absolute; left: 0.5rem; top: 0.5rem; right: 0.5rem; display: flex; flex-wrap: wrap; gap: 0.3rem; }
.md-chip { display: inline-flex; align-items: center; gap: 0.25rem; padding: 0.15rem 0.5rem; border-radius: 999px; font-size: var(--fs-2xs); font-weight: 700; line-height: 1.4; background: rgba(255,255,255,0.94); color: #1A1B1F; box-shadow: 0 1px 2px rgba(0,0,0,0.15); }
.md-chip--new { background: var(--color-primary); color: #1A1B1F; }
.md-chip--live { background: #B42318; color: #fff; }
.md-card__body { display: grid; gap: 0.15rem; padding: 0.7rem 0.85rem 0.8rem; }
.md-card__name { font-weight: 700; font-size: var(--fs-sm); overflow-wrap: anywhere; }
.md-card__meta { font-size: var(--fs-xs); color: var(--color-text-secondary); }

/* An album */
.md-back { display: inline-flex; align-items: center; gap: 0.35rem; justify-self: start; }
.md-album__head { display: flex; flex-wrap: wrap; gap: 1rem 1.5rem; align-items: flex-end; justify-content: space-between; }
.md-album__head h2 { margin: 0; font-size: var(--fs-2xl); letter-spacing: -0.02em; line-height: 1.15; }
.md-album__head h2 span { color: var(--color-text-muted); font-weight: 500; }
.md-album__meta { margin: 0.35rem 0 0; color: var(--color-text-secondary); font-size: var(--fs-sm); }
.md-album__actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.md-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 0.75rem; }
.md-fact { margin: 0; padding: 0.85rem 1rem; display: grid; gap: 0.35rem; align-content: start; }
.md-fact__label { font-size: var(--fs-2xs); font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-text-secondary); }
.md-fact__value { font-size: var(--fs-sm); font-weight: 600; overflow-wrap: anywhere; }
.md-fact__row { display: flex; flex-wrap: wrap; gap: 0.35rem; }
.md-caption { white-space: pre-wrap; margin: 0; font-size: var(--fs-sm); line-height: 1.55; max-height: 14rem; overflow: auto; }
.md-sec { display: grid; gap: 0.75rem; }
.md-sec__head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem 1rem; }
.md-sec__head h3 .md-muted { font-weight: 500; }
.md-sec__tools { display: flex; flex-wrap: wrap; gap: 0.4rem; }

/* Photos */
.md-pgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 0.5rem; }
.md-pairs { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1rem; }
.md-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 0.35rem; }
.md-tile { position: relative; aspect-ratio: 1; border-radius: var(--radius-md); overflow: hidden; background: var(--color-bg-secondary); }
.md-tile.is-sel { box-shadow: 0 0 0 3px var(--color-text); }
.md-tile__open { all: unset; display: block; width: 100%; height: 100%; cursor: zoom-in; }
.md-tile__open img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.2s; }
.md-tile:hover .md-tile__open img { transform: scale(1.03); }
.md-tile__check, .md-tile__dl { position: absolute; top: 0.4rem; width: 30px; height: 30px; display: grid; place-items: center; border-radius: 50%; border: 0; cursor: pointer; background: rgba(255,255,255,0.92); color: #1A1B1F; box-shadow: 0 1px 3px rgba(0,0,0,0.25); opacity: 0; transition: opacity 0.12s; }
.md-tile__check { left: 0.4rem; }
.md-tile__dl { right: 0.4rem; }
.md-tile:hover .md-tile__check, .md-tile:hover .md-tile__dl, .md-tile:focus-within .md-tile__check, .md-tile:focus-within .md-tile__dl, .md-picking .md-tile__check, .md-tile.is-sel .md-tile__check { opacity: 1; }
.md-tile.is-sel .md-tile__check { background: var(--color-text); color: var(--color-bg-card); }
.md-tile__check svg { opacity: 0.35; }
.md-tile.is-sel .md-tile__check svg { opacity: 1; }
.md-tile__tag { position: absolute; left: 0.4rem; bottom: 0.4rem; }
@media (hover: none) { .md-tile__check, .md-tile__dl { opacity: 1; } }

/* The bar while photos are picked */
.md-pickbar { position: sticky; bottom: 1rem; z-index: 5; justify-self: center; display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 1rem; padding: 0.6rem 0.75rem 0.6rem 1.1rem; border-radius: 999px; background: #1A1B1F; color: #fff; box-shadow: var(--shadow-lg); font-size: var(--fs-sm); font-weight: 600; }
.md-pickbar .btn-ghost { background: transparent; color: #fff; border: 1px solid rgba(255,255,255,0.35); box-shadow: none; }
.md-pickbar .btn-ghost:hover:not(:disabled) { background: rgba(255,255,255,0.12); color: #fff; }

/* Videos */
.md-vgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1rem; }
.md-vcard { display: flex; flex-direction: column; border: 1px solid var(--color-border); border-radius: var(--radius-lg); overflow: hidden; background: var(--color-bg-card); }
.md-vthumb { all: unset; position: relative; display: block; aspect-ratio: 16 / 9; overflow: hidden; background: #1A1B1F; cursor: pointer; }
.md-vthumb img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; opacity: 0.92; }
.md-vthumb__play { position: absolute; left: 50%; top: 50%; translate: -50% -50%; width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center; background: rgba(255,255,255,0.92); color: #1A1B1F; padding-left: 3px; box-sizing: border-box; }
.md-vthumb__dur { position: absolute; right: 0.45rem; bottom: 0.45rem; padding: 0.05rem 0.4rem; border-radius: 4px; background: rgba(0,0,0,0.75); color: #fff; font-size: var(--fs-2xs); font-weight: 700; }
.md-vthumb__kind { position: absolute; left: 0.45rem; top: 0.45rem; }
.md-vcard__body { display: grid; gap: 0.2rem; padding: 0.75rem 0.85rem 0.85rem; flex: 1; align-content: start; }
.md-vcard__label { margin: 0; font-weight: 700; font-size: var(--fs-sm); }
.md-vcard__meta { margin: 0; font-size: var(--fs-xs); color: var(--color-text-secondary); }
.md-vcard__actions { display: flex; flex-wrap: wrap; gap: 0.4rem 0.75rem; align-items: center; margin-top: 0.5rem; font-size: var(--fs-xs); }
.md-vcard__actions a.md-link, .md-vcard__actions button.md-linkbtn { display: inline-flex; align-items: center; gap: 0.25rem; font-weight: 500; }
.md-making { font-size: var(--fs-xs); color: var(--color-text-secondary); }

/* Viewer */
.md-lb { position: fixed; inset: 0; z-index: 1000; background: rgba(12,12,14,0.94); color: #fff; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; outline: none; }
.md-lb__bar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 0.75rem; padding: 0.75rem 1rem; }
.md-lb__title { flex: 1; min-width: 0; font-size: var(--fs-sm); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.md-lb__title span { color: rgba(255,255,255,0.65); font-weight: 500; }
.md-lb .btn-ghost { background: transparent; color: #fff; border: 1px solid rgba(255,255,255,0.35); box-shadow: none; }
.md-lb .btn-ghost:hover { background: rgba(255,255,255,0.12); color: #fff; }
.md-lb__stage { position: relative; min-height: 0; overflow: hidden; }
.md-lb__stage img { position: absolute; inset: 0 3.5rem; margin: auto; max-width: calc(100% - 7rem); max-height: 100%; object-fit: contain; display: block; }
.md-lb__stage .md-lb__frame { position: absolute; inset: 0; margin: auto; max-width: calc(100% - 2rem); max-height: 100%; }
.md-lb__frame { width: min(100%, calc((100vh - 9rem) * 16 / 9)); aspect-ratio: 16 / 9; border: 0; background: #000; }
.md-lb__nav { position: absolute; top: 50%; translate: 0 -50%; width: 44px; height: 44px; border-radius: 50%; border: 0; display: grid; place-items: center; cursor: pointer; background: rgba(255,255,255,0.14); color: #fff; }
.md-lb__nav:hover { background: rgba(255,255,255,0.25); }
.md-lb__nav:disabled { opacity: 0.3; cursor: default; }
.md-lb__prev { left: 0.5rem; }
.md-lb__next { right: 0.5rem; }
.md-lb__alt { margin: 0; padding: 0.6rem 1rem 1rem; font-size: var(--fs-xs); color: rgba(255,255,255,0.75); text-align: center; min-height: 1rem; }
.md-lb button:focus-visible, .md-lb a:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }

@media (max-width: 900px) {
  .md-now__cols { grid-template-columns: 1fr; }
  .md-album__head h2 { font-size: var(--fs-xl); }
}
@media (max-width: 560px) {
  .md-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.6rem; }
  .md-pgrid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.3rem; }
  .md-pairs { grid-template-columns: 1fr; }
  .md-act { grid-template-columns: 28px minmax(0, 1fr); }
  .md-act__thumbs { display: none; }
  .md-lb__stage img { inset: 0 0.5rem; max-width: calc(100% - 1rem); }
  .md-lb__nav { width: 36px; height: 36px; background: rgba(0,0,0,0.5); }
  .md-pickbar { border-radius: var(--radius-lg); }
}
@media (prefers-reduced-motion: reduce) { .md-card, .md-tile__open img { transition: none; } .md-card:hover { transform: none; } }
`;
function useStyles() {
  if (typeof document !== 'undefined' && !document.getElementById('md-styles')) {
    const s = document.createElement('style');
    s.id = 'md-styles';
    s.textContent = STYLES;
    document.head.appendChild(s);
  }
}

// ─── The area ─────────────────────────────────────────────────────
export function MediaArea({ addToast = () => {}, kids = [], events = [], communityProjects = [], listsReady = true }) {
  useStyles();
  const [route, setRoute] = useState(() => readHash() || { tab: 'kid' });
  const [info, setInfo] = useState(null);
  const [infoErr, setInfoErr] = useState(null);
  // What Stream still has: { videos: { uid: { seconds, bytes, ready } }, complete } (null until it's been asked)
  const [facts, setFacts] = useState(null);

  const load = async () => {
    try {
      const r = await fetch(API, { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || `The server answered ${r.status}`);
      setInfo({ reveals: j.reveals, broadcasts: j.broadcasts || [] });
      setInfoErr(null);
    } catch (e) { setInfoErr(e.message); }
  };
  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 5 * 60_000);
    return () => clearInterval(t);
  }, []);

  const input = { kids, events, community: communityProjects, broadcasts: info?.broadcasts || [], reveals: info?.reveals };
  // Every Stream video an album could name, then one look at which Stream still has (most uploads from before 2024
  // were purged): the albums leave those out, as the kid pages do
  const uidList = useMemo(() => {
    const all = M.buildAlbums(input);
    return [...new Set([...all.kid, ...all.event, ...all.community].flatMap((a) => a.videos.map((v) => v.uid)).filter(Boolean))].sort().join(',');
  }, [kids, events, communityProjects, info]);
  useEffect(() => {
    if (!uidList) return;
    let on = true;
    fetch(`${API}?videos=${uidList}`, { cache: 'no-store' }).then((r) => r.json())
      .then((j) => { if (on) setFacts(j.ok ? { videos: j.videos || {}, complete: !!j.complete } : { videos: {}, complete: false }); })
      .catch(() => { if (on) setFacts({ videos: {}, complete: false }); });
    return () => { on = false; };
  }, [uidList]);
  const gone = useMemo(() => (facts?.complete ? new Set(uidList.split(',').filter((u) => u && !facts.videos[u])) : null), [facts, uidList]);
  const videosKnown = !!facts || !uidList;
  const albums = useMemo(() => M.buildAlbums({ ...input, gone }), [kids, events, communityProjects, info, gone]);
  const activity = useMemo(() => M.buildActivity({ albums, reveals: info?.reveals, broadcasts: info?.broadcasts || [], gone }), [albums, info, gone]);
  const byKey = useMemo(() => new Map([...albums.kid, ...albums.event, ...albums.community].map((a) => [a.key, a])), [albums]);
  const videos = useMemo(() => [...albums.kid, ...albums.event, ...albums.community].flatMap((a) => a.videos.map((v) => ({ album: a, video: v }))), [albums]);
  const vf = facts?.videos || {};

  // The address: an album is a step Back undoes
  const go = (r, { push = true } = {}) => {
    setRoute(r);
    const to = hashFor(r);
    if (location.hash !== to) history[push ? 'pushState' : 'replaceState'](null, '', to);
    requestAnimationFrame(() => (document.querySelector('.main') || document.scrollingElement)?.scrollTo?.({ top: 0 }));
  };
  useEffect(() => {
    const on = () => { const r = readHash(); if (r) setRoute(r); };
    window.addEventListener('popstate', on);
    window.addEventListener('hashchange', on);
    // Photos & Videos in the menu, from inside an album: back to the albums
    const nav = (e) => { if (e.detail === 'media') { setRoute({ tab: 'kid' }); if (location.hash !== '#media') history.replaceState(null, '', '#media'); } };
    window.addEventListener('soard-nav', nav);
    return () => { window.removeEventListener('popstate', on); window.removeEventListener('hashchange', on); window.removeEventListener('soard-nav', nav); };
  }, []);

  if (route.album) {
    const album = byKey.get(route.album);
    if (!album) {
      if (!listsReady) return html`<div class="md"><div style="text-align:center;padding:3rem"><span class="spinner" /></div></div>`;
      return html`<div class="md">
        <button class="btn btn-ghost btn-sm md-back" onClick=${() => go({ tab: route.tab })}>${I.back()} ${BACK_TO[route.tab] || 'All albums'}</button>
        <div class="card empty"><p class="empty__title">This album isn’t on the website</p>
          <p class="empty__text">It may be a draft, or its page was taken down. Only what the website shows can be downloaded here.</p></div>
      </div>`;
    }
    return html`<${AlbumView} key=${album.key} album=${album} facts=${vf} videosKnown=${videosKnown} addToast=${addToast} onBack=${() => go({ tab: route.tab })} />`;
  }

  const counts = { kid: albums.kid.length, event: albums.event.length, community: albums.community.length, videos: videos.filter((x) => x.video.uid).length };
  return html`
    <div class="md">
      <div class="page-header" style="margin-bottom:0">
        <div>
          <h2>Photos & Videos</h2>
          <p class="page-sub">Every photo and video on the website, full size and ready to post. Photos download as JPEGs with no location data, videos as MP4s.</p>
        </div>
      </div>
      <${Happening} activity=${activity} info=${info} error=${infoErr} onRetry=${load} byKey=${byKey} open=${(key) => go({ tab: key.split(':')[0], album: key })} addToast=${addToast} listsReady=${listsReady} />
      <div class="hub-tabs md-tabs" role="tablist" aria-label="Albums">
        ${KINDS.map(([k, label]) => html`
          <button key=${k} role="tab" aria-selected=${route.tab === k} class="hub-tab ${route.tab === k ? 'active' : ''}" onClick=${() => go({ tab: k }, { push: false })}>
            ${label}<span class="md-tab-n">${listsReady && (k !== 'videos' || videosKnown) ? counts[k] : ''}</span>
          </button>`)}
      </div>
      ${!listsReady
        ? html`<div style="text-align:center;padding:3rem"><span class="spinner" /></div>`
        : route.tab === 'videos'
          ? videosKnown
            ? html`<${AllVideos} videos=${videos} facts=${vf} addToast=${addToast} open=${(key) => go({ tab: key.split(':')[0], album: key })} />`
            : html`<p class="md-count-line" role="status"><span class="spinner" style="width:12px;height:12px;vertical-align:-1px" /> Checking which videos Stream still has…</p>`
          : html`<${Albums} kind=${route.tab} list=${albums[route.tab] || []} reveals=${info?.reveals} open=${(key) => go({ tab: route.tab, album: key })} />`}
    </div>`;
}

// ─── What's happening ─────────────────────────────────────────────
function Happening({ activity, info, error, onRetry, byKey, open, addToast, listsReady }) {
  const [more, setMore] = useState(false);
  const recent = more ? activity.recent : activity.recent.slice(0, 6);
  const loadingInfo = !info && !error;
  return html`
    <section class="card md-now" aria-labelledby="md-now-h">
      <div class="md-now__head">
        <h3 id="md-now-h">What’s happening</h3>
        ${error
          ? html`<span class="md-muted" style="font-size:var(--fs-xs)">The reveal schedule didn’t load (${error}). <button class="md-linkbtn" onClick=${onRetry}>Try again</button></span>`
          : info?.reveals?.updatedAt ? html`<span class="md-muted" style="font-size:var(--fs-xs)">Reveal dates from JobTread, checked ${new Date(info.reveals.updatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>` : null}
      </div>
      <div class="md-now__cols">
        <div class="md-now__col">
          <h4>Coming up</h4>
          ${loadingInfo || !listsReady ? html`<p class="md-empty-line">Looking at the schedule…</p>`
            : activity.ahead.length ? html`<ul class="md-acts">${activity.ahead.map((x) => html`<${ActItem} key=${x.key} item=${x} byKey=${byKey} open=${open} addToast=${addToast} />`)}</ul>`
            : html`<p class="md-empty-line">No reveals or events on the calendar yet.</p>`}
        </div>
        <div class="md-now__col">
          <h4>Recently</h4>
          ${loadingInfo || !listsReady ? html`<p class="md-empty-line">Looking at what’s new…</p>`
            : recent.length ? html`<ul class="md-acts">${recent.map((x) => html`<${ActItem} key=${x.key} item=${x} byKey=${byKey} open=${open} addToast=${addToast} />`)}</ul>`
            : html`<p class="md-empty-line">Nothing new in the last ${M.RECENT_DAYS} days.</p>`}
          ${activity.recent.length > 6 && html`<button class="btn btn-ghost btn-sm md-more" onClick=${() => setMore(!more)}>${more ? 'Show less' : `Show ${activity.recent.length - 6} more`}</button>`}
        </div>
      </div>
    </section>`;
}

function ActItem({ item: x, byKey, open, addToast }) {
  const album = x.album ? byKey.get(x.album) : null;
  const icon = (ACT_ICON[x.kind] || I.cal)(16);
  const title = album
    ? html`<a class="md-linkbtn" href=${hashFor({ album: album.key })} onClick=${(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); open(album.key); }}>${x.title}</a>`
    : html`<strong>${x.title}</strong>`;
  const thumbs = x.video
    ? [html`<img class="is-video" src=${M.streamThumb(x.video, { width: 160, height: 90, time: x.at })} alt="" loading="lazy" />`]
    : (x.thumbs || []).slice(0, 3).map((id) => html`<img src=${M.imgSrc(id, 'w=96,h=96,fit=cover,gravity=auto,q=65')} alt="" loading="lazy" />`);
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
            ${x.caption && html`<button class="md-linkbtn" style="font-weight:500" onClick=${() => copy(x.caption, addToast, 'Caption copied')}>${I.copy(11)} Copy caption</button>`}
          </div>`}
      </div>
      ${thumbs.length ? html`<div class="md-act__thumbs">${thumbs}</div>` : html`<span />`}
    </li>`;
}

// ─── Albums ───────────────────────────────────────────────────────
function Albums({ kind, list, reveals, open }) {
  const [q, setQ] = useState('');
  const [year, setYear] = useState('');
  useEffect(() => { setQ(''); setYear(''); }, [kind]);
  const years = useMemo(() => [...new Set(list.map((a) => a.year).filter(Boolean))].sort((a, b) => b - a), [list]);
  const upcoming = useMemo(() => new Map((reveals?.upcoming || []).map((r) => [r.slug, r])), [reveals]);
  const shown = list.filter((a) => (!year || String(a.year) === year) && (!q.trim() || fold(`${a.name} ${a.year || ''} ${a.rooms.join(' ')} ${a.photographer}`).includes(fold(q.trim()))));
  const noun = { kid: ['reveal', 'reveals'], event: ['event', 'events'], community: ['community project', 'community projects'] }[kind] || ['album', 'albums'];
  return html`
    <div class="md-tools">
      <label class="md-search">${I.search(15)}<input type="search" value=${q} placeholder=${kind === 'kid' ? 'Search by name, room or photographer' : 'Search'} aria-label="Search albums" onInput=${(e) => setQ(e.target.value)} /></label>
      ${years.length > 1 && html`
        <div class="md-chips" role="group" aria-label="Year">
          <button aria-pressed=${!year} onClick=${() => setYear('')}>All years</button>
          ${years.slice(0, 8).map((y) => html`<button key=${y} aria-pressed=${year === String(y)} onClick=${() => setYear(String(y))}>${y}</button>`)}
        </div>`}
    </div>
    <p class="md-count-line" role="status">${shown.length === list.length ? plural(list.length, ...noun) : `${shown.length} of ${plural(list.length, ...noun)}`}</p>
    ${shown.length
      ? html`<div class="md-grid">${shown.map((a) => html`<${AlbumCard} key=${a.key} album=${a} reveal=${upcoming.get(a.slug)} open=${open} />`)}</div>`
      : html`<div class="card empty"><p class="empty__title">${list.length ? 'Nothing matches' : `No ${noun[1]} with photos yet`}</p></div>`}`;
}

function AlbumCard({ album: a, reveal, open }) {
  const photos = a.files.length;
  const vids = a.videos.filter((v) => v.uid).length;
  const chips = [];
  if (a.kind === 'kid' && reveal) chips.push(html`<span class="md-chip">${I.cal(11)} Reveal ${reveal.confirmed !== false && reveal.date ? shortDay(reveal.date).replace(/, \d{4}$/, '') : reveal.window?.label || 'soon'}</span>`);
  if (isNew(a.newest)) chips.push(html`<span class="md-chip md-chip--new">New photos</span>`);
  if (a.videos.some((v) => v.kind === 'live')) chips.push(html`<span class="md-chip md-chip--live">${I.live(11)} Live reveal</span>`);
  const when = a.kind === 'event' && a.date ? shortDay(a.date) : a.year ? String(a.year) : '';
  return html`
    <a class="md-card" href=${hashFor({ album: a.key })} onClick=${(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); open(a.key); }}>
      <span class="md-card__img">
        ${a.cover ? html`<img src=${M.imgSrc(a.cover, 'w=560,h=420,fit=cover,gravity=auto,q=72')} alt="" loading="lazy" decoding="async" />` : html`<span class="md-card__none">${I.camera(26)}</span>`}
        ${chips.length ? html`<span class="md-card__chips">${chips}</span>` : null}
      </span>
      <span class="md-card__body">
        <span class="md-card__name">${a.name}</span>
        <span class="md-card__meta">${[when, photos && plural(photos, 'photo'), vids && plural(vids, 'video')].filter(Boolean).join(' · ')}</span>
      </span>
    </a>`;
}

// ─── One album ────────────────────────────────────────────────────
function AlbumView({ album: a, facts, videosKnown = true, addToast, onBack }) {
  const [sel, setSel] = useState(() => new Set());
  const [viewing, setViewing] = useState(null); // { list, i } photos, or { video }
  const formRef = useRef(null);
  const gallery = a.files.filter((f) => f.role === 'photo');
  const pairFiles = a.files.filter((f) => f.role === 'pair-before' || f.role === 'pair-after');
  const pairs = [...new Set(pairFiles.map((f) => f.n))].map((n) => pairFiles.filter((f) => f.n === n));
  const befores = a.files.filter((f) => f.role === 'before');
  const uniqueIds = [...new Set(a.files.map((f) => f.id))];
  const toggle = (id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const page = `${SITE}${a.page}`;
  const vids = a.videos;
  const metaBits = [
    a.kind === 'kid' && a.date ? `${a.date > M.easternDay(Date.now()) ? 'Reveal' : 'Revealed'} ${longDay(a.date)}` : a.kind === 'event' && a.date ? longDay(a.date) : '',
    a.rooms.join(' and '),
    a.files.length && plural(uniqueIds.length, 'photo'),
    vids.filter((v) => v.uid).length && plural(vids.filter((v) => v.uid).length, 'video'),
  ].filter(Boolean);
  const tooMany = sel.size > M.ZIP_MAX;
  const downloadPicked = () => {
    if (!sel.size) return;
    if (tooMany) { addToast(`At most ${M.ZIP_MAX} photos in one ZIP. Pick fewer.`, 'error'); return; }
    formRef.current.querySelector('[name=ids]').value = [...sel].join('\n');
    formRef.current.submit();
    addToast(`Your ZIP of ${plural(sel.size, 'photo')} is downloading. A big one takes a minute to start.`, 'success');
  };
  // New marks a photo only when a few were added to an album that had more (an album that's mostly new says so once, on
  // its card and in What's happening)
  const newCount = a.files.filter((f) => isNew(f.added)).length;
  const markNew = newCount > 0 && newCount <= a.files.length / 2;
  const tiles = (list, label) => list.map((f, i) => html`<${PhotoTile} key=${`${f.role}:${f.id}:${f.n}`} album=${a} file=${f} label=${`${label} ${i + 1}`}
    markNew=${markNew} selected=${sel.has(f.id)} onToggle=${() => toggle(f.id)} onOpen=${() => setViewing({ list, i })} />`);

  return html`
    <div class="md ${sel.size ? 'md-picking' : ''}">
      <button class="btn btn-ghost btn-sm md-back" onClick=${onBack}>${I.back()} ${BACK_TO[a.kind] || 'All albums'}</button>
      <div class="md-album__head">
        <div>
          <h2>${a.name}${a.year && a.kind !== 'event' ? html` <span>${a.year}</span>` : null}</h2>
          ${metaBits.length ? html`<p class="md-album__meta">${metaBits.join(' · ')}</p>` : null}
        </div>
        ${a.files.length ? html`
          <div class="md-album__actions">
            <a class="btn btn-primary" href=${zipAllHref(a)} download onClick=${() => addToast(`Your ZIP of ${plural(a.files.length, 'photo')} is downloading. A big one takes a minute to start.`, 'success')}>
              ${I.download(15)} Download all photos (ZIP)
            </a>
          </div>` : null}
      </div>

      <div class="md-facts">
        ${a.photographer && html`
          <div class="card md-fact">
            <span class="md-fact__label">Photographer</span>
            <span class="md-fact__value">${a.photographer}</span>
            <div class="md-fact__row">
              <button class="btn btn-ghost btn-sm" onClick=${() => copy(`Photos by ${a.photographer}`, addToast, 'Photo credit copied')}>${I.copy(13)} Copy credit</button>
              ${a.photographerUrl && html`<a class="btn btn-ghost btn-sm" href=${a.photographerUrl} target="_blank" rel="noopener">${I.out(13)} Their site</a>`}
            </div>
          </div>`}
        <div class="card md-fact">
          <span class="md-fact__label">On the website</span>
          <span class="md-fact__value">${page.replace(/^https:\/\//, '')}</span>
          <div class="md-fact__row">
            <button class="btn btn-ghost btn-sm" onClick=${() => copy(page, addToast, 'Link copied')}>${I.copy(13)} Copy link</button>
            <a class="btn btn-ghost btn-sm" href=${page} target="_blank" rel="noopener">${I.out(13)} Open</a>
          </div>
        </div>
        ${a.kind === 'event' && a.location && html`
          <div class="card md-fact">
            <span class="md-fact__label">Where</span>
            <span class="md-fact__value">${a.location}</span>
            ${a.time && html`<span class="md-muted" style="font-size:var(--fs-xs)">${a.time}</span>`}
          </div>`}
      </div>

      ${a.caption && html`
        <section class="card md-sec" style="margin:0;padding:1rem 1.1rem" aria-labelledby="md-cap-h">
          <div class="md-sec__head"><h3 id="md-cap-h">Caption from the Reel</h3>
            <button class="btn btn-ghost btn-sm" onClick=${() => copy(a.caption, addToast, 'Caption copied')}>${I.copy(13)} Copy caption</button></div>
          <p class="md-caption">${a.caption}</p>
        </section>`}

      ${vids.length ? html`
        <section class="md-sec" aria-labelledby="md-v-h">
          <div class="md-sec__head"><h3 id="md-v-h">Videos <span class="md-muted">${videosKnown ? vids.length : ''}</span></h3></div>
          ${videosKnown
            ? html`<div class="md-vgrid">${vids.map((v) => html`<${VideoCard} key=${v.key} album=${a} video=${v} fact=${facts[v.uid]} addToast=${addToast} onPlay=${() => setViewing({ video: v })} />`)}</div>`
            : html`<p class="md-count-line" role="status"><span class="spinner" style="width:12px;height:12px;vertical-align:-1px" /> Checking which videos Stream still has…</p>`}
        </section>` : null}

      ${gallery.length ? html`
        <section class="md-sec" aria-labelledby="md-p-h">
          <div class="md-sec__head">
            <h3 id="md-p-h">Photos <span class="md-muted">${gallery.length}</span></h3>
            <div class="md-sec__tools">
              <button class="btn btn-ghost btn-sm" onClick=${() => setSel(new Set(uniqueIds))}>Select all</button>
              ${sel.size ? html`<button class="btn btn-ghost btn-sm" onClick=${() => setSel(new Set())}>Clear</button>` : null}
            </div>
          </div>
          <div class="md-pgrid">${tiles(gallery, 'Photo')}</div>
        </section>` : null}

      ${pairs.length ? html`
        <section class="md-sec" aria-labelledby="md-ba-h">
          <div class="md-sec__head"><h3 id="md-ba-h">Before and after <span class="md-muted">${pairs.length}</span></h3></div>
          <div class="md-pairs">${pairs.map((pr) => html`<div class="md-pair" key=${pr[0].n}>${pr.map((f) => html`<${PhotoTile} key=${`${f.role}:${f.id}`} album=${a} file=${f}
            label=${`Pair ${f.n} ${f.role === 'pair-before' ? 'before' : 'after'}`} tag=${roleWord[f.role]} selected=${sel.has(f.id)} onToggle=${() => toggle(f.id)}
            onOpen=${() => setViewing({ list: pairFiles, i: pairFiles.indexOf(f) })} />`)}</div>`)}</div>
        </section>` : null}

      ${befores.length ? html`
        <section class="md-sec" aria-labelledby="md-b-h">
          <div class="md-sec__head"><h3 id="md-b-h">Before photos <span class="md-muted">${befores.length}</span></h3></div>
          <div class="md-pgrid">${tiles(befores, 'Before photo')}</div>
        </section>` : null}

      ${!a.files.length && !vids.length ? html`<div class="card empty"><p class="empty__title">No photos or videos yet</p></div>` : null}

      ${sel.size ? html`
        <div class="md-pickbar" role="region" aria-label="Picked photos">
          <span>${plural(sel.size, 'photo')} picked</span>
          <button class="btn btn-primary btn-sm" onClick=${downloadPicked} disabled=${tooMany}>${I.download(14)} Download ZIP</button>
          <button class="btn btn-ghost btn-sm" onClick=${() => setSel(new Set())}>Clear</button>
        </div>` : null}

      <form ref=${formRef} method="POST" action=${DL} target="md-dl" hidden>
        <input type="hidden" name="album" value=${a.key} />
        <input type="hidden" name="ids" value="" />
      </form>
      <iframe name="md-dl" title="Downloads" hidden></iframe>

      ${viewing?.list && html`<${PhotoViewer} album=${a} list=${viewing.list} start=${viewing.i} addToast=${addToast} onClose=${() => setViewing(null)} />`}
      ${viewing?.video && html`<${VideoViewer} album=${a} video=${viewing.video} onClose=${() => setViewing(null)} />`}
    </div>`;
}

function PhotoTile({ album, file: f, label, tag = null, markNew = false, selected, onToggle, onOpen }) {
  return html`
    <div class="md-tile ${selected ? 'is-sel' : ''}">
      <button class="md-tile__open" onClick=${onOpen} aria-label=${`Open ${label.toLowerCase()}`} title=${f.alt || ''}>
        <img src=${M.imgSrc(f.id, 'w=360,h=360,fit=cover,gravity=auto,q=70')} alt=${f.alt || ''} loading="lazy" decoding="async" />
      </button>
      <button class="md-tile__check" aria-pressed=${selected} aria-label=${`Pick ${label.toLowerCase()}`} title=${selected ? 'Picked' : 'Pick'} onClick=${onToggle}>${I.check(15)}</button>
      <a class="md-tile__dl" href=${photoHref(album, f)} download aria-label=${`Download ${label.toLowerCase()}`} title="Download full size">${I.download(15)}</a>
      ${tag || (markNew && isNew(f.added)) ? html`<span class="md-tile__tag">${tag ? html`<span class="md-chip">${tag}</span>` : html`<span class="md-chip md-chip--new">New</span>`}</span>` : null}
    </div>`;
}

function PhotoViewer({ album, list, start, addToast, onClose }) {
  const box = useRef(null);
  const [i, setI] = useState(start);
  useDialog(box, onClose);
  const f = list[i];
  const prev = () => setI((n) => Math.max(0, n - 1));
  const next = () => setI((n) => Math.min(list.length - 1, n + 1));
  useEffect(() => {
    const k = (e) => { if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); } else if (e.key === 'ArrowRight') { e.preventDefault(); next(); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [list.length]);
  // The next photo is ready before it's asked for
  useEffect(() => { const n = list[i + 1]; if (n) { const im = new Image(); im.src = M.imgSrc(n.id, 'w=2000,h=2000,fit=scale-down,q=85'); } }, [i]);
  if (!f) return null;
  const name = M.photoFileName(album, f);
  return html`
    <div class="md-lb" role="dialog" aria-modal="true" aria-label=${`${album.name}: photo ${i + 1} of ${list.length}`} tabindex="-1" ref=${box}>
      <div class="md-lb__bar">
        <p class="md-lb__title" style="margin:0">${album.name} <span>· ${i + 1} of ${list.length} · ${name}</span></p>
        ${f.alt && html`<button class="btn btn-ghost btn-sm" onClick=${() => copy(f.alt, addToast, 'Description copied')}>${I.copy(13)} Copy description</button>`}
        <a class="btn btn-primary btn-sm" href=${photoHref(album, f)} download>${I.download(14)} Download</a>
        <button class="btn btn-ghost btn-sm" onClick=${onClose} aria-label="Close">${I.x(16)}</button>
      </div>
      <div class="md-lb__stage">
        <img key=${f.id} src=${M.imgSrc(f.id, 'w=2000,h=2000,fit=scale-down,q=85')} alt=${f.alt || ''} />
        <button class="md-lb__nav md-lb__prev" onClick=${prev} disabled=${i === 0} aria-label="Previous photo">${I.left(22)}</button>
        <button class="md-lb__nav md-lb__next" onClick=${next} disabled=${i === list.length - 1} aria-label="Next photo">${I.right(22)}</button>
      </div>
      <p class="md-lb__alt">${f.alt}</p>
    </div>`;
}

// ─── Videos ───────────────────────────────────────────────────────
function VideoCard({ album, video: v, fact, addToast, onPlay, showAlbum = false, openAlbum = null }) {
  const yt = v.kind === 'link' ? youTubeId(v.url) : '';
  const thumb = v.uid ? M.streamThumb(v.uid, { time: v.start != null ? v.start + Math.min(5, (v.seconds || 10) / 2) : null }) : yt ? `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` : '';
  const secs = v.kind === 'reel' ? v.seconds : fact?.seconds;
  const meta = [
    secs ? (secs < 120 ? `${secs} seconds` : duration(secs)) : '',
    v.kind !== 'reel' && fact?.bytes ? bytes(fact.bytes) : '',
    v.date ? `${v.kind === 'reel' ? 'Posted' : 'Live'} ${shortDay(v.date)}` : '',
  ].filter(Boolean).join(' · ');
  const kindChip = v.kind === 'live' ? html`<span class="md-chip md-chip--live">${I.live(11)} Live</span>` : v.kind === 'reel' ? html`<span class="md-chip">${I.reel(11)} Reel</span>` : null;
  return html`
    <div class="md-vcard">
      ${v.uid
        ? html`<button class="md-vthumb" onClick=${onPlay}>
            <span class="sr-only">Play ${v.label.toLowerCase()}${showAlbum ? ` of ${album.name}` : ''}</span>
            ${thumb && html`<img src=${thumb} alt="" loading="lazy" />`}
            <span class="md-vthumb__play">${I.play(20)}</span>
            ${secs ? html`<span class="md-vthumb__dur">${duration(secs)}</span>` : null}
            ${kindChip && html`<span class="md-vthumb__kind">${kindChip}</span>`}
          </button>`
        : html`<a class="md-vthumb" href=${v.url} target="_blank" rel="noopener">
            <span class="sr-only">Open ${v.label.toLowerCase()}</span>
            ${thumb && html`<img src=${thumb} alt="" loading="lazy" />`}
            <span class="md-vthumb__play">${I.out(18)}</span>
          </a>`}
      <div class="md-vcard__body">
        ${showAlbum && html`<a class="md-linkbtn" style="font-size:var(--fs-sm)" href=${hashFor({ album: album.key })} onClick=${(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); openAlbum?.(album.key); }}>${album.name}${album.year && album.kind !== 'event' ? ` (${album.year})` : ''}</a>`}
        <p class="md-vcard__label">${v.label}</p>
        ${meta && html`<p class="md-vcard__meta">${meta}</p>`}
        <div class="md-vcard__actions">
          ${v.uid ? html`<${VideoDownload} album=${album} video=${v} addToast=${addToast} />` : html`<a class="md-link" href=${v.url} target="_blank" rel="noopener">${I.out(12)} ${yt ? 'Open on YouTube' : 'Open'}</a>`}
          ${v.links.map((l) => html`<a class="md-link" href=${l.url} target="_blank" rel="noopener">${I.out(12)} ${l.label}</a>`)}
          ${v.caption && html`<button class="md-linkbtn" onClick=${() => copy(v.caption, addToast, 'Caption copied')}>${I.copy(12)} Caption</button>`}
        </div>
      </div>
    </div>`;
}

/**
 * Download MP4. A Reel clip is cut as it downloads. Any other video needs Stream to have made its MP4: the first press
 * starts it, the button says how far along it is, and the download starts by itself once it's ready (while the album
 * is open; after that it's a plain link)
 */
function VideoDownload({ album, video: v, addToast }) {
  const [state, setState] = useState(v.kind === 'reel' && v.start != null ? { ready: true } : null);
  const timer = useRef(null);
  const link = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const check = async (fromClick) => {
    try {
      const r = await fetch(`${API}?album=${encodeURIComponent(album.key)}&mp4=${encodeURIComponent(v.key)}`, { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || `The server answered ${r.status}`);
      if (j.ready) {
        setState({ ready: true });
        if (!fromClick) addToast(`The ${v.label.toLowerCase()} of ${album.name} is ready. It’s downloading now.`, 'success');
        requestAnimationFrame(() => link.current?.click());
        return;
      }
      setState({ making: true, percent: j.percent || 0 });
      timer.current = setTimeout(() => check(false), 5000);
    } catch (e) {
      setState({ error: e.message });
    }
  };
  if (state?.ready) {
    return html`<a ref=${link} class="btn btn-primary btn-sm" href=${videoHref(album, v)} download>${I.download(14)} Download MP4</a>`;
  }
  if (state?.making) {
    return html`<span class="md-making" role="status"><span class="spinner" style="width:12px;height:12px;vertical-align:-1px" /> Stream is making the MP4${state.percent ? `, ${state.percent}%` : ''}. It can take a few minutes.</span>`;
  }
  return html`
    <button class="btn btn-ghost btn-sm" onClick=${() => { setState({ making: true, percent: 0 }); check(true); }}>${I.download(14)} Download MP4</button>
    ${state?.error && html`<span class="md-making" style="color:var(--tone-danger-fg)">${state.error}</span>`}`;
}

function VideoViewer({ album, video: v, onClose }) {
  const box = useRef(null);
  useDialog(box, onClose);
  return html`
    <div class="md-lb" role="dialog" aria-modal="true" aria-label=${`${album.name}: ${v.label}`} tabindex="-1" ref=${box}>
      <div class="md-lb__bar">
        <p class="md-lb__title" style="margin:0">${album.name} <span>· ${v.label}</span></p>
        <button class="btn btn-ghost btn-sm" onClick=${onClose} aria-label="Close">${I.x(16)}</button>
      </div>
      <div class="md-lb__stage">
        <iframe class="md-lb__frame" src=${M.streamEmbed(v.uid, { start: v.start })} title=${v.label} allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen></iframe>
      </div>
      <p class="md-lb__alt">${v.kind === 'reel' ? `The ${v.seconds}-second Reel starts here in the recording. Download MP4 saves just the clip.` : ''}</p>
    </div>`;
}

function AllVideos({ videos, facts, addToast, open }) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [playing, setPlaying] = useState(null);
  // (an older video Stream no longer has is only on YouTube: listed under its own chip, to open there)
  const KIND_WORDS = [['', 'All'], ['live', 'Live reveals'], ['reel', 'Reel clips'], ['room', 'Makeover videos'], ['other', 'Events and community'], ['link', 'Only on YouTube']];
  const list = videos.filter(({ video: v }) => (kind === 'link' ? !v.uid : v.uid));
  const shown = list.filter(({ album: a, video: v }) => (!kind || kind === 'link' || (kind === 'other' ? ['event', 'project'].includes(v.kind) : v.kind === kind))
    && (!q.trim() || fold(`${a.name} ${a.year || ''} ${v.label}`).includes(fold(q.trim()))));
  // Newest first: a live reveal or Reel by its day, the rest by their album
  const order = (x) => x.video.date || x.album.date || String(x.album.year || '');
  shown.sort((x, y) => String(order(y)).localeCompare(String(order(x))));
  return html`
    <div class="md-tools">
      <label class="md-search">${I.search(15)}<input type="search" value=${q} placeholder="Search by name" aria-label="Search videos" onInput=${(e) => setQ(e.target.value)} /></label>
      <div class="md-chips" role="group" aria-label="Kind of video">
        ${KIND_WORDS.map(([k, t]) => html`<button key=${k} aria-pressed=${kind === k} onClick=${() => setKind(k)}>${t}</button>`)}
      </div>
    </div>
    <p class="md-count-line" role="status">${kind === 'link'
      ? `${plural(shown.length, 'older video')} only on YouTube now: open one there. They can’t be downloaded from here.`
      : shown.length === list.length ? `${plural(list.length, 'video')} to download as MP4s` : `${shown.length} of ${plural(list.length, 'video')}`}</p>
    ${shown.length
      ? html`<div class="md-vgrid">${shown.slice(0, 120).map(({ album, video }) => html`<${VideoCard} key=${`${album.key}|${video.key}`} album=${album} video=${video} fact=${facts[video.uid]}
          addToast=${addToast} showAlbum openAlbum=${open} onPlay=${() => setPlaying({ album, video })} />`)}</div>`
      : html`<div class="card empty"><p class="empty__title">Nothing matches</p></div>`}
    ${shown.length > 120 && html`<p class="md-count-line">Showing the newest 120. Search to find an older one.</p>`}
    ${playing && html`<${VideoViewer} album=${playing.album} video=${playing.video} onClose=${() => setPlaying(null)} />`}`;
}
