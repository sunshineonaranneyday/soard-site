/**
 * Saved versions of content records (kids, team, community projects), so the
 * editors can show who changed what and put an earlier version back, and
 * deleted items can come back. One table for every collection: content_versions.
 * save-content and delete-content record every collection listed in
 * HISTORY_TABLES, so adding one there is all a new editor needs. Site Config
 * documents are recorded as collection 'site' (see SITE_COLLECTION).
 *
 *   - Every save records the version it wrote. The first save of an older
 *     record also records what was there before (no author, a second
 *     earlier), so the original can always come back.
 *   - A delete records the record that was deleted (action 'delete').
 *   - The newest 50 per item are kept.
 * Restoring loads a version into the editor; saving it records a new one.
 */

const KEEP = 50;
// Collection → its D1 table (the same name today; listed so nothing else is queried)
export const HISTORY_TABLES = { kids: 'kids', team: 'team', community: 'community', partners: 'partners', community_partners: 'community_partners', medialogos: 'medialogos', press: 'press', events: 'events' };
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,120}$/;
// Site Config documents (D1 site_config rows: settings, faq, our-story, media,
// financial-snapshot, financials) keep versions too, as collection 'site' with
// the row's key as the slug. They are never deleted, so no Recently deleted.
export const SITE_COLLECTION = 'site';
export const hasHistory = (collection) => !!HISTORY_TABLES[collection] || collection === SITE_COLLECTION;
// Not edits: positions in a list, and counts derived from other fields
const IGNORED = new Set(['order', 'sortOrder', 'photoCount']);

export async function ensureHistory(DB) {
  await DB.prepare(`CREATE TABLE IF NOT EXISTS content_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    collection TEXT NOT NULL,
    slug TEXT NOT NULL,
    data TEXT NOT NULL,
    action TEXT NOT NULL DEFAULT 'save',
    user_email TEXT,
    created_at TEXT NOT NULL
  )`).run();
  await DB.prepare('CREATE INDEX IF NOT EXISTS content_versions_item ON content_versions (collection, slug, id)').run();
}

const insert = (DB, { collection, slug, data, action = 'save', by = null, at }) =>
  DB.prepare('INSERT INTO content_versions (collection, slug, data, action, user_email, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(collection, slug, JSON.stringify(data), action, by, at);

async function prune(DB, collection, slug) {
  await DB.prepare(`DELETE FROM content_versions WHERE collection = ? AND slug = ? AND id NOT IN
    (SELECT id FROM content_versions WHERE collection = ? AND slug = ? ORDER BY id DESC LIMIT ${KEEP})`)
    .bind(collection, slug, collection, slug).run();
}

/**
 * The version a save writes (and, the first time, the one it replaced), as statements for the save's own batch: People's
 * saves write it with the record, so a rename moving History (./rename-content.js) never leaves one behind at an address
 * the person has left (Board QA round 8: written after the GitHub commit, two versions landed at the old address).
 * `table`: written only if that table's row holds this very record once the batch has run (a save refused as changed
 * meanwhile writes none). Call ensureHistory first, and pruneHistory after
 */
export async function versionStatements(DB, { collection, slug, data, previous = null, userEmail = null, now = new Date().toISOString(), table = null }) {
  const has = await DB.prepare('SELECT id FROM content_versions WHERE collection = ? AND slug = ? LIMIT 1').bind(collection, slug).first();
  const rows = [...(!has && previous ? [{ data: previous, by: null, at: new Date(Date.parse(now) - 1000).toISOString() }] : []), { data, by: userEmail, at: now }];
  return rows.map((r) => (table
    ? DB.prepare(`INSERT INTO content_versions (collection, slug, data, action, user_email, created_at) SELECT ?, ?, ?, 'save', ?, ? WHERE EXISTS (SELECT 1 FROM ${table} WHERE slug = ? AND data = ?)`)
      .bind(collection, slug, JSON.stringify(r.data), r.by, r.at, slug, JSON.stringify(data))
    : insert(DB, { collection, slug, data: r.data, by: r.by, at: r.at })));
}

/** Record the version just saved (and, the first time, the one it replaced) */
export async function recordVersion(DB, { collection, slug, data, previous = null, userEmail = null, now = new Date().toISOString() }) {
  await ensureHistory(DB);
  const has = await DB.prepare('SELECT id FROM content_versions WHERE collection = ? AND slug = ? LIMIT 1').bind(collection, slug).first();
  const stmts = [];
  // Before history began: kept with no author, a moment before this save
  if (!has && previous) stmts.push(insert(DB, { collection, slug, data: previous, at: new Date(Date.parse(now) - 1000).toISOString() }));
  stmts.push(insert(DB, { collection, slug, data, by: userEmail, at: now }));
  await DB.batch(stmts);
  await prune(DB, collection, slug);
}

/** Record a delete: the record as it was, so it can be restored */
export async function recordDeletion(DB, { collection, slug, data, userEmail = null, now = new Date().toISOString() }) {
  await ensureHistory(DB);
  await DB.batch([insert(DB, { collection, slug, data, action: 'delete', by: userEmail, at: now })]);
  await prune(DB, collection, slug);
}

/**
 * The copy a delete keeps, as a statement to run in the same batch as the delete itself (./delete-content.js): the
 * record is never gone with nothing kept. Call ensureHistory first (a table that can't be made stops the delete), and
 * pruneHistory after (only the newest are kept; one that doesn't answer loses nothing)
 */
export const deletionStatement = (DB, { collection, slug, data, userEmail = null, now = new Date().toISOString() }) =>
  insert(DB, { collection, slug, data, action: 'delete', by: userEmail, at: now });
export const pruneHistory = (DB, collection, slug) => prune(DB, collection, slug);

/** Fields that differ between two versions (list positions and derived counts aside) */
export function changedFields(before, after) {
  if (!before) return [];
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const k of IGNORED) keys.delete(k);
  return [...keys].filter((k) => JSON.stringify(before?.[k] ?? null) !== JSON.stringify(after?.[k] ?? null)).sort();
}

const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };

/** Newest first: { id, at, by, action, changed } (changed is null for the oldest) */
export async function listVersions(DB, collection, slug) {
  await ensureHistory(DB);
  const rows = (await DB.prepare('SELECT id, data, action, user_email, created_at FROM content_versions WHERE collection = ? AND slug = ? ORDER BY id ASC')
    .bind(collection, slug).all()).results || [];
  const out = [];
  let prev = null;
  for (const r of rows) {
    const d = parse(r.data) || {};
    out.push({ id: r.id, at: r.created_at, by: r.user_email || null, action: r.action || 'save', changed: prev ? changedFields(prev, d) : null });
    prev = d;
  }
  return out.reverse();
}

export async function getVersion(DB, collection, slug, id) {
  await ensureHistory(DB);
  const r = await DB.prepare('SELECT data FROM content_versions WHERE collection = ? AND slug = ? AND id = ?').bind(collection, slug, id).first();
  return r ? parse(r.data) : null;
}

/** Items deleted and not back since: the last delete of each, newest first */
export async function listDeleted(DB, collection, limit = 50) {
  const table = HISTORY_TABLES[collection];
  if (!table) return [];
  await ensureHistory(DB);
  const rows = (await DB.prepare(`SELECT v.id, v.slug, v.data, v.user_email, v.created_at FROM content_versions v
    WHERE v.collection = ? AND v.action = 'delete'
      AND v.id = (SELECT MAX(id) FROM content_versions w WHERE w.collection = v.collection AND w.slug = v.slug)
      AND NOT EXISTS (SELECT 1 FROM ${table} t WHERE t.slug = v.slug)
    ORDER BY v.id DESC LIMIT ?`).bind(collection, limit).all()).results || [];
  return rows.map((r) => {
    const d = parse(r.data) || {};
    return { id: r.id, slug: r.slug, name: d.name || d.title || r.slug, year: d.year ?? null, image: d.heroImage || d.photo || d.imageId || d.logo || null, at: r.created_at, by: r.user_email || null };
  });
}

/** After a web address change, the history follows the item */
export async function moveVersions(DB, collection, from, to) {
  await ensureHistory(DB);
  await versionsMove(DB, collection, from, to).run();
}
/** The same, as a statement for the change's own batch (./rename-content.js: call ensureHistory first) */
export const versionsMove = (DB, collection, from, to) => DB.prepare('UPDATE content_versions SET slug = ? WHERE collection = ? AND slug = ?').bind(to, collection, from);
