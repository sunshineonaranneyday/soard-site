/**
 * Which of a JobTread customer's jobs is their current one
 * ===========================================================================
 * Past makeovers get closed JobTread jobs made today (./_past-jobs.js): made
 * already closed, so their createdAt is years after their closedOn. "The
 * newest job by createdAt" would then pick a family's 2013 makeover over the
 * 2026 one they're in now, so every "which job is the family's" choice goes
 * through latestJob: an open job first, then a job that was really worked
 * (closed after it was made), the latest closed first, and a job made
 * already closed only when there's nothing else. No imports, so anything can
 * use it.
 */

/** A job made already closed (a past makeover's record), not one closed after its work */
export function madeClosed(job) {
  if (!job?.closedOn || !job?.createdAt) return false;
  const closedEnd = Date.parse(`${String(job.closedOn).slice(0, 10)}T23:59:59-05:00`);
  const made = Date.parse(job.createdAt);
  return Number.isFinite(closedEnd) && Number.isFinite(made) && made > closedEnd;
}

const rank = (j) => (!j.closedOn ? 0 : madeClosed(j) ? 2 : 1);
const newer = (a, b) => String(b || '').localeCompare(String(a || ''));

/** The customer's current job: open, then worked and closed (latest first), then made closed; null when none */
export function latestJob(jobs) {
  const list = (jobs || []).filter(Boolean);
  if (!list.length) return null;
  return [...list].sort((a, b) => rank(a) - rank(b)
    || (rank(a) === 0 ? newer(a.createdAt, b.createdAt) : newer(a.closedOn, b.closedOn) || newer(a.createdAt, b.createdAt)))[0];
}
