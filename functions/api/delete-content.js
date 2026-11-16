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
import { HISTORY_TABLES, recordDeletion } from './_content-history.js';

export async function onRequestPost(context) {
  try {
    const userEmail = context.data?.userEmail || 'unknown';
    const { path, message } = await context.request.json();

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
    return Response.json(
      { success: false, error: err.message || "An unexpected error occurred" },
      { status: 500 }
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
  const { DB } = env;
  const parsed = parsePath(path);
  if (!parsed) throw Object.assign(new Error('Path not allowed'), { status: 403 });

  // 0. Read old value before deleting (for audit trail)
  let oldData = null;
  let entityName = null;
  try {
    if (parsed.type === 'site') {
      const row = await DB.prepare('SELECT data FROM site_config WHERE key = ?').bind(parsed.key).first();
      if (row) { oldData = JSON.parse(row.data); entityName = getEntityName(oldData); }
    } else {
      const row = await DB.prepare(`SELECT data FROM ${parsed.table} WHERE slug = ?`).bind(parsed.slug).first();
      if (row) { oldData = JSON.parse(row.data); entityName = getEntityName(oldData); }
    }
  } catch (e) { /* ok */ }

  // 1. Delete from D1 FIRST (source of truth — prebuild reads from D1)
  if (parsed.type === 'site') {
    await DB.prepare('DELETE FROM site_config WHERE key = ?')
      .bind(parsed.key).run();
  } else {
    await DB.prepare(`DELETE FROM ${parsed.table} WHERE slug = ?`)
      .bind(parsed.slug).run();
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

  // A deleted item can come back: keep the record as it was (Recently deleted)
  if (HISTORY_TABLES[parsed.table] && oldData) {
    try { await recordDeletion(DB, { collection: parsed.table, slug: parsed.slug, data: oldData, userEmail, now: new Date().toISOString() }); }
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
