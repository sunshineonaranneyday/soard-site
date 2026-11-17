/**
 * The backup's own records (a Durable Object with its own SQLite, nothing to do with the site's database):
 *   copies   every file the backup has made: where it goes, its hashes, how far it is in each home, who is
 *            shipping it right now (a lease, so two runs never ship the same copy at once)
 *   sources  every photo, video and R2 file seen, each version, and which copy holds it
 *   folders  Google Drive folder ids, so a folder is made once
 *   kv       the backup key (age), the Stream signing key the site hands over, status, run and drill reports
 * Losing these never loses a backup (every copy is in Google Drive and Backblaze, each night lists what's where);
 * it would only mean files get copied once more.
 */
import { DurableObject } from 'cloudflare:workers';
import { newIdentity } from './stage.js';

// Copies a ship batch can take: missing a home that's up (one only missing a home that's down waits for it), and
// not held by another attempt
const UNSHIPPED = 'shipped_at IS NULL AND ((drive_id IS NULL AND ? = 1) OR (b2_id IS NULL AND ? = 1)) AND (lease_until IS NULL OR lease_until < ?)';
const upArgs = (up) => [up.drive ? 1 : 0, up.b2 ? 1 : 0];

// Which files go first each night: those tried least (so files that keep failing go to the back and never hold
// up the rest), then videos (the ones most at risk), then R2 files, then photos
const PRIORITY = "CASE WHEN source = 'videos' THEN 0 WHEN source LIKE 'r2:%' THEN 1 ELSE 2 END";

export class BackupState extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS copies (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, night TEXT NOT NULL, path TEXT NOT NULL, staged TEXT,
        size INTEGER, md5 TEXT, sha1 TEXT, sha256 TEXT, plain_sha256 TEXT, plain_size INTEGER, meta TEXT,
        drive_id TEXT, drive_session TEXT, b2_id TEXT, b2_large TEXT,
        ship_fails INTEGER NOT NULL DEFAULT 0, error TEXT, lease_by TEXT, lease_until INTEGER,
        created_at TEXT NOT NULL, queued_at TEXT, audited_at TEXT, ship_tried_at TEXT, shipped_at TEXT)`);
      this.sql.exec(`CREATE INDEX IF NOT EXISTS copies_open ON copies (shipped_at, ship_fails, created_at)`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS sources (
        source TEXT NOT NULL, key TEXT NOT NULL, version TEXT NOT NULL, size INTEGER, name TEXT, path TEXT,
        copy_id TEXT, seen TEXT NOT NULL, tries INTEGER NOT NULL DEFAULT 0, error TEXT, first_failed TEXT, item TEXT,
        PRIMARY KEY (source, key, version))`);
      this.sql.exec(`CREATE INDEX IF NOT EXISTS sources_todo ON sources (seen, copy_id)`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS folders (drive TEXT NOT NULL, path TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY (drive, path))`);
    });
  }

  // ── kv ──
  get(key) {
    const row = this.sql.exec('SELECT value FROM kv WHERE key = ?', key).toArray()[0];
    return row ? JSON.parse(row.value) : null;
  }
  set(key, value) {
    if (value == null) { this.sql.exec('DELETE FROM kv WHERE key = ?', key); return; }
    this.sql.exec('INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', key, JSON.stringify(value), new Date().toISOString());
  }
  merge(key, patch) {
    const next = { ...(this.get(key) || {}), ...patch };
    this.set(key, next);
    return next;
  }

  // ── the backup key: made once, here; only its public half leaves except for the drill and the recovery sheet ──
  async publicKey() {
    let k = this.get('age');
    if (!k) { k = await newIdentity(); this.set('age', { ...k, made: new Date().toISOString() }); }
    return { recipient: k.recipient, fingerprint: k.fingerprint, made: k.made };
  }
  async secretKey() {
    await this.publicKey();
    return this.get('age').identity;
  }

  // ── starting a run: one starter at a time (a method runs whole, so the check and the claim can't be split) ──
  claimStart(ticket, ms) {
    const now = Date.now();
    const cur = this.get('starting');
    if (cur && cur.until > now && cur.ticket !== ticket) return false;
    this.set('starting', { ticket, until: now + ms });
    return true;
  }
  releaseStart(ticket) {
    if (this.get('starting')?.ticket === ticket) this.set('starting', null);
  }

  // ── Google Drive folders ──
  folder(drive, path) {
    return this.sql.exec('SELECT id FROM folders WHERE drive = ? AND path = ?', drive, path).toArray()[0]?.id || null;
  }
  setFolder(drive, path, id) {
    this.sql.exec('INSERT OR REPLACE INTO folders (drive, path, id) VALUES (?, ?, ?)', drive, path, id);
  }
  forgetFolders(drive) {
    this.sql.exec('DELETE FROM folders WHERE drive = ?', drive);
  }

  // ── copies ──
  /**
   * Records a copy, unless one with this id is already recorded: the copy that's recorded wins, with the staged
   * file it was made from. Returns the recorded copy (whose `staged` tells a second maker its own file lost).
   */
  addCopy(c) {
    this.sql.exec(`INSERT OR IGNORE INTO copies (id, kind, night, path, staged, size, md5, sha1, sha256, plain_sha256, plain_size, meta, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, c.id, c.kind, c.night, c.path, c.staged ?? null, c.size ?? null, c.md5 ?? null, c.sha1 ?? null, c.sha256 ?? null,
    c.plain_sha256 ?? null, c.plain_size ?? null, c.meta ? JSON.stringify(c.meta) : null, new Date().toISOString());
    return this.copy(c.id);
  }
  copy(id) {
    const r = this.sql.exec('SELECT * FROM copies WHERE id = ?', id).toArray()[0];
    return r ? { ...r, meta: r.meta ? JSON.parse(r.meta) : null } : null;
  }
  updateCopy(id, patch) {
    const cols = Object.keys(patch).filter((k) => /^[a-z0-9_]+$/.test(k));
    if (!cols.length) return this.copy(id);
    this.sql.exec(`UPDATE copies SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...cols.map((k) => (k === 'meta' && patch[k] ? JSON.stringify(patch[k]) : patch[k] ?? null)), id);
    return this.copy(id);
  }
  /** Takes the right to ship a copy for `ms` (true), unless another run holds it (false). The same run may take it again. */
  claimCopy(id, by, ms) {
    const now = Date.now();
    this.sql.exec('UPDATE copies SET lease_by = ?, lease_until = ? WHERE id = ? AND shipped_at IS NULL AND (lease_until IS NULL OR lease_until < ? OR lease_by = ?)', by, now + ms, id, now, by);
    const r = this.sql.exec('SELECT lease_by FROM copies WHERE id = ?', id).toArray()[0];
    return r?.lease_by === by;
  }
  releaseCopy(id, by) {
    this.sql.exec('UPDATE copies SET lease_by = NULL, lease_until = NULL WHERE id = ? AND lease_by = ?', id, by);
  }
  /** A try at shipping, counted before it starts (a try cut off part way still counts, so it goes to the back) */
  shipAttempt(id) {
    this.sql.exec("UPDATE copies SET ship_fails = ship_fails + 1, ship_tried_at = ?, error = COALESCE(error, 'cut off while being sent') WHERE id = ?", new Date().toISOString(), id);
  }
  shipFailed(id, error) {
    this.sql.exec('UPDATE copies SET error = ? WHERE id = ?', String(error).slice(0, 300), id);
  }
  /** Copies not yet in every home, the ones that failed least first (so one that keeps failing never blocks the rest) */
  unshipped(limit = 50, up = { drive: true, b2: true }) {
    // The one tried longest ago first: each try goes to the back, so batches take every copy in turn, however
    // many times one has failed before
    return this.sql.exec(`SELECT id FROM copies WHERE ${UNSHIPPED} ORDER BY COALESCE(ship_tried_at, ''), created_at LIMIT ?`, ...upArgs(up), Date.now(), limit).toArray().map((r) => r.id);
  }
  /** How many copies a ship batch could take now: missing a home that's up, and not being sent by another attempt */
  shippable(up = { drive: true, b2: true }) {
    return this.sql.exec(`SELECT COUNT(*) AS n FROM copies WHERE ${UNSHIPPED}`, ...upArgs(up), Date.now()).one().n;
  }
  /** Of these copies, how many still lack this home */
  missingHome(home, ids) {
    const col = home === 'b2' ? 'b2_id' : 'drive_id';
    let n = 0;
    for (const id of ids) n += this.sql.exec(`SELECT COUNT(*) AS n FROM copies WHERE id = ? AND shipped_at IS NULL AND ${col} IS NULL`, id).one().n;
    return n;
  }
  /**
   * The Google Drive file of every copy that has been safe in both homes since before `before` (one shipped just now
   * may not show in Drive's listing yet; one not yet in Backblaze still has its staged bytes, and is left alone)
   */
  driveCopies(before) {
    return this.sql.exec('SELECT id, drive_id, audited_at FROM copies WHERE drive_id IS NOT NULL AND shipped_at IS NOT NULL AND shipped_at < ?', before).toArray();
  }
  /** Copies Drive was asked about by id and still holds (they go to the back of the next run's asking) */
  markAudited(ids) {
    const now = new Date().toISOString();
    for (const id of ids) this.sql.exec('UPDATE copies SET audited_at = ? WHERE id = ?', now, id);
  }
  /** A home has come up (set up, or back after a while away): the copies waiting for that home start their wait now */
  requeueUnshipped(home) {
    const col = home === 'b2' ? 'b2_id' : 'drive_id';
    this.sql.exec(`UPDATE copies SET queued_at = ? WHERE shipped_at IS NULL AND ${col} IS NULL`, new Date().toISOString());
  }
  /** How many copies still wait for this home */
  waitingFor(home) {
    const col = home === 'b2' ? 'b2_id' : 'drive_id';
    return this.sql.exec(`SELECT COUNT(*) AS n FROM copies WHERE shipped_at IS NULL AND ${col} IS NULL`).one().n;
  }
  /** Safe copies whose Drive file is gone (deleted, or in the trash): sent to Drive again, from Backblaze's copy */
  driveLost(ids) {
    // (its staged file went when it was safe: Backblaze's copy is staged again to send it)
    const now = new Date().toISOString();
    for (const id of ids) this.sql.exec("UPDATE copies SET drive_id = NULL, drive_session = NULL, shipped_at = NULL, staged = NULL, queued_at = ?, error = 'its Google Drive copy went missing (deleted or put in the trash)' WHERE id = ? AND shipped_at IS NOT NULL AND b2_id IS NOT NULL", now, id);
  }
  /** Copies waiting since before `since` to reach every home (newer ones, or ones sent again just now, may simply be on their way) */
  unshippedSince(since) {
    return this.sql.exec('SELECT COUNT(*) AS n FROM copies WHERE shipped_at IS NULL AND COALESCE(queued_at, created_at) < ?', since).one().n;
  }
  unshippedCount() {
    return this.sql.exec('SELECT COUNT(*) AS n FROM copies WHERE shipped_at IS NULL').one().n;
  }
  copies(where = {}) {
    const rows = where.kind
      ? this.sql.exec('SELECT * FROM copies WHERE kind = ? ORDER BY created_at DESC LIMIT ?', where.kind, where.limit || 50).toArray()
      : this.sql.exec('SELECT * FROM copies ORDER BY created_at DESC LIMIT ?', where.limit || 50).toArray();
    return rows.map((r) => ({ ...r, meta: r.meta ? JSON.parse(r.meta) : null }));
  }
  counts() {
    const c = this.sql.exec(`SELECT kind, COUNT(*) AS n, SUM(CASE WHEN shipped_at IS NULL THEN 1 ELSE 0 END) AS open, SUM(COALESCE(size, 0)) AS bytes FROM copies GROUP BY kind`).toArray();
    return Object.fromEntries(c.map((r) => [r.kind, { copies: r.n, waiting: r.open, bytes: r.bytes }]));
  }

  // ── sources ──
  /** Records tonight's listing of one source; returns how many versions still need a copy */
  syncSource(source, items, run) {
    for (const it of items) {
      this.sql.exec(`INSERT INTO sources (source, key, version, size, name, path, seen, item) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source, key, version) DO UPDATE SET seen = excluded.seen, size = COALESCE(excluded.size, sources.size), item = excluded.item`,
      source, it.key, String(it.version), it.size ?? null, it.name ?? null, it.path ?? null, run, JSON.stringify(it));
    }
    this.set(`listed:${source}`, { run, count: items.length, at: new Date().toISOString() });
    return this.sql.exec('SELECT COUNT(*) AS n FROM sources WHERE source = ? AND seen = ? AND copy_id IS NULL', source, run).one().n;
  }
  /** Versions seen in this run with no copy yet, in priority order; skips any that failed `maxTries` times this run */
  todo(run, limit, maxTries = 5) {
    return this.sql.exec(`SELECT * FROM sources WHERE seen = ? AND copy_id IS NULL AND tries < ? ORDER BY tries, ${PRIORITY}, key LIMIT ?`, run, maxTries, limit).toArray()
      .map((r) => ({ ...JSON.parse(r.item), tries: r.tries }));
  }
  todoCount(run, maxTries = 5) {
    const r = this.sql.exec(`SELECT SUM(CASE WHEN tries < ? THEN 1 ELSE 0 END) AS left, SUM(CASE WHEN tries >= ? THEN 1 ELSE 0 END) AS failed FROM sources WHERE seen = ? AND copy_id IS NULL`, maxTries, maxTries, run).one();
    return { left: r.left || 0, failed: r.failed || 0 };
  }
  sourceDone(source, key, version, copyId) {
    this.sql.exec('UPDATE sources SET copy_id = ?, error = NULL, first_failed = NULL WHERE source = ? AND key = ? AND version = ?', copyId, source, key, String(version));
  }
  /** A try at copying, counted before it starts: one that's cut off (too big, too slow, a step killed) still counts */
  sourceTrying(source, key, version) {
    this.sql.exec("UPDATE sources SET tries = tries + 1, error = 'the copy was cut off part way', first_failed = COALESCE(first_failed, ?) WHERE source = ? AND key = ? AND version = ?", new Date().toISOString(), source, key, String(version));
  }
  sourceFailed(source, key, version, error) {
    this.sql.exec('UPDATE sources SET error = ?, first_failed = COALESCE(first_failed, ?) WHERE source = ? AND key = ? AND version = ?', String(error).slice(0, 300), new Date().toISOString(), source, key, String(version));
  }
  /** A new run: every version gets its tries back (when each first failed is kept) */
  resetTries() {
    this.sql.exec('UPDATE sources SET tries = 0 WHERE copy_id IS NULL AND tries > 0');
  }
  /**
   * What's current in every source, and where its copy is: the run's files list, the one map from each code back to
   * its name. A source that couldn't be listed this run is carried as it was when it last was, so the newest list
   * always names everything.
   */
  currentFiles() {
    const out = [];
    for (const { source } of this.sql.exec('SELECT DISTINCT source FROM sources ORDER BY source').toArray()) {
      const seen = this.get(`listed:${source}`)?.run;
      if (!seen) continue;
      out.push(...this.sql.exec(`SELECT s.source, s.key, s.version, s.size, s.name, s.seen AS listed, c.path, c.drive_id, c.b2_id, c.plain_sha256, s.error
        FROM sources s LEFT JOIN copies c ON c.id = s.copy_id WHERE s.source = ? AND s.seen = ? ORDER BY s.key`, source, seen).toArray());
    }
    return out;
  }
  /**
   * The run as it stands (status() in ./index.js): its files only once one of its listings is in (before that, every
   * count would read 0), and a home's refusal only while a copy it refused still lacks it (as the run's summary says)
   */
  progress(run) {
    const listed = this.sql.exec("SELECT COUNT(*) AS n FROM kv WHERE key LIKE 'listed:%' AND json_extract(value, '$.run') = ?", run).one().n;
    const trouble = this.get('shipTrouble') || {};
    const refused = {};
    for (const home of ['drive', 'b2']) {
      const t = trouble[home];
      if (t && this.missingHome(home, t.ids || [])) refused[home] = { at: t.at || null, error: t.error || null };
    }
    // Backblaze couldn't give back a copy to send to Drive again: only while that copy still lacks Drive
    const r = trouble.restage;
    return {
      // (only what this run has given up on, as files.failed counts: a file being tried, or one that failed last
      // night and isn't tried yet tonight, still carries its old words)
      run, files: listed ? this.todoCount(run) : null, failures: listed ? this.failures(run, 10, 5) : [], refused,
      restage: r && this.missingHome('drive', r.ids || []) ? { at: r.at || null, error: r.error || null } : null,
      waitingFor: { drive: this.waitingFor('drive'), b2: this.waitingFor('b2') },
    };
  }
  failures(run, limit = 20, minTries = 0) {
    return this.sql.exec('SELECT source, key, name, error, tries, first_failed FROM sources WHERE seen = ? AND copy_id IS NULL AND error IS NOT NULL AND tries >= ? ORDER BY tries DESC LIMIT ?', run, minTries, limit).toArray();
  }
  /** Videos in the newest listing with no copy yet because Stream has no MP4 of them (the site asks Stream for one) */
  videosWaitingForMp4(limit = 500) {
    const run = this.get('listed:videos')?.run;
    if (!run) return [];
    return this.sql.exec(`SELECT key FROM sources WHERE source = 'videos' AND seen = ? AND copy_id IS NULL AND error LIKE 'Stream has no MP4%' ORDER BY key LIMIT ?`, run, limit).toArray().map((r) => r.key);
  }
  /** Private videos in the newest listing with no copy yet (only they need a Stream signing key) */
  privateVideosWaiting() {
    const run = this.get('listed:videos')?.run;
    if (!run) return 0;
    return this.sql.exec(`SELECT COUNT(*) AS n FROM sources WHERE source = 'videos' AND seen = ? AND copy_id IS NULL AND json_extract(item, '$.private') = 1`, run).one().n;
  }
  sampleCopies(kind, limit) {
    return this.sql.exec('SELECT * FROM copies WHERE kind = ? AND shipped_at IS NOT NULL ORDER BY random() LIMIT ?', kind, limit).toArray();
  }
}
