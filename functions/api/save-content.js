/**
 * POST /api/save-content
 * Updates D1 (source of truth for builds) THEN commits to GitHub (VCS backup).
 * D1 is what the prebuild script reads — it must always have the latest data.
 * GitHub failures are logged but don't block the save.
 *
 * Expects JSON body:
 *   {
 *     path: "src/content/kids/amari.json",
 *     content: "{ ... }",        // file content as JSON string
 *     message: "Update amari",   // used as git commit message
 *     sha: "..."                 // the version it was read at: changed since → 409
 *     create: true               // a new record: one already at that path (added meanwhile) → 409, never overwritten
 *   }
 *
 * Env bindings: DB (D1)
 * Env vars: GITHUB_TOKEN, GITHUB_REPO (required for git commits)
 *           GITHUB_BRANCH (optional, default "main")
 */

import { EXTRACTORS, parsePath, generateSha, scriptLinks, linkScheme } from './_collections.js';
import { commitFile } from './_github.js';
import { logAudit, diffJson, getEntityName } from './_audit.js';
import { refreshForBoardChange } from './_reveal-invites.js';
import { getsRevealInvites } from './_team.js';
import { HISTORY_TABLES, SITE_COLLECTION, recordVersion as recordContentVersion, ensureHistory, versionStatements, pruneHistory } from './_content-history.js';
import { coverOf } from './_job-covers.js';
import { syncCoverForKid } from './_kid-status.js';
import { recheckWaiting } from './_kid-partners.js';
import { wakeRevealDesigns } from './_reveal-design-auto.js';
import { keepGiftsForPartnerName } from './_donor-crm.js';
import { addressTaken, isPutBack } from './_people-address.js';

/** What keeps an address someone else's, as a new person on People is told (./_people-address.js addressTaken) */
function newPersonWords(slug, { why, note }) {
  return {
    person: `There’s one at that address already: someone added it since this list was read. Nothing was changed.`,
    history: `“${slug}” was someone’s address on People, and History keeps their versions under it. Give this person another address.`,
    board: `“${slug}” was a former board member’s address, and their board records are kept under it. Give this person another address.`,
    advisory: `“${slug}” was an Advisory Board member’s address, and their records on the Advisory Board page are kept under it. Give this person another address.`,
    adding: `Someone new is being added to the Advisory Board at “${slug}” (their Add stopped partway, and pressing Add to Advisory Board on their application again finishes it). Give this person another address.`,
    application: `An Advisory Board application points at “${slug}”, so it’s kept for whoever that is. Give this person another address.`,
    welcome: `“${slug}” was an Advisory Board member’s address, and the record of their sign-in email is kept under it. Give this person another address.`,
    renaming: note?.stuck
      ? `“${slug}” was in a change of web address that couldn’t finish by itself (“${note.from}” to “${note.to}”), and a person needs to settle it first, in the note at the top of People. Give this person another address.`
      : `“${slug}” was someone’s address a moment ago, and their records are still moving off it. Give this person another address.`,
  }[why] || `“${slug}” is kept for someone else. Give this person another address.`;
}

export async function onRequestPost(context) {
  try {
    const { DB } = context.env;
    const userEmail = context.data?.userEmail || 'unknown';
    const { path, content, message, sha: clientSha, create = false } = await context.request.json();

    if (!path || content === undefined || !message) {
      return Response.json(
        { success: false, error: 'Missing required fields: path, content, message' },
        { status: 400 }
      );
    }

    const parsed = parsePath(path);
    if (!parsed) {
      return Response.json(
        { success: false, error: 'Path not allowed' },
        { status: 403 }
      );
    }

    let data = typeof content === 'string' ? JSON.parse(content) : content;
    // A link that runs script when clicked (javascript:, data:, vbscript:) never
    // reaches the site or the public repo, whatever screen sent it
    const scripted = scriptLinks(data);
    if (scripted.length) {
      return Response.json(
        { success: false, error: `That link can’t be saved: ${scripted[0].path} must be a web address starting with https:// (not ${linkScheme(scripted[0].value)}:)`, fields: scripted.map((s) => s.path) },
        { status: 400 }
      );
    }
    let jsonStr = JSON.stringify(data);
    let prettyJson = JSON.stringify(data, null, 2);
    const now = new Date().toISOString();

    // 0. Read old value for diffing + optimistic-concurrency check
    let oldData = null;
    let oldRaw = null;
    let isCreate = true;
    try {
      if (parsed.type === 'site') {
        const row = await DB.prepare('SELECT data FROM site_config WHERE key = ?').bind(parsed.key).first();
        if (row) { oldRaw = row.data; oldData = JSON.parse(row.data); isCreate = false; }
      } else {
        const row = await DB.prepare(`SELECT data FROM ${parsed.table} WHERE slug = ?`).bind(parsed.slug).first();
        if (row) { oldRaw = row.data; oldData = JSON.parse(row.data); isCreate = false; }
      }
    } catch (e) {
      // No table yet: the first save. A stored record that isn't JSON: as before. The database not answering: stop
      // here in words (saving blind could write over a change, or answer "renamed or deleted" when neither is so)
      if (!(e instanceof SyntaxError) && !/no such table/i.test(e?.message || '')) {
        console.error('[save-content] read before save', e?.message);
        return Response.json({ success: false, error: 'The site’s database didn’t answer just now, so nothing was saved. Please try again in a moment.' }, { status: 503 });
      }
    }

    // Optimistic concurrency: if the client sent the sha it loaded and the row
    // still exists, reject when the stored content changed since. The client's
    // sha comes from read-content, which hashes the stored JSON string with
    // generateSha() — so compare against generateSha(oldRaw). No sha, or no
    // existing row (a create) → proceed as before.
    // Adding a new record where one is already (another tab, a teammate, a list read before it was added): never
    // overwrites it
    if (create === true && oldRaw !== null) {
      // The very record it would add (this save sent again after its answer was lost): done already
      if (oldRaw === jsonStr) return Response.json({ success: true, sha: await generateSha(oldRaw), same: true });
      return Response.json({ success: false, error: 'There’s one at that address already: someone added it since this list was read. Nothing was changed.' }, { status: 409 });
    }
    // A save to People with no sha (an add: the Add dialog, Paste a list, a new person in the editor) onto a record that's
    // there: never written over it, whoever's it is (Board QA round 8: an Add from a list read before someone was added,
    // or renamed onto that address, replaced their record and gave the newcomer their sign-in). The very record sent
    // again (its answer lost) is done already
    if (parsed.table === 'team' && !clientSha && create !== true && oldRaw !== null) {
      if (oldRaw === jsonStr) return Response.json({ success: true, sha: await generateSha(oldRaw), same: true });
      return Response.json({ success: false, error: 'There’s one at that address already: someone added it since this list was read. Nothing was changed.' }, { status: 409 });
    }
    // A person loaded with a sha whose row is gone was renamed or deleted
    // meanwhile: saving would bring the old record back as a duplicate
    if (clientSha && oldRaw === null && parsed.table === 'team') {
      return Response.json(
        { success: false, error: 'This person was renamed or deleted since you opened them. Go back to the list to open their current record.' },
        { status: 409 }
      );
    }

    // A person whose web address is changing right now (a rename holds it, and the address it's going to), or who's being
    // deleted: a save meanwhile is refused in words, never written where the rename has just read it from (Board QA round
    // 8: the Photos review's framing and People's editor were undone). A press of Add holds the record without this, and
    // saves through here itself
    if (parsed.table === 'team') {
      let why;
      try { why = (await (await import('./_advisory-add.js')).whyHeld(DB, [parsed.slug]))[0]?.by || null; } catch (e) {
        console.error('[save-content] hold check', e?.message);
        return Response.json({ success: false, error: 'The site’s database didn’t answer just now, so nothing was saved. Please try again in a moment.' }, { status: 503 });
      }
      // (said as what it is: someone there now whose address is changing or who's being deleted, or an address being given
      // to someone by a rename, or freed by a delete)
      const here = oldRaw !== null;
      if (why === 'deleting') return Response.json({ success: false, error: here ? 'This person is being deleted on People right now, so nothing was saved.' : `“${parsed.slug}” is being freed by a delete on People right now, so nothing was saved. Try again in a moment.` }, { status: 409 });
      if (why === 'people') return Response.json({ success: false, error: here ? 'Their web address is changing right now, so nothing was saved. Try again in a moment.' : `Someone is giving “${parsed.slug}” to another People record right now, so nothing was saved. Give this person another address, or try again in a moment.` }, { status: 409 });
    }

    // A new person on People, at an address something of someone else's is still kept under: never given to them, by the
    // one rule Add to Advisory Board and a rename onto an address ask too (./_people-address.js; Advisory Board QA round
    // 19: a new person took a renamed member's Advisory Board page records). The same person put back (Undo after a
    // delete: the very record History's last delete kept) is theirs to have again; Add's own save, at the address it wrote
    // down for its application, is its own (context.data.addingFor, set only by ./_advisory-add.js, never by a request).
    // A check that can't be made saves nothing, never a guess that it's free
    if (isCreate && parsed.table === 'team') {
      let taken;
      try {
        const putBack = await isPutBack(DB, parsed.slug, data);
        taken = await addressTaken(DB, parsed.slug, { app: context.data?.addingFor ?? null, putBack });
      } catch (e) {
        console.error('[save-content] address check', e?.message);
        return Response.json({ success: false, error: 'The site’s database didn’t answer just now, so nothing was saved. Please try again in a moment.' }, { status: 503 });
      }
      if (taken) return Response.json({ success: false, error: newPersonWords(parsed.slug, taken) }, { status: 409 });
    }

    if (clientSha && oldRaw !== null) {
      const currentSha = await generateSha(oldRaw);
      if (currentSha !== clientSha) {
        return Response.json(
          { success: false, error: 'Conflict: this item was changed since you loaded it. Reload to get the latest version.' },
          { status: 409 }
        );
      }
    }

    // Who designed a room and who paid for it are room credits (./_room-credits.js): picked in JobTread or on their
    // card in Admin → Kids, never by a page save, so a tab opened before a credit changed can't put it back
    if (!isCreate && (parsed.table === 'kids' || parsed.table === 'community')) {
      const kept = (k) => (Array.isArray(oldData?.[k]) ? oldData[k] : []);
      const same = (k) => JSON.stringify(kept(k)) === JSON.stringify(Array.isArray(data[k]) ? data[k] : []);
      if (!same('designers') || !same('sponsors')) {
        data = { ...data, designers: kept('designers'), sponsors: kept('sponsors') };
        jsonStr = JSON.stringify(data);
        prettyJson = JSON.stringify(data, null, 2);
      }
    }

    // A partner card added or renamed: the gifts Donors & Partners counted for a name by itself stay where they count
    // (written first: if the save is then refused, they're only linked where they counted already)
    if (parsed.table === 'partners' && (data?.name || parsed.slug) !== (oldData?.name || (oldData ? parsed.slug : null))) {
      await keepGiftsForPartnerName(DB, { slug: parsed.slug, name: data?.name, by: userEmail, now: Date.parse(now) });
    }

    // People's saved version is written with the record, in the same write (a rename moving History never leaves one
    // behind at the address the person left: Board QA round 8). Its table made first: one that can't be stops the save
    const withRecord = parsed.table === 'team';
    let versions = [];
    if (withRecord) {
      try {
        await ensureHistory(DB);
        versions = await versionStatements(DB, { collection: 'team', slug: parsed.slug, data, previous: oldData, userEmail, now, table: 'team' });
      } catch (e) {
        console.error('[save-content] history before save', e?.message);
        return Response.json({ success: false, error: 'The site’s database didn’t answer just now, so nothing was saved. Please try again in a moment.' }, { status: 503 });
      }
    }

    // 1. Write to D1 FIRST (source of truth — prebuild reads from D1, not GitHub)
    if (parsed.type === 'site') {
      await DB.prepare(
        'INSERT OR REPLACE INTO site_config (key, data, updated_at) VALUES (?, ?, ?)'
      ).bind(parsed.key, jsonStr, now).run();
    } else {
      const { table, slug } = parsed;
      const extractor = EXTRACTORS[table];

      // A create (create: true) is a plain INSERT: two at one address at the same moment, the second is refused by the
      // database itself, never written over the first
      // (and every add to People: no record was there as read, so one there by now is someone else's, never written over)
      const adding = create === true || table === 'team';
      const verb = adding ? 'INSERT' : 'INSERT OR REPLACE';
      const taken = (e) => { if (adding && /UNIQUE constraint/i.test(String(e?.message || e))) throw Object.assign(new Error('There’s one at that address already: someone added it a moment ago. Nothing was changed.'), { status: 409 }); throw e; };
      if (extractor && !isCreate) {
        // Written only if the stored record is still the one read above: a sync or a credit card landing between
        // that read and this write isn't overwritten (the editor is told to reload instead)
        const [colNames, colValues] = extractor(data);
        const sets = ['"data" = ?', '"updated_at" = ?', ...colNames.map((c) => `${c} = ?`)];
        const write = DB.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE slug = ? AND data = ?`).bind(jsonStr, now, ...colValues, slug, oldRaw);
        const r = versions.length ? (await DB.batch([write, ...versions]))[0] : await write.run();
        if (!r?.meta?.changes) {
          return Response.json({ success: false, error: 'Conflict: this item was changed since you loaded it. Reload to get the latest version.' }, { status: 409 });
        }
      } else if (extractor) {
        const [colNames, colValues] = extractor(data);
        const allCols = ['"slug"', '"data"', '"updated_at"', ...colNames];
        const placeholders = allCols.map(() => '?').join(', ');
        const allValues = [slug, jsonStr, now, ...colValues];

        const write = DB.prepare(`${verb} INTO ${table} (${allCols.join(', ')}) VALUES (${placeholders})`).bind(...allValues);
        await (versions.length ? DB.batch([write, ...versions]) : write.run()).catch(taken);
      } else {
        await DB.prepare(
          `${verb} INTO ${table} (slug, data, updated_at) VALUES (?, ?, ?)`
        ).bind(slug, jsonStr, now).run().catch(taken);
      }
    }

    const sha = await generateSha(jsonStr);

    // 2. Commit to GitHub (VCS backup). Non-blocking — D1 already has the data.
    let gitStatus = 'ok';
    try {
      await commitFile(context.env, path, prettyJson + '\n', message);
    } catch (err) {
      gitStatus = 'failed';
      console.error('[save-content] GitHub commit failed:', err.message);
    }

    // 3. Audit log
    const entityType = parsed.type === 'site' ? parsed.key : parsed.table;
    const entitySlug = parsed.type === 'site' ? parsed.key : parsed.slug;
    const action = isCreate ? 'created' : (data.publishStatus === 'draft' ? 'drafted' : 'updated');

    await logAudit(DB, {
      userEmail,
      action,
      entityType,
      entitySlug,
      // A save through the SOARD connection for Claude says so (./_mcp/pages.js)
      entityName: `${getEntityName(data, entityType) || ''}${context.data?.via || ''}` || null,
      changes: isCreate ? null : diffJson(oldData, data),
      path,
      gitStatus,
    });

    // Every saved version is kept, so the editors can show history and restore
    const historyOf = parsed.type === 'site' ? { collection: SITE_COLLECTION, slug: parsed.key } : HISTORY_TABLES[parsed.table] ? { collection: parsed.table, slug: parsed.slug } : null;
    if (historyOf && withRecord) await pruneHistory(DB, historyOf.collection, historyOf.slug).catch((e) => console.error(`[save-content] ${historyOf.collection} history:`, e.message));
    else if (historyOf) {
      try { await recordContentVersion(DB, { ...historyOf, data, previous: oldData, userEmail, now }); }
      catch (e) { console.error(`[save-content] ${historyOf.collection} history:`, e.message); }
    }

    // Joining or leaving the board changes who confirmed reveal invites reach: follow it now
    if (parsed.table === 'team' && getsRevealInvites(oldData) !== getsRevealInvites(data)) context.waitUntil(refreshForBoardChange(context.env));
    // A kid's (or community project's) best photo is their JobTread job's cover: new photos go up now, not at the hourly sync
    if ((parsed.table === 'kids' || parsed.table === 'community') && coverOf(data) && coverOf(oldData)?.source !== coverOf(data).source) {
      context.waitUntil(syncCoverForKid(context.env, parsed.slug, { collection: parsed.table }));
    }
    // A logo added in Partners (or on a page) reaches the pages waiting for it now, not at the next 10-minute check
    const logoFacts = (d) => (parsed.table === 'partners' ? [d?.logo, d?.name, d?.website] : d?.partnerLogos || []);
    if (['partners', 'kids', 'community'].includes(parsed.table) && JSON.stringify(logoFacts(data)) !== JSON.stringify(logoFacts(oldData))) context.waitUntil(recheckWaiting(context.env));
    // Before photos nobody has looked at yet (brought in with Bring in from JobTread): the site looks at them now, not at
    // its next 10-minute run, and they stay off the page until it has (./_reveal-design-auto.js, ./_photo-screen.js)
    const unlooked = (d) => (d?.beforePhotos || []).filter((p) => p?.url && !p.looked).map((p) => p.url).join('\n');
    if (parsed.table === 'kids' && unlooked(data) && unlooked(data) !== unlooked(oldData)) context.waitUntil(wakeRevealDesigns(context.env));

    return Response.json({
      success: true,
      sha,
      path,
      gitCommit: gitStatus,
    });
  } catch (err) {
    if (err.status === 409) return Response.json({ success: false, error: err.message }, { status: 409 });
    console.error("[save-content]", err);
    return Response.json(
      { success: false, error: err.message || "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
