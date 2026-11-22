/**
 * Moves a staged copy (./stage.js) into both homes, Google Drive and Backblaze, and only then calls it safe.
 *
 *   Google Drive: a resumable upload session, saved before the first byte, filled 16 MiB at a time; on a retry
 *   Google is asked how much it has and the rest follows. Google's MD5 of what it kept must equal ours. A wrong
 *   copy can't be deleted (Contributor), so it's left with a note and a correct one is made beside it.
 *   Backblaze: one upload for a small copy (looked for first, so a retry never keeps it twice); a large one in
 *   16 MiB parts, the parts Backblaze already has listed first. Backblaze checks every part's SHA-1 itself.
 *
 * A home that isn't set up yet is skipped; the copy stays staged and waiting until it is, then catches up.
 */
import { createHash } from 'node:crypto';
import { PART, stagedRange } from './stage.js';
import { DriveError, startUpload, uploadStatus, sendPiece, confirmCopy, findChild, createFolder, fileInfo, FOLDER } from './drive.js';
import { B2Error } from './b2.js';
import { hasher, putStream } from './stage.js';

const dirname = (p) => p.split('/').slice(0, -1).join('/');
const basename = (p) => p.split('/').pop();
const sha1 = (b) => createHash('sha1').update(b).digest('hex');

/**
 * The Drive folder for `path` (made a level at a time the first time), as its id. A folder remembered from before
 * is looked at once per step: one someone deleted, put in the trash (a file put there would go when the trash is
 * emptied) or moved into another drive is forgotten, and found or made again.
 */
export async function driveFolder(home, state, path) {
  if (!path) return home.driveId;
  home.checked ||= new Set();
  const known = await state.folder(home.driveId, path);
  if (known) {
    if (home.checked.has(known)) return known;
    let there = false;
    try {
      // Not in the trash, and still in the backup drive (a folder moved into another drive isn't the backup's)
      const info = await fileInfo(home.token, known, { fetchImpl: home.fetchImpl });
      there = !info?.trashed && info?.driveId === home.driveId;
    } catch (e) { if (!(e instanceof DriveError) || e.status !== 404) throw e; }
    if (there) { home.checked.add(known); return known; }
    await state.forgetFolders(home.driveId);
    home.checked = new Set();
  }
  const parent = await driveFolder(home, state, dirname(path));
  const name = basename(path);
  const found = await findChild(home.token, home.driveId, parent, name, { folder: true, fetchImpl: home.fetchImpl });
  const id = found?.id || await createFolder(home.token, parent, name, { fetchImpl: home.fetchImpl });
  await state.setFolder(home.driveId, path, id);
  home.checked.add(id);
  return id;
}

async function toDrive(env, home, state, c) {
  const name = basename(c.path);
  let session = c.drive_session;
  let st = null;
  if (session) {
    try { st = await uploadStatus(session, { total: c.size, fetchImpl: home.fetchImpl }); } catch (e) {
      if (!(e instanceof DriveError) || e.reason !== 'expired') throw e;
      session = null; // a week old: Google kept nothing from it, so start again
    }
  }
  if (!session) {
    const open = async () => startUpload(home.token, { name, parentId: await driveFolder(home, state, dirname(c.path)), size: c.size, description: `Encrypted with age for SOARD’s backup key ${home.fingerprint}. SHA-256 of this file: ${c.sha256}`, fetchImpl: home.fetchImpl });
    try { session = await open(); } catch (e) {
      // A folder someone removed in Drive since it was looked at: found or made again, once
      if (!(e instanceof DriveError) || e.status !== 404) throw e;
      await state.forgetFolders(home.driveId);
      home.checked = new Set();
      session = await open();
    }
    await state.updateCopy(c.id, { drive_session: session });
    st = { done: false, received: 0 };
  }
  while (!st.done) {
    const start = st.received;
    const length = Math.min(PART, c.size - start);
    const bytes = await stagedRange(env, c.staged, start, length);
    st = await sendPiece(session, bytes, { start, length, total: c.size, fetchImpl: home.fetchImpl });
    if (!st.done && st.received <= start) throw new DriveError(`Google kept nothing of a piece of ${name}`, 308, 'stalled');
  }
  let kept;
  try {
    kept = await confirmCopy(home.token, st, { size: c.size, md5: c.md5, name, fetchImpl: home.fetchImpl });
  } catch (e) {
    if (!(e instanceof DriveError) || !['mismatch', 'unconfirmed'].includes(e.reason)) throw e;
    // Not the copy that was sent, or one Google won't vouch for: left there (a Contributor can't delete), and sent again
    await state.updateCopy(c.id, { drive_session: null, error: `Google Drive kept a copy that couldn’t be confirmed (left there${st.id ? `, id ${st.id}` : ''}); sending it again` });
    throw e;
  }
  await state.updateCopy(c.id, { drive_id: kept.id, drive_session: null });
}

async function toB2(env, b2, state, c) {
  // Already there (an earlier try finished but its answer was lost): Backblaze keeps the SHA-1 of every file
  const found = await b2.find(c.path, c.sha1);
  if (found) { await state.updateCopy(c.id, { b2_id: found.fileId, b2_large: null }); return; }
  if (c.size <= PART) {
    const got = await b2.upload(c.path, await stagedRange(env, c.staged, 0, c.size), { sha1: c.sha1 });
    await state.updateCopy(c.id, { b2_id: got.fileId });
    return;
  }
  let large = c.b2_large;
  let have = null;
  if (large) {
    try { have = new Map((await b2.parts(large)).map((p) => [p.partNumber, p])); } catch (e) {
      // A large file Backblaze no longer has open (finished elsewhere, or gone): start again
      if (!(e instanceof B2Error) || (e.status !== 400 && e.status !== 404)) throw e;
      large = null;
    }
  }
  if (!large) {
    large = (await b2.startLarge(c.path, { sha1: c.sha1 })).fileId;
    await state.updateCopy(c.id, { b2_large: large });
    have = new Map();
  }
  const count = Math.ceil(c.size / PART);
  const sums = [];
  for (let n = 1; n <= count; n++) {
    const start = (n - 1) * PART;
    const length = Math.min(PART, c.size - start);
    const bytes = await stagedRange(env, c.staged, start, length);
    const s = sha1(bytes);
    const got = have.get(n);
    // A part Backblaze has counts only if it is these very bytes (it was sent from this copy's staged file)
    if (!got || got.contentSha1 !== s || Number(got.contentLength) !== length) await b2.sendPart(large, n, bytes, s);
    sums.push(s);
  }
  const done = await b2.finishLarge(large, sums);
  await state.updateCopy(c.id, { b2_id: done.fileId, b2_large: null });
}

/**
 * Ships one copy to every home that's set up. `homes` = { drive: { token, driveId, fingerprint } | null,
 * b2: client | null }. Returns the copy as it now stands.
 */
export async function shipCopy(env, homes, state, id) {
  let c = await state.copy(id);
  if (!c || c.shipped_at) return c;
  // A copy whose Drive file went missing after it was safe has no staged file left: Backblaze's (locked) copy is
  // staged again, and must be the very bytes that were sent
  if (homes.drive && !c.drive_id && !c.staged) {
    // (told as its own trouble: Backblaze's copy is the one nobody can change, and it couldn't be given back)
    const fail = (e) => { e.byHome = { restage: String(e?.message || e) }; return e; };
    if (!homes.b2 || !c.b2_id) throw fail(new B2Error(`${c.path}: its Google Drive copy is gone and Backblaze can’t be reached to send it again`, 0, 'lost'));
    const key = `stage/${encodeURIComponent(id)}/${crypto.randomUUID()}`;
    const h = hasher();
    try {
      const res = await homes.b2.download(c.b2_id);
      await putStream(env.STAGING, key, res.body.pipeThrough(new TransformStream({ transform(chunk, ctl) { h.update(chunk); ctl.enqueue(chunk); } })));
    } catch (e) { await env.STAGING.delete(key).catch(() => {}); throw fail(e); }
    const got = h.result();
    if (got.sha256 !== c.sha256 || got.size !== c.size) { await env.STAGING.delete(key); throw fail(new B2Error(`${c.path}: Backblaze’s copy isn’t what was sent`, 200, 'mismatch')); }
    c = await state.updateCopy(id, { staged: key });
  }
  // Each home on its own: one that's down (Drive full, Backblaze busy) never keeps a copy from the other
  const failed = [];
  const byHome = {};
  // (each home's own words kept as they are, before any are joined)
  if (homes.drive && !c.drive_id) { try { await toDrive(env, homes.drive, state, c); } catch (e) { failed.push(e); byHome.drive = String(e?.message || e); } c = await state.copy(id); }
  if (homes.b2 && !c.b2_id) { try { await toB2(env, homes.b2, state, c); } catch (e) { failed.push(e); byHome.b2 = String(e?.message || e); } c = await state.copy(id); }
  if (c.drive_id && c.b2_id) {
    // Safe in both homes: the staged file goes, and the copy no longer points at it
    const staged = c.staged;
    c = await state.updateCopy(id, { shipped_at: new Date().toISOString(), error: null, staged: null });
    if (staged) await env.STAGING.delete(staged);
  }
  if (failed.length) {
    const e = failed[0];
    if (failed.length > 1) e.message = failed.map((x) => x.message).join('; ');
    e.byHome = byHome;
    throw e;
  }
  return c;
}

export { FOLDER };
