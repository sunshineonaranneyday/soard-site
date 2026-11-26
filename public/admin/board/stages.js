/**
 * A family's way from application to reveal, as the board page draws it: one
 * set of stages for Home's Makeovers card, the Makeovers page, the map and a
 * family's own page (./lifecycle.js). Peter, Nov 7 2026: "combining in some way
 * the applications and makeover kanban since that is the life span of a project
 * for us from application to completion".
 *
 * Where a family is comes from the server (../../../functions/api/_board-families.js
 * stageOf): their open job's JobTread status once it says one, else their
 * application's. Nothing here touches the page, so the tests read it as it is.
 */

import { todayEastern } from '../board-shared.js';
import { dayIn, dayText } from './parts.js';

export const STAGES = [
  { key: 'applied', label: 'Applied', phase: 'applying' },
  { key: 'review', label: 'In review', phase: 'applying' },
  { key: 'approved', label: 'Approved', phase: 'building' },
  { key: 'funding', label: 'Awaiting funding', phase: 'building' },
  { key: 'design', label: 'Design', phase: 'building' },
  { key: 'finalization', label: 'Finalization', phase: 'building' },
  { key: 'approval', label: 'Approval', phase: 'building' },
  { key: 'mobilization', label: 'Mobilization', phase: 'building' },
  { key: 'build', label: 'Build', phase: 'building' },
  { key: 'revealed', label: 'Revealed', phase: 'revealed' },
];
export const PHASES = [
  { key: 'applying', label: 'Applying' },
  { key: 'building', label: 'Building' },
  { key: 'revealed', label: 'Revealed' },
];
/** A makeover's JobTread Status as its stage (Closed Done and Warranty: done; On Site and others: the application says) */
export const STAGE_OF_JOB = { 'Awaiting Funding': 'funding', Design: 'design', Finalization: 'finalization', Approval: 'approval', Mobilization: 'mobilization', Build: 'build', 'Closed Done': 'revealed', Warranty: 'revealed', Denied: 'denied' };
const BY_KEY = new Map(STAGES.map((s, i) => [s.key, { ...s, i }]));
export const stageInfo = (key) => BY_KEY.get(key) || null;
export const stageLabel = (key) => BY_KEY.get(key)?.label || (key === 'denied' ? 'Not chosen' : 'No status');
export const phaseOf = (key) => BY_KEY.get(key)?.phase || '';
/**
 * Whether a family's step is known: JobTread was read (`jobs`, the families' answer's), or their step never rests on it
 * (no job, or revealed by their kid page). Else it's their application's, said so, never said as where they are
 * (Board QA round 13)
 */
export const stageKnown = (f, jobs) => jobs !== false || !f?.jobId || f?.stage === 'revealed';

// The map's key, a color to a step of the way: the application's two (as Applicants colors them), approved and
// awaiting funding each their own, one for being built, one for revealed. Never red; brand yellow is the service area's
export const STAGE_KEYS = [
  { key: 'applied', label: 'Applied', color: '#2B6CB0' },
  { key: 'review', label: 'In review', color: '#B7791F' },
  { key: 'approved', label: 'Approved', color: '#177E89' },
  { key: 'funding', label: 'Awaiting funding', color: '#7A8420' },
  { key: 'building', label: 'Building', color: '#2F7D4F' },
  { key: 'revealed', label: 'Revealed', color: '#6B4FA3' },
  { key: 'denied', label: 'Not chosen', color: '#7C7D84' },
  { key: 'none', label: 'No status', color: '#A3A4AA' },
];
/**
 * A family's key on the map: their stage, those being built as one (UNDERWAY, Design to Build). Approved and awaiting
 * funding haven't started, so they're keyed apart, as the line over the map and a phone's track count them (sumLine,
 * phaseCount): "0 Building, 1 approved" is never keyed "Building 1"
 */
export const keyOf = (f) => (UNDERWAY.has(f?.stage) ? 'building' : ['applied', 'review', 'approved', 'funding', 'revealed', 'denied'].includes(f?.stage) ? f.stage : 'none');
export const colorOf = (f) => STAGE_KEYS.find((k) => k.key === keyOf(f))?.color || '#A3A4AA';

/** The newest season among them ("2027") */
const newest = (list) => (list || []).map((f) => String(f.season || '')).filter(Boolean).sort().at(-1) || '';
const before = (y) => (/^\d{4}$/.test(y) ? String(Number(y) - 1) : y);

/**
 * Everyone in motion now: this season's applications, every makeover being built (any season), the families just
 * approved, and the reveals of the seasons still being built. Older families who were never decided, and anyone not
 * chosen, aren't "now". `application`: the window ({ year }) the server gives, or none
 */
export function inMotion(list, application = null) {
  const all = list || [];
  const current = String(application?.year || '') || newest(all);
  const building = all.filter((f) => phaseOf(f.stage) === 'building' && f.stage !== 'approved');
  const buildSeasons = new Set(building.map((f) => String(f.season || '')).filter(Boolean));
  if (!buildSeasons.size) buildSeasons.add(before(current));
  // (a family applies for one season and is often revealed in the next: their reveal's year says when)
  const thisYear = String(new Date().getFullYear());
  return all.filter((f) => {
    const y = String(f.season || '');
    if (f.stage === 'applied' || f.stage === 'review') return !y || y >= current;
    if (f.stage === 'approved') return !y || y >= before(current);
    if (phaseOf(f.stage) === 'building') return true;
    if (f.stage === 'revealed') return f.revealYear ? String(f.revealYear) >= thisYear : buildSeasons.has(y) || y >= current;
    return false;
  });
}

/**
 * "Underway" means being built, one meaning everywhere on the board page (Home's figure, the makeovers board's line,
 * What makeovers cost): Design to Build. Approved and awaiting funding haven't started, so they aren't
 */
export const UNDERWAY = new Set(['design', 'finalization', 'approval', 'mobilization', 'build']);
/**
 * The makeovers underway (JobTread's building jobs, numbers.projects.building: { status }) by stage, furthest along
 * first, so the parts always add up to the count → { count, parts: ['1 in build', '2 in design'] }
 */
export function underwayOf(building = []) {
  const by = new Map();
  for (const b of building || []) by.set(b.status, (by.get(b.status) || 0) + 1);
  const flow = STAGES.filter((s) => UNDERWAY.has(s.key)).reverse().map((s) => s.label);
  const order = [...flow.filter((st) => by.has(st)), ...[...by.keys()].filter((st) => !flow.includes(st))];
  return { count: (building || []).length, parts: order.map((st) => `${by.get(st)} in ${String(st || 'progress').toLowerCase()}`) };
}

/** How many at each stage: { applied: 3, … } */
export function countsOf(list) {
  const out = {};
  for (const f of list || []) out[f.stage] = (out[f.stage] || 0) + 1;
  return out;
}

/**
 * A stretch of the way in one count, as a phone's track says it under the line above it (./lifecycle.js sumLine), so
 * the two always agree: Building counts the makeovers being built (UNDERWAY, Design to Build), and those approved or
 * awaiting funding, not started, are said beside it, never counted in it. `counts`: ./countsOf
 * → { n, also: ['1 approved', '1 awaiting funding'] }
 */
export function phaseCount(counts, phase) {
  const steps = STAGES.filter((s) => s.phase === phase);
  const sum = (list) => list.reduce((t, s) => t + (counts?.[s.key] || 0), 0);
  if (phase !== 'building') return { n: sum(steps), also: [] };
  const waiting = steps.filter((s) => !UNDERWAY.has(s.key) && counts?.[s.key] > 0);
  return { n: sum(steps.filter((s) => UNDERWAY.has(s.key))), also: waiting.map((s) => `${counts[s.key]} ${s.label.toLowerCase()}`) };
}

/** The stages a board shows: every one with someone in it, Finalization only then, and Applied while applications are open */
export function shownStages(counts, application = null) {
  return STAGES.filter((s) => (counts[s.key] || 0) > 0 || (s.key === 'applied' && application?.open));
}

/** The stages a track shows: all but Finalization (it shows when someone's in it) */
export const trackStages = (counts) => STAGES.filter((s) => s.key !== 'finalization' || (counts[s.key] || 0) > 0);

// (a day or a moment, Atlanta's day: ./parts.js dayIn)
const DAY = (iso) => dayText(iso, 'md');
/** The application's window in a few words: "Open until Jan 31", "Opens Mar 1", "Closed" */
export function windowWords(app, today = todayEastern()) {
  if (!app) return '';
  if (app.open) return app.closesAt ? `Open until ${DAY(app.closesAt)}` : 'Open now';
  if (app.opensAt && dayIn(app.opensAt) >= today) return `Opens ${DAY(app.opensAt)}`;
  return 'Closed';
}

/** One of the families who applied (not a makeover the board knows by its page alone) */
export const isFamily = (x) => !/^(job|kid)-/.test(String(x?.id || ''));

/** Stage order for a list, as the way goes: applying first, revealed last, then not chosen and no status */
export const byStage = (a, b) => (stageInfo(a.stage)?.i ?? (a.stage === 'denied' ? 98 : 99)) - (stageInfo(b.stage)?.i ?? (b.stage === 'denied' ? 98 : 99));
