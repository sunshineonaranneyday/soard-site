/**
 * clock.mjs — a test's clock held at its sample data's day
 * =========================================================
 * Some code under test reads the clock itself while a test's sample data is dated: a board meeting on Nov 19, a
 * liability term that renews at the end of November, a job's tasks the week of Nov 11. Such a test passes only until
 * those dates go by (found Nov 19 2026 by running the whole suite with the clock a week, then 90 days, ahead).
 * holdClockAt(day) makes the clock start at that day and run on in real time from there, so waits and durations still
 * work: Date.now() and new Date() with no arguments both read it (dates made from a value are untouched). The
 * function it returns puts the real clock back.
 */
export function holdClockAt(day) {
  const RealDate = globalThis.Date;
  const start = typeof day === 'number' ? day : RealDate.parse(day);
  if (!Number.isFinite(start)) throw new Error(`holdClockAt: not a day: ${day}`);
  const from = RealDate.now();
  const now = () => start + (RealDate.now() - from);
  class HeldDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(now()); else super(...a); }
    static now() { return now(); }
  }
  globalThis.Date = HeldDate;
  return () => { globalThis.Date = RealDate; };
}
