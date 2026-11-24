/**
 * Local runs keep everything on this machine (Advisory Board QA round 24, Nov 23 2026: the built page's Cloudflare
 * analytics beacon reached cloudflareinsights.com from 127.0.0.1 on every local run). The test servers strip it from every
 * page they serve, as the page goes out: the dns-prefetch link to it (a name lookup leaves the machine before any request
 * does), the inline script that adds it after the page loads, and a beacon script tag itself. Nothing else in the page
 * changes, so its CSP (which allows the beacon by hash) still holds for the rest.
 *   import { withoutBeacon, servesPage } from '../tests/lib/local-only.mjs';
 */
export const BEACON = /cloudflareinsights\.com/i;
// (a tag up to its end, never past the next tag of its kind: one look at each character, so a big page reads at once)
const LINK = /<link\b[^>]*cloudflareinsights\.com[^>]*>\s*/giu;
const SCRIPT = /<script\b[^>]*>(?:[^<]|<(?!\/script>))*<\/script>\s*/giu;

/** The page with the beacon taken out (any other page or file as it was) */
export function withoutBeacon(html) {
  const text = String(html);
  if (!BEACON.test(text)) return text;
  return text.replace(LINK, '').replace(SCRIPT, (tag) => (BEACON.test(tag) ? '' : tag));
}

/** A file's bytes as a test server sends them: an HTML page without the beacon, anything else as it is */
export function servesPage(path, bytes) {
  return /\.html?$/i.test(String(path)) ? Buffer.from(withoutBeacon(Buffer.from(bytes).toString('utf8')), 'utf8') : bytes;
}
