/**
 * POST /api/people-batch
 * One change across many People records in one request, for the Photos review:
 *   { updates: [{ slug, set: { photoCutout: true } }] }
 *   { updates: [{ slug, set: { photoCrop: { x, y, size }, photoSize: [w, h] } }] }
 * Only the allowed photo fields change (false or null clears one); each row
 * is read fresh and written back in one D1 batch, only over the record as it
 * was read (one renamed or deleted meanwhile is never brought back: said in
 * words), with an audit entry and a saved version per person.
 *
 * Admin-only (the middleware requires Access).
 */
import { EXTRACTORS, generateSha } from './_collections.js';
import { logAudit, diffJson, getEntityName } from './_audit.js';
import { ensureHistory, versionStatements, pruneHistory } from './_content-history.js';

const unit = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
const ALLOWED = {
  photoCutout: (v) => typeof v === 'boolean',
  // Fractions of the original photo (team-shared.js validCrop), or null for "center on the face"
  photoCrop: (v) => v === null || (!!v && typeof v === 'object' && unit(v.x) && unit(v.y) && unit(v.size) && v.size > 0 && Object.keys(v).length === 3),
  photoSize: (v) => v === null || (Array.isArray(v) && v.length === 2 && v.every((n) => Number.isInteger(n) && n > 0 && n < 100000)),
};
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,120}$/;

export async function batch(env, { updates } = {}, userEmail = 'unknown') {
  if (!Array.isArray(updates) || !updates.length || updates.length > 200) return { status: 400, body: { success: false, error: 'Nothing to change' } };
  for (const u of updates) {
    if (!SLUG_RE.test(u?.slug || '') || !u.set || typeof u.set !== 'object' || !Object.keys(u.set).length) return { status: 400, body: { success: false, error: 'Each change needs a person and a field' } };
    for (const [k, v] of Object.entries(u.set)) if (!ALLOWED[k] || !ALLOWED[k](v)) return { status: 400, body: { success: false, error: `“${k}” can’t be changed here` } };
  }
  const { DB } = env;
  await ensureHistory(DB);
  const read = async (list) => new Map(((await DB.prepare(`SELECT slug, data FROM team WHERE slug IN (${list.map(() => '?').join(', ')})`).bind(...list.map((u) => u.slug)).all()).results || []).map((r) => [r.slug, r.data]));
  const first = await read(updates);
  const missing = updates.filter((u) => !first.has(u.slug)).map((u) => u.slug);
  if (missing.length) return { status: 409, body: { success: false, error: `${missing.join(', ')} ${missing.length === 1 ? 'isn’t' : 'aren’t'} on People any more (renamed or deleted since this list was read), so nothing was saved. Look again.` } };
  // Someone whose web address is changing right now (a rename holds it), or who's being deleted: nothing is saved over
  // what the rename has just read, said in words (Board QA round 8: the framing saved during a rename was undone by it)
  const { whyHeld } = await import('./_advisory-add.js');
  const held = (await whyHeld(DB, updates.map((u) => u.slug))).filter((h) => h.by === 'people' || h.by === 'deleting');
  if (held.length) {
    const deleting = held.every((h) => h.by === 'deleting');
    const names = held.map((h) => { try { return getEntityName(JSON.parse(first.get(h.slug)), 'team') || h.slug; } catch { return h.slug; } });
    const who = names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
    const what = deleting ? `${who} ${held.length === 1 ? 'is' : 'are'} being deleted on People right now` : held.length === 1 ? `${who}’s web address is changing right now` : `The web addresses of ${who} are changing right now`;
    return { status: 409, body: { success: false, error: `${what}, so nothing was saved. Try again in a moment.`, notSaved: held.map((h) => h.slug) } };
  }

  // Each written only over its record as read (one UPDATE … WHERE data = what was read): a record renamed or deleted
  // meanwhile is never brought back as a second person (Board QA round 7: a photo framing saved during a rename put the
  // old record back beside the new one), and one saved meanwhile by someone else is read again and changed as it is now
  const now = new Date().toISOString();
  const changed = [];
  const gone = [];
  let todo = updates;
  let rows = first;
  for (let attempt = 0; attempt < 3 && todo.length; attempt++) {
    if (attempt) rows = await read(todo);
    const tries = [];
    for (const u of todo) {
      const raw = rows.get(u.slug);
      if (raw == null) { gone.push(u.slug); continue; }
      const before = JSON.parse(raw);
      const after = { ...before };
      for (const [k, v] of Object.entries(u.set)) { if (v === false || v === null) delete after[k]; else after[k] = v; }
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      const [cols, vals] = EXTRACTORS.team(after);
      const sets = ['"data" = ?', '"updated_at" = ?', ...cols.map((c) => `${c} = ?`)];
      // (its saved version in the same write, only if the record took it: a rename moving History never leaves it behind)
      const versions = await versionStatements(DB, { collection: 'team', slug: u.slug, data: after, previous: before, userEmail, now, table: 'team' });
      tries.push({ u, before, after, stmts: [DB.prepare(`UPDATE team SET ${sets.join(', ')} WHERE slug = ? AND data = ?`).bind(JSON.stringify(after), now, ...vals, u.slug, raw), ...versions] });
    }
    const results = tries.length ? await DB.batch(tries.flatMap((t) => t.stmts)) : [];
    todo = [];
    let at = 0;
    tries.forEach((t) => { const r = results[at]; at += t.stmts.length; if ((r?.meta?.changes ?? 0) > 0) changed.push({ slug: t.u.slug, before: t.before, after: t.after }); else todo.push(t.u); });
  }
  const unsaved = [...gone, ...todo.map((u) => u.slug)];
  const shas = {};
  for (const c of changed) {
    shas[c.slug] = await generateSha(JSON.stringify(c.after));
    await logAudit(DB, { userEmail, action: 'updated', entityType: 'team', entitySlug: c.slug, entityName: getEntityName(c.after, 'team'), changes: diffJson(c.before, c.after), path: `src/content/team/${c.slug}.json` });
    await pruneHistory(DB, 'team', c.slug).catch(() => {});
  }
  if (unsaved.length) {
    // (by the names they had as read: their records may be gone)
    const names = unsaved.map((s) => { try { return getEntityName(JSON.parse(first.get(s)), 'team') || s; } catch { return s; } });
    const who = names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
    const why = gone.length === unsaved.length ? `${unsaved.length === 1 ? 'was' : 'were'} renamed or deleted on People since this list was read` : 'changed on People while this was saving';
    return { status: 409, body: { success: false, error: `${who} ${why}, so ${unsaved.length === 1 ? 'their photo change wasn’t' : 'their photo changes weren’t'} saved${changed.length ? ' (everyone else’s were)' : ''}. Look again.`, changed: changed.map((c) => c.slug), notSaved: unsaved, shas } };
  }
  return { status: 200, body: { success: true, changed: changed.map((c) => c.slug), shas } };
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const r = await batch(context.env, body, context.data?.userEmail || 'unknown');
    return Response.json(r.body, { status: r.status });
  } catch (err) {
    console.error('[people-batch]', err);
    return Response.json({ success: false, error: err.message || 'Couldn’t save the changes' }, { status: 500 });
  }
}
