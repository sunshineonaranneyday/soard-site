/**
 * Sunny & Ranney's Google rating, as the store's own site has it (sunnyandranney.com syncs it from Google Places
 * every day and puts it in its page's schema.org aggregateRating). Read when this site is built, so the store page
 * never shows a count typed in once and left (it said "117 reviews" from March to Nov 21 2026, when Google had 121).
 * → { rating, count }, or null when the store's site couldn't say (the page then leaves the line out).
 */
export interface StoreRating { rating: number; count: number }

const STORE = 'https://sunnyandranney.com/';

/** The aggregateRating in a page's JSON-LD, or null */
export function ratingFromHtml(html: string): StoreRating | null {
  for (const m of String(html || '').matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try { data = JSON.parse(m[1]); } catch { continue; }
    const stack: unknown[] = [data];
    while (stack.length) {
      const o = stack.pop();
      if (!o || typeof o !== 'object') continue;
      if (Array.isArray(o)) { stack.push(...o); continue; }
      const r = (o as Record<string, any>).aggregateRating;
      if (r && typeof r === 'object') {
        const rating = Number(r.ratingValue);
        const count = Number(r.ratingCount ?? r.reviewCount);
        if (Number.isFinite(rating) && rating > 0 && rating <= 5 && Number.isInteger(count) && count > 0) return { rating, count };
      }
      for (const v of Object.values(o as Record<string, unknown>)) if (v && typeof v === 'object') stack.push(v);
    }
  }
  return null;
}

let _cached: Promise<StoreRating | null> | null = null;

export function storeRating(fetchImpl: typeof fetch = fetch): Promise<StoreRating | null> {
  if (_cached) return _cached;
  _cached = (async () => {
    try {
      const res = await fetchImpl(STORE, { signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'SOARD site build' } });
      if (!res.ok) return null;
      return ratingFromHtml(await res.text());
    } catch {
      return null;
    }
  })();
  return _cached;
}
