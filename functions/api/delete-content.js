/**
 * POST /api/delete-content
 * Deletes from D1 (source of truth for builds) THEN removes from GitHub (VCS backup).
 * D1 is what the prebuild script reads — it must always reflect the latest state.
 * GitHub failures are logged but don't block the delete.
 *
 * Expects JSON body:
 *   {
 *     path: "src/content/kids/amari.json",
 *     sha: "...",              // ignored — kept for admin panel compatibility
 *     message: "Remove amari"  // used as git commit message
 *   }
 *
 * Env bindings: DB (D1)
 * Env vars: GITHUB_TOKEN, GITHUB_REPO (required for git commits)
 *           GITHUB_BRANCH (optional, default "main")
 */

import { parsePath } from './_collections.js';
import { deleteFile } from './_github.js';
import { logAudit, getEntityName } from './_audit.js';
import { setBoardEmail, refreshForBoardChange } from './_reveal-invites.js';
import { HISTORY_TABLES, ensureHistory, deletionStatement, pruneHistory } from './_content-history.js';

export async function onRequestPost(context) {
  try {
    const userEmail = context.data?.userEmail || 'unknown';
    const { path, message } = await context.request.json().catch(() => ({}));

    if (!path || !message) {
      return Response.json(
        { success: false, error: 'Missing required fields: path, message' },
        { status: 400 }
      );
    }
    if (!parsePath(path)) {
      return Response.json(
        { success: false, error: 'Path not allowed' },
        { status: 403 }
      );
    }
    const { gitCommit } = await deleteItem(context.env, { path, message }, userEmail, (p) => context.waitUntil(p));
    return Response.json({ success: true, gitCommit });
  } catch (err) {
    console.error("[delete-content]", err);
    // (refused in words, a 409 for one being changed right now; anything else stopped it before the delete was saved, or
    // as it was, everything after that taking care of itself: nothing deleted, said in words for staff, never
    // "D1_ERROR: …", and never a 502, which Cloudflare covers with its own page)
    return Response.json(
      { success: false, error: err.status ? err.message : 'Nothing was deleted: the site’s database didn’t answer just now. Try again in a moment.' },
      { status: err.status >= 400 && err.status < 500 ? err.status : 500 }
    );
  }
}

/**
 * Deletes one item, as Delete in the admin does: D1 first, then GitHub (not blocking), the audit log, and a copy
 * kept for Recently deleted. Shared by this endpoint and Partners → Merge into (./_room-credits.js mergeCredits),
 * which deletes the merged company inside its own locked step. → { gitCommit: 'ok' | 'failed' }
 */
/** Applications linked to someone deleted from People: unlinked, each with a note saying who it was */
async function unlinkApplications(DB, slug, name, by) {
  const { results } = await DB.prepare('SELECT id FROM advisory_applications WHERE person_slug = ?').bind(slug).all();
  await DB.prepare('DELETE FROM advisory_add_intents WHERE slug = ?').bind(slug).run().catch(() => {}); // (none made yet: no table)
  if (!results?.length) return;
  const { addAdvisoryNote } = await import('./_advisory-applications.js');
  await DB.prepare('UPDATE advisory_applications SET person_slug = NULL WHERE person_slug = ?').bind(slug).run();
  for (const r of results) await addAdvisoryNote(DB, r.id, `Their People record (${name}) was deleted, so this application isn’t linked to anyone now.`, { by });
}

export async function deleteItem(env, { path, message }, userEmail = 'unknown', waitUntil = (p) => p) {
  const parsed = parsePath(path);
  if (!parsed) throw Object.assign(new Error('Path not allowed'), { status: 403 });
  // Someone on People: held for the whole delete, the way a press of Add to Advisory Board holds the record it adds to,
  // so an Add never links an application to someone deleted meanwhile (Joined, pointing at nobody)
  if (parsed.table !== 'team') return deleteHeld(env, { path, message, parsed }, userEmail, waitUntil);
  const { holdForPeople, whyHeld, letGo } = await import('./_advisory-add.js');
  let keys;
  try { keys = await holdForPeople(env.DB, [parsed.slug], { deleting: true }); } catch (e) {
    console.error('[delete-content] hold', e?.message || e);
    throw Object.assign(new Error('The site’s database didn’t answer just now, so nobody was deleted. Try again in a moment.'), { status: 503 });
  }
  if (!keys) {
    const by = (await whyHeld(env.DB, [parsed.slug]))[0]?.by;
    throw Object.assign(new Error(by === 'deleting' ? 'This person is being deleted on People right now, in another tab or by someone else.'
      : by === 'people' ? 'Someone is changing this person on People right now (their web address, or a delete). Try again in a moment.'
        : 'Someone is adding this person to the Advisory Board right now, so they weren’t deleted. Try again in a moment.'), { status: 409 });
  }
  try {
    // A rename of theirs (or onto their address) still finishing: finished first, or nothing is deleted yet, so their
    // records are never left at an address nobody has (./_rename-finish.js). The list unread is never "none": it waits,
    // said so; one that couldn't finish as it stood waits for a person, said as that
    const left = await (await import('./_rename-finish.js')).settleFor(env.DB, [parsed.slug]);
    if (left.some((n) => n.unread)) throw Object.assign(new Error('Nothing was deleted: the site couldn’t check for an earlier change of web address still finishing. Try again in a moment.'), { status: 503 });
    const stuck = left.find((n) => n.stuck);
    if (stuck) throw Object.assign(new Error(`Nothing was deleted: an earlier change of web address (“${stuck.from}” to “${stuck.to}”) couldn’t finish by itself, and a person needs to settle it first, in the note at the top of People.`), { status: 409 });
    if (left.length) {
      throw Object.assign(new Error('Nothing was deleted: this person’s records from their last change of web address are still moving. Try again in a minute.'), { status: 409 });
    }
    return await deleteHeld(env, { path, message, parsed }, userEmail, waitUntil);
  } finally {
    await letGo(env.DB, keys);
  }
}

async function deleteHeld(env, { path, message, parsed }, userEmail, waitUntil) {
  const { DB } = env;

  // 0. Read old value before deleting (for audit trail, and the copy Recently deleted keeps). A read that doesn't answer
  // stops the delete (said in words by onRequestPost): never deleted with nothing kept, its History gone and its address
  // free for anyone. Only a record that can't be read as JSON goes without its copy
  let oldData = null;
  let entityName = null;
  const row = parsed.type === 'site'
    ? await DB.prepare('SELECT data FROM site_config WHERE key = ?').bind(parsed.key).first()
    : await DB.prepare(`SELECT data FROM ${parsed.table} WHERE slug = ?`).bind(parsed.slug).first();
  if (row) {
    try { oldData = JSON.parse(row.data); entityName = getEntityName(oldData); } catch (e) { console.error('[delete-content] unreadable record', parsed.table || parsed.key, e?.message); }
  }

  // 1. Delete from D1 FIRST (source of truth — prebuild reads from D1), in the same write as the copy Recently deleted
  // keeps: nothing is deleted until its copy is kept. A copy that can't be kept (History's table can't be made, its
  // write doesn't answer) deletes nothing, said in words by onRequestPost; the batch is all or nothing, so a delete that
  // fails keeps no copy either, and pressing Delete again does the whole of it once
  const remove = parsed.type === 'site'
    ? DB.prepare('DELETE FROM site_config WHERE key = ?').bind(parsed.key)
    : DB.prepare(`DELETE FROM ${parsed.table} WHERE slug = ?`).bind(parsed.slug);
  const keep = !!(HISTORY_TABLES[parsed.table] && oldData);
  if (keep) {
    await ensureHistory(DB);
    await DB.batch([deletionStatement(DB, { collection: parsed.table, slug: parsed.slug, data: oldData, userEmail, now: new Date().toISOString() }), remove]);
  } else {
    await remove.run();
  }

  // 2. Delete from GitHub (VCS backup). Non-blocking — D1 already reflects the delete.
  let gitStatus = 'ok';
  try {
    await deleteFile(env, path, message);
  } catch (err) {
    gitStatus = 'failed';
    console.error('[delete-content] GitHub delete failed:', err.message);
  }

  // 3. Audit log
  const entityType = parsed.type === 'site' ? parsed.key : parsed.table;
  const entitySlug = parsed.type === 'site' ? parsed.key : parsed.slug;
  await logAudit(DB, {
    userEmail,
    action: 'deleted',
    entityType,
    entitySlug,
    entityName,
    changes: null,
    path,
    gitStatus,
  });

  // A deleted item can come back: its copy was kept with the delete (above); only the newest are kept
  if (keep) {
    try { await pruneHistory(DB, parsed.table, parsed.slug); }
    catch (e) { console.error(`[delete-content] ${parsed.table} history:`, e.message); }
  }

  // Anyone removed from People: forget their private email (left behind, it would be no one's and still block
  // someone else using it), and an Advisory Board member's welcome record; a board or Advisory Board member comes
  // off open reveal invites now too
  if (parsed.table === 'team') {
    await setBoardEmail(DB, parsed.slug, '').catch(() => {});
    // An Advisory Board member's welcome went with them: someone later added at this address gets their own
    if (oldData?.group === 'advisory') await (await import('./_advisory-mail.js')).forgetMember(DB, parsed.slug).catch((e) => console.error('[delete-content] advisory welcome', e?.message));
    // Their Advisory Board applications stop pointing at this address (a new person may be given it): each keeps a
    // note of who it was linked to
    await unlinkApplications(DB, parsed.slug, entityName || parsed.slug, userEmail).catch((e) => {
      if (!/no such table/i.test(e?.message || '')) console.error('[delete-content] advisory applications', e?.message);
    });
    if (oldData?.group === 'board' || oldData?.group === 'advisory') waitUntil(refreshForBoardChange(env));
  }

  return { gitCommit: gitStatus };
}
