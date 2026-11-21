/**
 * Auto-computed site stats from content collections.
 * Every number derived from actual data — no manual overrides.
 */
import { getPublishedKids, getPublishedCommunity } from './collections';

export interface SiteStats {
  /** Children served: those on finished makeovers (siblings on one profile count individually, childCount) */
  totalKids: number;
  /** Rooms built: the rooms of finished makeovers (roomCount) */
  totalRooms: number;
  /** Makeovers still in the works (in build or awaiting funding): their children and rooms, never in the totals above */
  inWorksKids: number;
  inWorksRooms: number;
  inWorksMakeovers: number;
  /** Finished rooms of each kind (a profile's own count of each kind; one for a kind it lists without a count) */
  roomsByType: Record<string, number>;
  /** Community projects count */
  communityProjects: number;
  /** Years of impact since 2012 */
  years: number;
}

/**
 * Finished: a makeover whose room is done (status "completed"). Until Nov 21 2026 every published profile counted,
 * so "children served" and "rooms built" included kids still in build or awaiting funding (218 and 310 then, for
 * 213 and 303 finished). src/pages, functions/api/_board.js, _newsletter-drafts.js and the admin's Dashboard count
 * the same way.
 */
export const isFinished = (d: { status?: string | null }) => (d?.status || 'completed') === 'completed';

/** A profile's rooms of each kind it lists: its own count of bedrooms, bathrooms and therapy rooms, at least one each */
export function roomsOfEachKind(d: { roomTypes?: string[] | null; bedroomCount?: number | null; bathroomCount?: number | null; therapyRoomCount?: number | null }): Record<string, number> {
  const own: Record<string, number | null | undefined> = { 'Dream Bedroom': d.bedroomCount, 'Accessible Bathroom': d.bathroomCount, 'Therapy Room': d.therapyRoomCount };
  const out: Record<string, number> = {};
  for (const t of d.roomTypes || []) {
    // (the schema fills a missing count with 0, so a kind listed counts as at least one room)
    const n = Object.hasOwn(own, t) && Number(own[t]) > 0 ? Number(own[t]) : 1;
    if (n > 0) out[t] = (out[t] || 0) + n;
  }
  return out;
}

let _cached: SiteStats | null = null;

export async function getSiteStats(): Promise<SiteStats> {
  if (_cached) return _cached;

  const kids = await getPublishedKids();
  const community = await getPublishedCommunity();

  const finished = kids.filter((k) => isFinished(k.data));
  const inWorks = kids.filter((k) => !isFinished(k.data));
  const kidsOf = (list: typeof kids) => list.reduce((sum, k) => sum + (k.data.childCount || 1), 0);
  const roomsOf = (list: typeof kids) => list.reduce((sum, k) => sum + (k.data.roomCount || 1), 0);
  const roomsByType: Record<string, number> = {};
  for (const k of finished) {
    for (const [t, n] of Object.entries(roomsOfEachKind(k.data))) roomsByType[t] = (roomsByType[t] || 0) + n;
  }

  _cached = {
    totalKids: kidsOf(finished),
    totalRooms: roomsOf(finished),
    inWorksKids: kidsOf(inWorks),
    inWorksRooms: roomsOf(inWorks),
    inWorksMakeovers: inWorks.length,
    roomsByType,
    communityProjects: community.length,
    years: new Date().getFullYear() - 2012,
  };

  return _cached;
}
