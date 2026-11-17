/**
 * Reads from the database's nearest copy
 * ======================================
 * D1 keeps the database in Eastern North America and, with read replication on, a read-only copy in each region (no
 * extra cost: the same rows read). A read goes to a copy only through a session; anything else, and every write, goes
 * to the main one. About half the live page's loads come from far from Atlanta (Dallas, the West Coast, Europe), and
 * its first paint waits on a few reads one after another, so for them each read from a copy saves a trip across the
 * country or the ocean.
 *
 * Only for reads that a moment's lag can't hurt: the page drawn from them is put right by the page script, which asks
 * the main copy (/api/broadcast). A session is consistent with itself (a later read never sees an older database).
 * Without replication on, or where the binding has no sessions (tests, local), it is the database as it was.
 */
export function nearDB(DB) {
  if (!DB || typeof DB.withSession !== 'function') return DB;
  try { return DB.withSession('first-unconstrained'); } catch { return DB; }
}

/** The env with its DB read from the nearest copy, for helpers that take env */
export function nearEnv(env) {
  const DB = nearDB(env?.DB);
  return DB === env?.DB ? env : { ...env, DB };
}
