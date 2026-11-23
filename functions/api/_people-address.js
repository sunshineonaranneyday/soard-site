/**
 * _people-address.js: whether a People web address is free, one rule for every place that gives one out
 * ====================================================================================================
 * Add to Advisory Board (./_advisory-add.js freeSlug: the address its box would give someone new), People's own create
 * (./save-content.js) and a rename onto an address (./rename-content.js) each kept a list of their own, and each missed
 * something another had: Add gave out an address a rename had just left with its Advisory Board page records still under
 * it, and a rename took the address a stopped Add had written down for someone else (Advisory Board QA round 19, Nov 21
 * 2026). Now all three ask here. An address is taken while anything of anyone's is still kept under it:
 *
 *   'person'       a People record
 *   'history'      History's versions (someone deleted can be put back, so it stays theirs)
 *   'board'        a board member's board records: every place Board keeps them (./_board-rename.js BOARD_PLACES: its
 *                  tables, signed copies, meetings, practice meetings, the secretary's notes, the agenda template)
 *   'advisory'     the Advisory Board's records: every place it keeps them (./_advisory.js ADVISORY_PLACES: the page's
 *                  tables, the monthly ask email's links, the meetings, the settings)
 *   'adding'       an Add to Advisory Board written down partway (advisory_add_intents) for another application
 *   'application'  an Advisory Board application pointed at it
 *   'welcome'      a welcome record: had, waiting, or the name kept for their emails (./_advisory-mail.js mailSlugs)
 *   'renaming'     a rename still to finish whose old or new address it is (./_rename-finish.js), or one that couldn't
 *                  finish as it stood and waits for a person (`stuck`)
 *
 * Each caller says which in its own words. A read that fails throws: never a guess that it's free. A table not made yet
 * keeps nothing. 'board' and 'advisory' are read from the one list of where a person's things live
 * (./_member-places.js), the list People's note counts and a rename moves (Advisory Board QA round 20, Board QA round 8)
 */

const notYet = (e) => { if (/no such table/i.test(e?.message || '')) return null; throw e; };
const one = (DB, sql, ...binds) => DB.prepare(sql).bind(...binds).first().catch(notYet);

/**
 * Who has something kept under `slug` → null (free) or { why, note? } (note: the rename still to finish, { from, to, stuck })
 *   app      Add's own application: the address it wrote down for itself is its own to use
 *   back     a rename back to their own earlier address, nobody's since (./rename-content.js): its board and Advisory
 *            Board page records are theirs
 *   putBack  the same person put back at their address (./save-content.js isPutBack): what's kept under it is theirs
 *   only     just these kinds (a rename's first look, before it holds anything)
 */
export async function addressTaken(DB, slug, { app = null, back = false, putBack = false, only = null } = {}) {
  const asks = (why) => !only || only.includes(why);
  const theirs = back || putBack;
  if (asks('person') && await one(DB, 'SELECT slug FROM team WHERE slug = ?', slug)) return { why: 'person' };
  if (asks('history') && !putBack && await one(DB, "SELECT 1 AS x FROM content_versions WHERE collection = 'team' AND slug = ? LIMIT 1", slug)) return { why: 'history' };
  if (!theirs && (asks('board') || asks('advisory'))) {
    // (the signing chain too: its events are never rewritten, so an address with any is a board member's for good)
    if (asks('board') && await one(DB, 'SELECT slug FROM board_sign_events WHERE slug = ? LIMIT 1', slug)) return { why: 'board' };
    const { keptBy } = await import('./_member-places.js');
    const owner = await keptBy(DB, slug, { owners: ['board', 'advisory'].filter(asks) });
    if (owner) return { why: owner };
  }
  // (another application's, still there: one whose application was deleted is nobody's, ./_advisory-add.js deleteWhenFree)
  if (asks('adding') && await one(DB, 'SELECT i.slug FROM advisory_add_intents i JOIN advisory_applications a ON a.id = i.app_id WHERE i.slug = ? AND i.app_id != ? LIMIT 1', slug, String(app ?? ''))) return { why: 'adding' };
  if (asks('application') && !putBack && await one(DB, 'SELECT id FROM advisory_applications WHERE person_slug = ? LIMIT 1', slug)) return { why: 'application' };
  if (asks('welcome') && !putBack) {
    const { mailSlugs } = await import('./_advisory-mail.js');
    if ((await mailSlugs(DB)).includes(slug)) return { why: 'welcome' };
  }
  if (asks('renaming')) {
    const { renamesLeft } = await import('./_rename-finish.js');
    const note = (await renamesLeft(DB)).find((n) => n.from === slug || n.to === slug);
    if (note) return { why: 'renaming', note: { from: note.from, to: note.to, stuck: !!note.stuck } };
  }
  return null;
}

/**
 * A People record saved where none is, that is the very record History's last delete there kept (Undo after a delete):
 * the same person put back, never someone new. A read that fails throws
 */
export async function isPutBack(DB, slug, data) {
  const last = await one(DB, "SELECT data, action FROM content_versions WHERE collection = 'team' AND slug = ? ORDER BY id DESC LIMIT 1", slug);
  return !!last && last.action === 'delete' && last.data === JSON.stringify(data);
}
