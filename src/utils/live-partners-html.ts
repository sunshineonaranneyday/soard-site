/**
 * live-partners-html.ts — the build's partners, scrolling under the live page's video
 * ====================================================================================
 * Peter, Nov 17 2026: "the vendors need the same scroll bar" (the band of logos the starting-soon screen had, before
 * that screen was retired). The kid's partner logos (Admin → Kids → Partners) run in one slow, endless row under the
 * frame: under the photo before the reveal, under the video and its bar during it, under the replay after.
 *
 * One builder for both places the band is drawn: LivePage.astro at build time for a child's own page, and
 * functions/live/[[path]].js for /live/, which follows whichever reveal is current. Styles: LivePartners.astro
 * (global, since the server's copy has no Astro scope). The row is the list twice over, so it loops without a seam;
 * a short list is repeated first so the row is always wider than the band. Only the first copy is read out. The logos
 * load at once, at low priority (each is one small picture, and its copies are the same file): loaded lazily, the ones
 * scrolled out of the band's window waited, and could arrive blank as the row brought them in.
 */
import { cfRaw } from './cf-image';

export interface PartnerLogo { url: string; name: string }

const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** A kid's partner logos that have a picture, in the order the kid's page shows them */
export function bandPartners(list: unknown): PartnerLogo[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((p) => p && typeof p === 'object' && typeof (p as PartnerLogo).url === 'string' && (p as PartnerLogo).url.trim())
    .map((p) => ({ url: String((p as PartnerLogo).url).trim(), name: String((p as PartnerLogo).name || '').trim() }));
}

/** A logo is drawn at most 30 px tall (26 on a phone): 80 px is that on the sharpest screens (3×), and the band's
 *  14-odd logos come to about 65 KB (96 px at q90 was 95 KB, for pixels no screen showed) */
const LOGO_ASK = 'trim=border,h=80,fit=scale-down,q=85';

/** The row repeats until it holds at least this many logos, so it is always wider than the band */
const MIN_ROW = 8;

/** The band's inside: its label and the moving row. '' when there's nothing to show */
export function partnersBandInner(partners: PartnerLogo[]): string {
  if (!partners.length) return '';
  const row = Array.from({ length: Math.max(1, Math.ceil(MIN_ROW / partners.length)) }, () => partners).flat();
  const chip = (p: PartnerLogo, read: boolean) =>
    `<li class="lpb-chip"${read ? '' : ' aria-hidden="true"'}><img src="${esc(cfRaw(p.url, LOGO_ASK))}" alt="${read ? esc(p.name) : ''}" loading="eager" fetchpriority="low" decoding="async" data-lpb-logo /></li>`;
  const chips = [...row, ...row].map((p, i) => chip(p, i < partners.length)).join('');
  return `<p class="lpb-label"><span>Built with</span> <span>help from</span></p><div class="lpb-window"><ul class="lpb-row" style="--lpb-n:${row.length}" aria-label="Partners who built this room">${chips}</ul></div>`;
}
