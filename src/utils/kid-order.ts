/**
 * The order of Meet the Kids (/kids/): every kid in the order of their reveal (Peter, Nov 25 2026: "update the
 * order so that it shows in order of reveal by default", then "all kids by reveal date").
 *
 * Kids still to be revealed come first, as before (Awaiting funding, then in build), the next reveal first: their
 * place on JobTread's schedule (/api/reveals `upcoming`, which a tentative reveal's day orders without ever being
 * shown). One with no reveal on the schedule yet follows, in the order set in the admin (sortOrder). Then every
 * finished room, the newest reveal first within its year: the year a page is filed under still groups them (the
 * year on each card, the year filter), and a kid whose reveal day the site doesn't know comes after the ones it
 * does in that year, by name.
 *
 * The page draws this order at build (src/pages/kids/index.astro) and sorts by the same function in the browser
 * when someone picks a sort: Oldest first runs each year the other way, the name sorts go by name, and kids still
 * to be revealed stay first, the next reveal first, either way time runs.
 */

export type KidSort = 'newest' | 'oldest' | 'name-az' | 'name-za';

export interface KidOrderKey {
  status: string;          // 'needs-funding' | 'in-progress' | 'completed'
  year: number;            // 0 when the page has none
  name: string;            // lowercased
  next: number | null;     // place on the schedule of reveals coming up, 0 = the next one
  revealed: string | null; // 'YYYY-MM-DD' a finished room was revealed, when the site knows it
  sortOrder: number | null;
}

const LAST = Number.MAX_SAFE_INTEGER;
const statusRank = (s: string) => (s === 'needs-funding' ? 0 : s === 'in-progress' ? 1 : 2);

/** Array.sort comparator for two kids under a sort (unknown sorts are Newest first) */
export function compareKids(a: KidOrderKey, b: KidOrderKey, sort: string = 'newest'): number {
  const sA = statusRank(a.status);
  const sB = statusRank(b.status);
  if (sA !== sB) return sA - sB;
  const byName = a.name.localeCompare(b.name);
  if (sort === 'name-az') return byName;
  if (sort === 'name-za') return -byName;
  const dir = sort === 'oldest' ? 1 : -1;
  if (sA < 2) {
    return (a.next ?? LAST) - (b.next ?? LAST)
      || (a.sortOrder ?? LAST) - (b.sortOrder ?? LAST)
      || dir * (a.year - b.year)
      || byName;
  }
  if (a.year !== b.year) return dir * (a.year - b.year);
  if (a.revealed !== b.revealed) {
    if (!a.revealed) return 1;
    if (!b.revealed) return -1;
    return dir * a.revealed.localeCompare(b.revealed);
  }
  return byName;
}

/** A card's key from its data attributes (data-status, data-year "year-2026", data-name, data-next, data-revealed, data-sort) */
export function cardOrderKey(d: DOMStringMap): KidOrderKey {
  const num = (v: string | undefined) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    status: d.status || 'completed',
    year: parseInt(String(d.year || '').replace('year-', ''), 10) || 0,
    name: d.name || '',
    next: num(d.next),
    revealed: d.revealed || null,
    sortOrder: num(d.sort),
  };
}
