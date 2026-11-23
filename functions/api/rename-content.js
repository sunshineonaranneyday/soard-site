/**
 * POST /api/rename-content
 * Changes a person's web address (slug), for instance after a name change, so
 * the old name doesn't live on in it. Moves everything keyed by the slug:
 *   - the record itself (one D1 batch: the new row in, the old row out), and in
 *     the same batch, so all of it changes or none of it: their private
 *     reveal-invite email (reveal_board_emails), History, profile requests, their
 *     Advisory Board applications and a press of Add partway, and their sign-in
 *     email records (the Advisory Board's welcome, had or waiting, and Board's)
 *   - after it, each on its own: Board's records (./_board-rename.js) and an
 *     Advisory Board member's page records (./_advisory.js moveSlug)
 *   - their photo, when its Cloudflare Images ID carries the old slug
 *     ("team/<old>/…"): copied to "team/<new>/…", then the old one deleted.
 *     If the copy can't be made the photo stays as it was and `note` says so.
 *
 * Body: { collection: "team", from: "linzi-berkowitz", to: "linzi-lawsky" }
 * Returns: { success, slug, sha, photo, photoMoved, note }
 *
 * Admin-only (the middleware requires Access for /api/* not in PUBLIC_ROUTES).
 * Env: DB, CF_ACCOUNT_ID + CF_IMAGES_TOKEN (for the photo).
 */
import { EXTRACTORS, generateSha } from './_collections.js';
import { logAudit, auditStatement, getEntityName } from './_audit.js';
import { ensureHistory, versionsMove } from './_content-history.js';
import { ensureRequests, requestsMove } from './_profile-requests.js';
import { readState, moveStateEntry } from './_board-roles.js';
import { uploadImage, publicUrl } from './_cf-images.js';
import { addressTaken } from './_people-address.js';

const RENAMABLE = { team: { dir: 'src/content/team/', imagePrefix: 'team/' } };
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CF_HASH = 'ROYFuPmfN2vPS6mt5sCkZQ';
const API = (env) => `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/images/v1`;

/** The Cloudflare Images ID inside a stored photo URL (or a bare ID) */
export function imageIdOf(photo) {
  const s = String(photo || '');
  const m = s.match(/imagedelivery\.net\/[^/]+\/(.+)$/) || s.match(/\/cdn-cgi\/imagedelivery\/[^/]+\/(.+)$/);
  let id = m ? m[1] : (/^https?:/.test(s) ? '' : s);
  const last = id.lastIndexOf('/');
  if (last > 0) {
    const suffix = id.slice(last + 1);
    if (suffix === 'public' || suffix.includes('=')) id = id.slice(0, last);
  }
  return id;
}

/** Copy an image to a new ID: the original file if Cloudflare hands it over, else a full-size copy (either way through the shared upload) */
async function copyImage(env, fromId, toId, fetchImpl) {
  const auth = { Authorization: `Bearer ${env.CF_IMAGES_TOKEN}` };
  let file = null;
  for (const [url, headers] of [[`${API(env)}/${fromId}/blob`, auth], [`https://imagedelivery.net/${CF_HASH}/${fromId}/w=4096,fit=scale-down,q=100`, {}]]) {
    try {
      const r = await fetchImpl(url, { headers });
      if (r.ok) { const b = await r.blob(); if (b.size) { file = b; break; } }
    } catch {}
  }
  if (!file) throw new Error(`couldn’t read ${fromId}`);
  const body = await uploadImage(env, { file, filename: 'photo', id: toId }, fetchImpl);
  if (!body?.success) throw new Error(body?.errors?.[0]?.message || 'upload failed');
  return publicUrl({ ...body.result, id: body.result?.id || toId });
}

export async function rename(env, { collection, from, to } = {}, userEmail = 'unknown', fetchImpl = fetch) {
  // Own keys only: "constructor" or "__proto__" must not find something on Object.prototype
  const cfg = typeof collection === 'string' && Object.hasOwn(RENAMABLE, collection) ? RENAMABLE[collection] : null;
  if (!cfg) return { status: 403, body: { success: false, error: 'This item’s web address can’t be changed here' } };
  if (!SLUG_RE.test(from || '') || !SLUG_RE.test(to || '') || to.length > 80) {
    return { status: 400, body: { success: false, error: 'Use lowercase letters, numbers and single hyphens, like jane-smith' } };
  }
  if (from === to) return { status: 400, body: { success: false, error: 'That’s already the web address' } };
  // Held for the whole rename, the way a press of Add to Advisory Board holds the record it adds to (or makes one at the
  // new address): never one halfway through the other, so the record written back is never one read before an Add
  // changed it, and an Add never goes on with the address it had (its application, email and welcome left at the old one)
  let keys = null;
  if (collection === 'team') {
    // (an address someone already has, or History keeps someone's versions under, is said as that first, whatever's
    // holding it: trying again would never help. The rest of the one rule (./_people-address.js) is asked inside the
    // hold, once a rename still finishing there has been settled)
    const { holdForPeople, whyHeld } = await import('./_advisory-add.js');
    const first = await addressTaken(env.DB, to, { only: ['person', 'history'] });
    if (first) {
      // (a delete under way keeps its copy as it deletes: said as the delete it is until it's done)
      if (first.why === 'history' && (await whyHeld(env.DB, [to]))[0]?.by === 'deleting') return { status: 409, body: { success: false, error: `“${to}” is being deleted on People right now. Pick another address.` } };
      return { status: 409, body: { success: false, error: takenWords(to, first) } };
    }
    try { keys = await holdForPeople(env.DB, [from, to]); } catch (e) {
      console.error('[rename-content] hold', e?.message || e);
      return { status: 503, body: { success: false, error: 'The site’s database didn’t answer just now, so the address wasn’t changed. Try again in a moment.' } };
    }
    if (!keys) {
      // Said as what holds which: this person being changed or added, or the new address being given to someone else
      const why = await whyHeld(env.DB, [from, to]);
      const mine = why.find((h) => h.slug === from);
      const theirs = why.find((h) => h.slug === to);
      return { status: 409, body: { success: false, error: mine?.by === 'deleting' ? 'This person is being deleted on People right now, so their address wasn’t changed.'
        : mine?.by === 'people' ? 'Someone is changing this person on People right now (their web address, or a delete). Try again in a moment.'
        : mine?.by === 'add' ? 'Someone is adding this person to the Advisory Board right now. Change the address in a moment.'
          : theirs?.by === 'deleting' ? `“${to}” is being deleted on People right now. Pick another address.`
            : theirs?.by === 'people' ? `Someone is giving “${to}” to another People record right now. Pick another address, or try again in a moment.`
            : `Someone is adding a new person to the Advisory Board at “${to}” right now. Pick another address, or try again in a moment.` } };
    }
  }
  try {
    // A rename of theirs (or onto this address) still finishing: finished first, or this one waits (./_rename-finish.js)
    if (collection === 'team') {
      const left = await (await import('./_rename-finish.js')).settleFor(env.DB, [from, to]);
      if (left.length) {
        // (the list unread is never "none": it waits, said so; one stuck waits for a person, said as that, never as
        // "still moving", which may not be this person's at all)
        if (left.some((n) => n.unread)) return { status: 503, body: { success: false, error: 'The site couldn’t check for an earlier change of web address still finishing, so the address wasn’t changed. Try again in a moment.' } };
        const mine = left.filter((n) => n.from === from || n.to === from);
        const stuck = (mine.length ? mine : left).find((n) => n.stuck);
        if (stuck) {
          return { status: 409, body: { success: false, error: mine.length
            ? `An earlier change of web address (“${stuck.from}” to “${stuck.to}”) couldn’t finish by itself, and a person needs to settle it first, in the note at the top of People. The address wasn’t changed.`
            : `“${to}” was in a change of web address that couldn’t finish by itself (“${stuck.from}” to “${stuck.to}”), and a person needs to settle it first, in the note at the top of People. Pick another address.` } };
        }
        return { status: 409, body: { success: false, error: mine.length
          ? 'This person’s records from their last change of web address are still moving, so the address wasn’t changed. Try again in a minute.'
          : `“${to}” was someone’s address a moment ago, and their records are still moving off it. Try again in a minute.` } };
      }
    }
    return await renameHeld(env, { cfg, collection, from, to }, userEmail, fetchImpl);
  } finally {
    if (keys) await (await import('./_advisory-add.js')).letGo(env.DB, keys);
  }
}

// (a check of records kept under an address: a table not made yet keeps none, anything else that stops it stops the
// rename, never "nobody's", and is said in words by onRequestPost)
const notYet = (e) => { if (/no such table/i.test(e?.message || '')) return null; throw e; };

/** What keeps an address someone else's, as a rename onto it says it (./_people-address.js addressTaken) */
function takenWords(to, { why, note }) {
  return {
    person: `Someone already has the address “${to}”. Pick another.`,
    history: `“${to}” was someone’s address on People, and History keeps their versions under it. Pick another.`,
    board: `“${to}” was a board member’s address, and their board records are kept under it. Pick another.`,
    advisory: `“${to}” was an Advisory Board member’s address, and their records on the Advisory Board page are kept under it. Pick another.`,
    adding: `Someone new is being added to the Advisory Board at “${to}” (their Add stopped partway, and pressing Add to Advisory Board on their application again finishes it). Pick another address.`,
    application: `An Advisory Board application points at “${to}”, so it’s kept for whoever that is. Pick another address.`,
    welcome: `“${to}” was an Advisory Board member’s address, and the record of their sign-in email is kept under it. Pick another.`,
    renaming: note?.stuck
      ? `“${to}” was in a change of web address that couldn’t finish by itself (“${note.from}” to “${note.to}”), and a person needs to settle it first, in the note at the top of People. Pick another address.`
      : `“${to}” was someone’s address a moment ago, and their records are still moving off it. Try again in a minute.`,
  }[why] || `“${to}” is kept for someone else. Pick another address.`;
}
/** Whether a table is there yet (one that isn't keeps nothing to move); a check that fails stops the rename */
const hasTable = (DB, table) => DB.prepare(`SELECT 1 FROM ${table} LIMIT 1`).first().then(() => true, (e) => notYet(e) ?? false);

/**
 * The moves a rename of someone on People makes in its own batch, beside the record and its private email: History,
 * profile requests, Advisory Board applications and a press of Add partway, and the sign-in email records
 */
async function addressMoves(DB, from, to) {
  await ensureHistory(DB);
  await ensureRequests(DB);
  await readState(DB, 'welcome'); // (makes the table the sign-in email records are kept in)
  const [apps, intents] = [await hasTable(DB, 'advisory_applications'), await hasTable(DB, 'advisory_add_intents')];
  const { renameMemberStatements } = await import('./_advisory-mail.js');
  return [
    versionsMove(DB, 'team', from, to),
    requestsMove(DB, from, to),
    ...(apps ? [DB.prepare('UPDATE advisory_applications SET person_slug = ? WHERE person_slug = ?').bind(to, from)] : []),
    ...(intents ? [DB.prepare('UPDATE advisory_add_intents SET slug = ? WHERE slug = ?').bind(to, from)] : []),
    // (the Advisory Board's: had, or waiting)
    ...(await renameMemberStatements(DB, from, to)),
    // (Board's, Board → Members: when it went to them and to which address, and the ones Resend never answered)
    moveStateEntry(DB, 'welcome', 'members', from, to),
    moveStateEntry(DB, 'welcome', 'addresses', from, to),
    DB.prepare(`UPDATE board_state SET data = json_set(data, '$.unconfirmed', (SELECT json_group_array(CASE WHEN j.value = ?1 THEN ?2 ELSE j.value END) FROM json_each(board_state.data, '$.unconfirmed') AS j)), updated_at = ?3
      WHERE key = 'welcome' AND json_valid(data) AND json_type(data, '$.unconfirmed') = 'array' AND EXISTS (SELECT 1 FROM json_each(board_state.data, '$.unconfirmed') WHERE value = ?1)`).bind(from, to, new Date().toISOString()),
  ];
}

async function renameHeld(env, { cfg, collection, from, to }, userEmail, fetchImpl) {
  const { DB } = env;
  const table = collection;
  let row = await DB.prepare(`SELECT data FROM ${table} WHERE slug = ?`).bind(from).first();
  if (!row) return { status: 404, body: { success: false, error: 'Not found. Reload and try again.' } };
  if (await DB.prepare(`SELECT slug FROM ${table} WHERE slug = ?`).bind(to).first()) {
    return { status: 409, body: { success: false, error: `Someone already has the address “${to}”. Pick another.` } };
  }
  // A former board member's board records are kept under their address (signatures, sign-ins): never someone else's.
  // Their own earlier address, nobody's since, is theirs to go back to (a rename undone)
  let back = false;
  if (table === 'team') {
    try {
      const { slugsOf } = await import('./_board-sign.js');
      const mine = (await slugsOf(DB, from)).find((x) => x.slug === to && x.before);
      const since = mine ? await DB.prepare('SELECT seq FROM board_sign_events WHERE slug = ? AND seq > ? LIMIT 1').bind(to, mine.before).first() : null;
      back = !!mine && !since;
    } catch { /* no signing record yet */ }
  }
  // The one rule for whether an address is free (./_people-address.js), asked inside the hold: never given to someone with
  // a person's records still kept under it (Board QA round 6: their to-do became the new person's), nor the address a
  // stopped Add to Advisory Board wrote down for someone else (Advisory Board QA round 19: the applicant was linked to the
  // member renamed into it), nor one a rename that couldn't finish waits on. Their own earlier address (back): its board
  // and Advisory Board page records are theirs
  if (table === 'team') {
    const taken = await addressTaken(DB, to, { back });
    if (taken) return { status: 409, body: { success: false, error: takenWords(to, taken) } };
  }
  let before = JSON.parse(row.data);
  const firstPhoto = before.photo;

  // The photo first: if it can't move, the rename still goes ahead with the old photo
  let copied = null;
  let oldImageId = null;
  let note = null;
  const imageId = imageIdOf(before.photo);
  const dropCopy = async () => { if (copied) try { await fetchImpl(`${API(env)}/${imageIdOf(copied)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${env.CF_IMAGES_TOKEN}` } }); } catch {} };
  if (imageId && (imageId.startsWith(`${cfg.imagePrefix}${from}/`) || imageId === `${cfg.imagePrefix}${from}`)) {
    if (env.CF_ACCOUNT_ID && env.CF_IMAGES_TOKEN) {
      try {
        copied = await copyImage(env, imageId, `${cfg.imagePrefix}${to}/${Date.now()}`, fetchImpl);
        oldImageId = imageId;
      } catch (e) {
        note = `The photo couldn’t be moved (${e.message}), so its file name still has the old address. Upload the photo again to update it.`;
      }
    } else {
      note = 'The photo’s file name still has the old address (Cloudflare Images isn’t set up here). Upload the photo again to update it.';
    }
  }
  // The record at its new address: the one as read, with the photo's copy while its photo is still the one copied
  const at = (rec) => ({ ...rec, slug: to, ...(copied && rec.photo === firstPhoto ? { photo: copied } : {}) });
  let data = at(before);

  const finish = table === 'team' ? await import('./_rename-finish.js') : null;
  let audited = false;
  // (this rename's own moment and who made it: its "renamed" event says both, however it's finished)
  const renamedAt = new Date().toISOString();
  for (let attempt = 0; ; attempt++) {
    const json = JSON.stringify(data);
    const now = new Date().toISOString();
    const [cols, vals] = EXTRACTORS[table](data);
    const all = ['"slug"', '"data"', '"updated_at"', ...cols];
    // Their private email (how they sign in, and their reveal invites) moves in the same write: never a record at the new
    // address and its email left at the old one, nobody's, the person off the sign-in list at the next sync. One left at
    // the new address by nobody on People goes (never someone else's email given to them)
    const emails = table === 'team'
      ? await DB.prepare('SELECT slug FROM reveal_board_emails WHERE slug IN (?, ?)').bind(from, to).all().then((r) => (r.results || []).map((x) => x.slug)).catch(notYet)
      : null;
    // ...and so does everything else keyed by their address that one statement can move: their saved versions (History)
    // and profile requests, their Advisory Board applications and a press of Add to Advisory Board that was partway, and
    // their sign-in email's record, the Advisory Board's (had, or waiting) and Board's (Board → Members). All of it
    // changes, or none of it: never the record at the new address with its application still pointing at the old one (Left,
    // on the list) or its welcome left behind (sent again to a later application from them). Their tables made first (or
    // looked for: one not made yet keeps nothing), so a table never stops the write
    // The audit log's record of it, in the same write (Advisory Board QA round 21): an editor's save that names the old
    // address follows it to the new one from the moment the record moves (./_board.js addressesNow reads it), never
    // only once every record has followed, when a save in between kept the old one for good. (Its photo is the copy's
    // only while the record's photo is still the one copied)
    // (with its moment to the millisecond: a save's base is compared with it, ./_board.js addressesNow; Board QA round 9)
    const changes = [{ field: 'slug', from, to, at: renamedAt }, ...(copied && data.photo === copied ? [{ field: 'photo', from: before.photo, to: data.photo }] : [])];
    const auditEntry = { userEmail, action: 'updated', entityType: table, entitySlug: to, entityName: getEntityName(data, table), changes, path: `${cfg.dir}${to}.json`, gitStatus: null };
    try {
      const moves = table === 'team' ? await addressMoves(DB, from, to) : [];
      audited = table === 'team' && await hasTable(DB, 'audit_log');
      if (finish) await finish.noteReady(DB);
      await DB.batch([
        // Only over the record as it was read (Board QA round 8: a save made while the photo was copying, the Photos
        // review's framing or People's editor, was undone by the copy read before it): one changed since stops the whole
        // write here (a row with no data is refused, and the record's own insert after it would clash), and it's read again
        DB.prepare(`INSERT INTO ${table} (slug, data) SELECT ?, NULL WHERE NOT EXISTS (SELECT 1 FROM ${table} WHERE slug = ? AND data = ?)`).bind(to, from, row.data),
        DB.prepare(`INSERT INTO ${table} (${all.join(', ')}) VALUES (${all.map(() => '?').join(', ')})`).bind(to, json, now, ...vals),
        DB.prepare(`DELETE FROM ${table} WHERE slug = ? AND data = ?`).bind(from, row.data),
        ...(emails?.includes(to) ? [DB.prepare('DELETE FROM reveal_board_emails WHERE slug = ?').bind(to)] : []),
        ...(emails?.includes(from) ? [DB.prepare('UPDATE reveal_board_emails SET slug = ? WHERE slug = ?').bind(to, from)] : []),
        ...moves,
        // (their board records and Advisory Board page records follow right after: written down here, so they always do)
        ...(finish ? [finish.finishNote(DB, from, to, { at: renamedAt, by: userEmail || '' })] : []),
        ...(audited ? [auditStatement(DB, auditEntry)] : []),
      ]);
      break;
    } catch (e) {
      // Nothing changed. Lost to someone given the new address at that very moment (People's own add): said as the check
      // before it says it, never as the database not answering (Advisory Board QA round 20)
      if (table === 'team' && /UNIQUE constraint failed/i.test(String(e?.message || e))) {
        const taken = await addressTaken(DB, to, { back }).catch(() => null);
        if (taken) { await dropCopy(); return { status: 409, body: { success: false, error: takenWords(to, taken) } }; }
      }
      // Their record changed while this ran (a save, the Photos review): the newer one is carried, read again, never the
      // copy read before it
      const now2 = await DB.prepare(`SELECT data FROM ${table} WHERE slug = ?`).bind(from).first().catch(() => undefined);
      if (now2 === null) { await dropCopy(); return { status: 409, body: { success: false, error: 'This person was deleted or renamed while their address was changing, so nothing more was changed. Reload People.' } }; }
      if (now2 && now2.data !== row.data && attempt < 4) {
        row = now2;
        before = JSON.parse(row.data);
        data = at(before);
        continue;
      }
      if (now2 && now2.data !== row.data) { await dropCopy(); return { status: 409, body: { success: false, error: 'Their People record kept changing while their address was changing, so the address wasn’t changed. Try again in a moment.' } }; }
      // Nothing changed: drop the photo copy so no stray file is left behind
      await dropCopy();
      throw e;
    }
  }
  // (the copy is theirs only while their photo is the one copied: a new photo saved meanwhile keeps its own, and the copy goes)
  const photoMoved = !!copied && data.photo === copied;
  if (copied && !photoMoved) await dropCopy();
  // The rename is in the audit log before its records move (written with the rename's own batch, above): a save or an
  // "is this yours" check reads the rename from its note while that's there and from here after, so there's never a
  // moment between the note going and this entry when the old address can't be followed (Board QA round 9: a lead
  // refused their own Advisory Board page in that moment). A database with no audit table yet writes it here, still
  // before the records move
  if (!audited) {
    const changes = [{ field: 'slug', from, to, at: renamedAt }];
    if (photoMoved) changes.push({ field: 'photo', from: before.photo, to: data.photo });
    await logAudit(DB, {
      userEmail, action: 'updated', entityType: table, entitySlug: to,
      entityName: getEntityName(data, table), changes, path: `${cfg.dir}${to}.json`, gitStatus: null,
    });
  }
  // (their saved versions, profile requests, applications, a press of Add partway and their sign-in email's records
  // moved with the record, above)
  // A board member's board records follow them too, everywhere Board keeps their address: its own tables (sign-ins,
  // visits, signatures, asks, check-ins, votes, answers, notes) and inside each meeting (the attendance, the items they
  // present, their to-dos, the invite's answers), the secretary's notes and the agenda template (./_board-rename.js).
  // The signing chain is never rewritten: a 'renamed' event says the old slug is theirs (./_board-sign.js slugsOf)
  if (table === 'team' && !(await finish.finishRename(DB, from, to, { by: userEmail || '', at: renamedAt }))) {
    // (moved with the record: everything a person reads first; the rest finishes by itself, the heartbeat's)
    note = [note, 'Some of their Board and Advisory Board records are still moving to the new address. That finishes by itself in a minute or two.'].filter(Boolean).join(' ');
  }
  if (photoMoved && oldImageId) {
    try { await fetchImpl(`${API(env)}/${oldImageId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${env.CF_IMAGES_TOKEN}` } }); } catch {}
  }

  return { status: 200, body: { success: true, slug: to, sha: await generateSha(JSON.stringify(data)), photo: data.photo || '', photoMoved, note } };
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const r = await rename(context.env, body, context.data?.userEmail || 'unknown');
    return Response.json(r.body, { status: r.status });
  } catch (err) {
    console.error('[rename-content]', err);
    // (whatever reaches here stopped before the rename was saved, or as it was: nothing changed, said in words for staff,
    // never "D1_ERROR: …")
    return Response.json({ success: false, error: 'The address wasn’t changed: the site’s database didn’t answer just now. Try again in a moment.' }, { status: 500 });
  }
}
