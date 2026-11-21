/**
 * live-sponsors-html.ts — the build's sponsors by their tier, beside the live video
 * ==================================================================================
 * Peter, Nov 18 2026: "i want the sponsor shown by their tier, priority of screen should be the reveal, plans/before
 * and sponsors". In the Theater (a computer, an upright live video) the column right of the video holds the build's
 * sponsors, biggest first: the room's sponsor (the kid's `sponsors`, its Monetary Sponsor), then the partners on the
 * build (the kid's partner logos) by their level on the partner record (Admin → Partners): Signature, Champion,
 * Builder, Friend. A logo with no partner record is a Friend.
 *
 * One builder for both places it's drawn: LivePage.astro at build time for a child's own page, and
 * functions/live/[[path]].js for /live/, which follows whichever reveal is current. Plain functions. Styles:
 * LiveSponsors.astro (global, since the server's copy has no Astro scope).
 */
import { cfId, cfRaw } from './cf-image';

export type Tier = 'room' | 'signature' | 'champion' | 'builder' | 'friend';
export interface PartnerRecord { slug: string; name: string; level?: string | null; logo?: string | null }
export interface SponsorLogo { name: string; url: string }
export interface SponsorTier { tier: Tier; list: SponsorLogo[] }

const ORDER: Tier[] = ['room', 'signature', 'champion', 'builder', 'friend'];
const TITLES: Record<Tier, [string, string]> = {
  room: ['Room sponsor', 'Room sponsors'],
  signature: ['Signature partner', 'Signature partners'],
  champion: ['Champion partner', 'Champion partners'],
  builder: ['Builder partner', 'Builder partners'],
  friend: ['Friend', 'Friends'],
};
export const tierTitle = (t: Tier, n: number) => TITLES[t][n === 1 ? 0 : 1];

const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
// The partner record's name and a logo's, compared as the admin compares them (public/admin/partners-shared.js nameKey)
const nameKey = (name: string) => String(name || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const levelOf = (l: unknown): Tier => (l === 'signature' || l === 'champion' || l === 'builder' ? l : 'friend');

/**
 * The build's sponsors, by tier, biggest first (tiers with nobody left out). partnerLogos: the kid's partner logos
 * ({ url, name }); roomSponsors: the kid's sponsors (partner slugs); partners: the partner records
 */
export function sponsorTiers(partnerLogos: unknown, roomSponsors: unknown, partners: PartnerRecord[]): SponsorTier[] {
  const bySlug = new Map<string, PartnerRecord>(), byLogo = new Map<string, PartnerRecord>(), byName = new Map<string, PartnerRecord>();
  for (const p of partners || []) {
    if (!p?.slug) continue;
    bySlug.set(p.slug, p);
    if (p.logo) byLogo.set(cfId(p.logo), p);
    if (p.name) byName.set(nameKey(p.name), p);
  }
  const groups = new Map<Tier, SponsorLogo[]>(ORDER.map((t) => [t, []]));
  const seen = new Set<string>();
  const add = (tier: Tier, name: string, url: string, key: string) => {
    if (!url || seen.has(key)) return;
    seen.add(key);
    groups.get(tier)!.push({ name, url });
  };
  for (const slug of Array.isArray(roomSponsors) ? roomSponsors : []) {
    const p = bySlug.get(String(slug));
    if (p?.logo) add('room', p.name, p.logo, p.slug);
  }
  for (const l of Array.isArray(partnerLogos) ? partnerLogos : []) {
    const url = String((l as SponsorLogo)?.url || '').trim();
    if (!url) continue;
    const name = String((l as SponsorLogo)?.name || '').trim();
    const p = byLogo.get(cfId(url)) || (name ? byName.get(nameKey(name)) : undefined);
    add(p ? levelOf(p.level) : 'friend', p?.name || name, url, p?.slug || cfId(url));
  }
  return ORDER.map((tier) => ({ tier, list: groups.get(tier)! })).filter((g) => g.list.length);
}

/** A logo as asked of Cloudflare: its white edges trimmed, at most 256 px tall (128 at 2×: the room sponsor's cell at
 *  its biggest, 132px less its margin, LiveSponsors) */
const LOGO_ASK = 'trim=border,h=256,fit=scale-down,q=85';

/** The column's inside: its heading, the room's sponsors, then the partners' tiers in the showcase that turns their
 *  pages (LiveSponsors; src/utils/live-sponsors-show.ts lays them out on the page). '' when there's nobody */
export function sponsorsInner(tiers: SponsorTier[]): string {
  if (!tiers.length) return '';
  const card = (s: SponsorLogo) => `<li class="lsp-card"><img src="${esc(cfRaw(s.url, LOGO_ASK))}" alt="${esc(s.name)}" title="${esc(s.name)}" loading="eager" decoding="async" data-lsp-logo /></li>`;
  const tier = (g: SponsorTier) => `<section class="lsp-tier lsp-tier--${g.tier}" data-tier="${g.tier}" data-n="${g.list.length}"><p class="lsp-label">${esc(tierTitle(g.tier, g.list.length))}</p><ul class="lsp-grid">${g.list.map(card).join('')}</ul></section>`;
  const room = tiers.filter((g) => g.tier === 'room'), partners = tiers.filter((g) => g.tier !== 'room');
  return `<p class="lsp-head">Built with help from</p>${room.map(tier).join('')}${partners.length ? `<div class="lsp-show" data-lsp-show>${partners.map(tier).join('')}</div>` : ''}`;
}
