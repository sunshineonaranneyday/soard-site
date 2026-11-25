/**
 * Past makeovers' photos onto their JobTread jobs
 * ===========================================================================
 * Peter, Nov 25 2026: "make the rest, will you put the photos in there too?",
 * then "keep going". Each past makeover's job (./_past-jobs.js) gets the
 * photos from its folder in Drive: Sunshine - Photos & Video / _Makeover
 * Photos (to JobTread) / <the project's folder>, where the Dropbox move left
 * them waiting (about 30,000 for the 191 projects).
 *
 *   - Only the jobs the site made for past projects (a job with nothing on
 *     it), so nothing lands twice. A page that already had its job waits for
 *     a later step that compares photos first.
 *   - Photos only, picked by type or by name (Drive calls an iPhone's HEIC
 *     or a camera's RAW file a plain file): videos wait for the website
 *     library (reveal videos never go to JobTread), papers for the
 *     documents step.
 *   - Each gets its stage tag when something says so (./_file-tags.js):
 *     the folder it's in (Before, Home visit, Existing → Before; Demo,
 *     Progress, Construction, Build → During; Reveal, After, Finished →
 *     After), else the day it was taken against the reveal date (that day or
 *     later → After). Anything else gets no tag and stays staff only, as the
 *     plan has it: a photo nothing settles is never guessed.
 *   - JobTread fetches each file itself from a short link the site signs for
 *     six hours (/api/drive-file), which streams it from Drive, so no photo
 *     is ever held in memory. Up to 100 MB a file (JobTread's limit).
 *   - Every file is one row in D1 (past_photos): listed, copied with its
 *     JobTread file id, or skipped or failed with why, so a run that stops
 *     part way picks up where it left off and never copies a photo twice.
 *     Drive keeps every original; nothing is moved or deleted there.
 *   - Off until a founder turns it on (Admin → Kids → Past makeovers in
 *     JobTread): the first job's photos alone first, to check them in
 *     JobTread, then every job's. On the live hub's heartbeat, a folder
 *     listed or a few photos copied each minute, inside the heartbeat's time.
 */

import { pave, SOARD_ORG_ID, todayEastern, easternParts } from './_reveals.js';
import { accessToken } from './_google-calendar.js';
import { DRIVE_READ_SCOPE } from './_drive-search.js';
import { tagIds } from './_file-tags.js';
import { ensurePastJobs } from './_past-jobs.js';

export const PHOTOS_DRIVE = '0AIx702eEXf12Uk9PVA';              // Sunshine - Photos & Video
export const HOLDING = '_Makeover Photos (to JobTread)';
const READER = 'peter@soardcharity.com';                       // a member of Photos & Video, read through the site's delegation
const DRIVE = 'https://www.googleapis.com/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';
const MAX_BYTES = 100 * 1024 * 1024;                           // JobTread's limit for a file
const LINK_TTL_MS = 6 * 60 * 60 * 1000;
const TURN_MS = 60 * 1000;
const COPY_MS = 18 * 1000;                                     // inside the heartbeat's 28 seconds
const AT_ONCE = 3;                                             // photos copied side by side
const SITE = 'https://sunshineonaranneyday.com';
const iso = (t = Date.now()) => new Date(t).toISOString();
const enc = new TextEncoder();

export const SCHEMA = `CREATE TABLE IF NOT EXISTS past_photos (
  drive_id TEXT PRIMARY KEY, key TEXT NOT NULL, job_id TEXT NOT NULL, name TEXT NOT NULL, path TEXT, size INTEGER,
  taken_at TEXT, stage TEXT, stage_how TEXT, state TEXT NOT NULL DEFAULT 'listed', jt_file_id TEXT, error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0, claimed_at TEXT, listed_at TEXT NOT NULL, copied_at TEXT)`;
const INDEX = 'CREATE INDEX IF NOT EXISTS past_photos_by_state ON past_photos (state, key)';
const STATE = 'CREATE TABLE IF NOT EXISTS past_photos_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)';
const _ready = new WeakSet();
export async function ensurePastPhotos(DB) {
  if (_ready.has(DB)) return;
  await ensurePastJobs(DB);
  await DB.batch([DB.prepare(SCHEMA), DB.prepare(INDEX), DB.prepare(STATE)]);
  _ready.add(DB);
}
async function getState(DB, key) {
  const row = await DB.prepare('SELECT value FROM past_photos_state WHERE key = ?').bind(key).first();
  try { return row ? JSON.parse(row.value) : null; } catch { return null; }
}
const setState = (DB, key, value) => DB.prepare('INSERT OR REPLACE INTO past_photos_state (key, value) VALUES (?, ?)').bind(key, JSON.stringify(value)).run();

// ── Pure rules ────────────────────────────────────────────────────────

/** A photo by its type, or by its name when Drive calls it a plain file (HEIC, camera RAW) */
const PHOTO_EXT = /\.(jpe?g|png|heic|heif|gif|webp|tiff?|bmp|dng|arw|cr2|cr3|nef|orf|raf|rw2)$/i;
export const isPhoto = (f) => f.mimeType !== FOLDER && (/^image\//.test(f.mimeType || '') || PHOTO_EXT.test(f.name || ''));

const STAGE_WORDS = [
  ['Before', /\b(before|home ?visits?|existing|pre[- ]?build)\b/i],
  ['During', /\b(demo|demolition|progress|construction|build|during|install)\b/i],
  ['After', /\b(reveal|after|finished|final|professional)\b/i],
];

/**
 * The photo's stage and how it was decided, or { stage: null }: its folders' names first (the nearest that says),
 * then the day it was taken (Eastern) on or after the reveal day → After. A job closed on Dec 31 for want of a reveal
 * date goes by folders only.
 */
export function stageFor({ path = '', takenAt = null }, { closeOn = null, closeHow = '' } = {}) {
  const parts = String(path).split('/').filter(Boolean).reverse();
  for (const part of parts) {
    for (const [stage, re] of STAGE_WORDS) if (re.test(part)) return { stage, how: `folder “${part}”` };
  }
  const reliable = closeOn && !/Dec 31 of the year/.test(String(closeHow || ''));
  const day = takenAt ? easternParts(takenAt)?.date : null;
  if (reliable && day && day >= closeOn) return { stage: 'After', how: `taken ${day}, on or after reveal day ${closeOn}` };
  return { stage: null, how: day ? `taken ${day}, before reveal day: nothing says which stage` : 'no folder or date says' };
}

// ── The short link JobTread fetches ───────────────────────────────────

async function hmacHex(key, message) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(message)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}
// The key is worked out from the Google service account's own key, so there's no new secret to keep
const linkKey = async (env) => {
  const k = String(env?.GOOGLE_CALENDAR_KEY || '').trim();
  return k ? hmacHex(k, 'soard-site drive file link v1') : null;
};

/** The link's query for one Drive file: { d, e, s } (file id, expiry in ms, signature) */
export async function signDriveLink(env, fileId, now = Date.now()) {
  const key = await linkKey(env);
  if (!key) return null;
  const q = { d: String(fileId), e: String(now + LINK_TTL_MS) };
  return { ...q, s: await hmacHex(key, `${q.d}.${q.e}`) };
}

/** A link's query, checked: signed with this site's key and not yet expired */
export async function checkDriveLink(env, { d, e, s } = {}, now = Date.now()) {
  if (![d, e, s].every((x) => typeof x === 'string' && x) || !/^[A-Za-z0-9_-]{10,200}$/.test(d) || !/^\d+$/.test(e) || Number(e) < now) return false;
  const key = await linkKey(env);
  if (!key) return false;
  const want = await hmacHex(key, `${d}.${e}`);
  if (want.length !== s.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ s.charCodeAt(i);
  return diff === 0;
}

// ── Drive ─────────────────────────────────────────────────────────────

export const driveToken = (env, { fetchImpl = fetch, now = Date.now() } = {}) => accessToken(env, READER, { fetchImpl, now, scope: DRIVE_READ_SCOPE });

async function drive(token, path, fetchImpl) {
  const res = await fetchImpl(`${DRIVE}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Google Drive answered ${res.status}: ${body?.error?.message || ''}`.trim());
  return body;
}
const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const inDrive = `&corpora=drive&driveId=${PHOTOS_DRIVE}&includeItemsFromAllDrives=true&supportsAllDrives=true`;

/** A folder's children by name: the holding folder at the top of the drive, a project's folder inside it */
async function childFolder(token, parentId, name, fetchImpl) {
  const query = encodeURIComponent(`${q(parentId)} in parents and name = ${q(name)} and mimeType = '${FOLDER}' and trashed = false`);
  const r = await drive(token, `/files?q=${query}&fields=files(id,name)&pageSize=10${inDrive}`, fetchImpl);
  const f = r.files || [];
  if (f.length > 1) throw new Error(`two folders named “${name}”`);
  return f[0] || null;
}

/** Every file under a folder, with its path below it: [{ id, name, mimeType, size, takenAt, path }] */
export async function listTree(token, folderId, fetchImpl = fetch) {
  const out = [];
  const queue = [{ id: folderId, path: '' }];
  while (queue.length) {
    const dir = queue.shift();
    let page = null;
    do {
      const query = encodeURIComponent(`${q(dir.id)} in parents and trashed = false`);
      const r = await drive(token, `/files?q=${query}&pageSize=1000&fields=nextPageToken,files(id,name,mimeType,size,createdTime,imageMediaMetadata(time))${inDrive}${page ? `&pageToken=${page}` : ''}`, fetchImpl);
      for (const f of r.files || []) {
        if (f.mimeType === FOLDER) queue.push({ id: f.id, path: dir.path ? `${dir.path}/${f.name}` : f.name });
        else out.push({ id: f.id, name: f.name, mimeType: f.mimeType, size: Number(f.size) || null, takenAt: exifTime(f.imageMediaMetadata?.time), path: dir.path });
      }
      page = r.nextPageToken || null;
    } while (page);
  }
  return out;
}
/** Drive's "2014:07:12 15:03:22" (camera time, no zone) as an ISO time read as Eastern; null when it isn't one */
function exifTime(t) {
  const m = String(t || '').match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m || Number(m[1]) < 2005) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00-05:00`;
}

// ── Listing and copying ───────────────────────────────────────────────

/** The next made past job whose folder hasn't been listed, listed into past_photos → { key, photos, skipped } or null */
export async function listNext(env, { scope, fetchImpl = fetch, now = Date.now() } = {}) {
  const { DB } = env;
  const where = scope?.key ? 'AND key = ?' : '';
  const row = await DB.prepare(`SELECT * FROM past_jobs WHERE state = 'made' AND job_id IS NOT NULL AND folder IS NOT NULL AND folder <> ''
      AND photos_listed_at IS NULL ${where} ORDER BY close_on, name LIMIT 1`).bind(...(scope?.key ? [scope.key] : [])).first();
  if (!row) return null;
  const token = await driveToken(env, { fetchImpl, now });
  const holding = await childFolder(token, PHOTOS_DRIVE, HOLDING, fetchImpl);
  if (!holding) throw new Error(`no “${HOLDING}” folder in Photos & Video`);
  const folder = await childFolder(token, holding.id, row.folder, fetchImpl);
  if (!folder) {
    await DB.prepare('UPDATE past_jobs SET photos_listed_at = ?, photos_note = ? WHERE key = ?').bind(iso(now), `no folder “${row.folder}” in ${HOLDING}`, row.key).run();
    return { key: row.key, photos: 0, skipped: 0, note: 'no folder' };
  }
  const files = await listTree(token, folder.id, fetchImpl);
  const photos = files.filter(isPhoto);
  const stmts = photos.map((f) => {
    const big = f.size && f.size > MAX_BYTES;
    const { stage, how } = stageFor(f, { closeOn: row.close_on, closeHow: row.close_how });
    return DB.prepare(`INSERT OR IGNORE INTO past_photos (drive_id, key, job_id, name, path, size, taken_at, stage, stage_how, state, error, listed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(f.id, row.key, row.job_id, f.name, f.path || null, f.size, f.takenAt, stage, how, big ? 'skipped' : 'listed', big ? 'over JobTread’s 100 MB' : null, iso(now));
  });
  for (let i = 0; i < stmts.length; i += 50) await DB.batch(stmts.slice(i, i + 50));
  const others = files.length - photos.length;
  await DB.prepare('UPDATE past_jobs SET photos_listed_at = ?, photos_note = ? WHERE key = ?')
    .bind(iso(now), `${photos.length} photos${others ? `; ${others} other files (videos, papers) left for their own steps` : ''}`, row.key).run();
  return { key: row.key, photos: photos.length, others };
}

/** A file JobTread already holds on the job by that exact name (a copy whose answer never came back) */
async function fileOnJob(grant, jobId, name, fetchImpl) {
  const body = await pave(grant, { job: { $: { id: jobId }, files: { $: { size: 2, where: ['name', '=', name] }, nodes: { id: {} } } } }, fetchImpl);
  return body?.job?.files?.nodes?.[0]?.id || null;
}

/** One photo onto its job: JobTread fetches it from the signed link, then it's filed with its stage tag */
async function copyOne(env, p, { tags, fetchImpl, now }) {
  const grant = env.JOBTREAD_GRANT_KEY;
  if (p.attempts > 0) {
    const found = await fileOnJob(grant, p.job_id, p.name, fetchImpl);
    if (found) return found;
  }
  const link = await signDriveLink(env, p.drive_id, now);
  if (!link) throw new Error('GOOGLE_CALENDAR_KEY is not set, so there is no link to sign');
  const url = `${SITE}/api/drive-file?${new URLSearchParams(link)}`;
  const up = await pave(grant, { createUploadRequest: { $: { organizationId: SOARD_ORG_ID, url }, createdUploadRequest: { id: {} } } }, fetchImpl);
  const uploadRequestId = up?.createUploadRequest?.createdUploadRequest?.id;
  if (!uploadRequestId) throw new Error('JobTread didn’t take the file');
  const tagId = p.stage ? tags.get(p.stage) : null;
  const made = await pave(grant, { createFile: { $: { name: p.name, targetType: 'job', targetId: p.job_id, uploadRequestId, ...(tagId ? { fileTagIds: [tagId] } : {}) }, createdFile: { id: {} } } }, fetchImpl);
  const id = made?.createFile?.createdFile?.id;
  if (!id) throw new Error('JobTread didn’t make the file');
  return id;
}

/** Copies listed photos, oldest project first, until the time is up → { copied, failed } */
export async function copySome(env, { scope, fetchImpl = fetch, now = Date.now(), until = Date.now() + COPY_MS } = {}) {
  const { DB } = env;
  const tags = await tagIds(DB);
  const where = scope?.key ? 'AND p.key = ?' : '';
  const { results } = await DB.prepare(`SELECT p.* FROM past_photos p JOIN past_jobs j ON j.key = p.key WHERE p.state = 'listed' ${where}
      AND (p.claimed_at IS NULL OR p.claimed_at < ?) ORDER BY j.close_on, p.key, p.path, p.name LIMIT 40`)
    .bind(...(scope?.key ? [scope.key] : []), iso(now - 10 * 60 * 1000)).all();
  const out = { copied: 0, failed: 0 };
  const one = async (p) => {
    const claim = await DB.prepare("UPDATE past_photos SET claimed_at = ? WHERE drive_id = ? AND state = 'listed' AND (claimed_at IS NULL OR claimed_at < ?)")
      .bind(iso(now), p.drive_id, iso(now - 10 * 60 * 1000)).run();
    if (!claim?.meta?.changes) return;
    try {
      const id = await copyOne(env, p, { tags, fetchImpl, now });
      await DB.prepare("UPDATE past_photos SET state = 'copied', jt_file_id = ?, copied_at = ?, error = NULL, claimed_at = NULL WHERE drive_id = ?").bind(id, iso(Date.now()), p.drive_id).run();
      out.copied++;
    } catch (e) {
      const attempts = (p.attempts || 0) + 1;
      await DB.prepare('UPDATE past_photos SET attempts = ?, error = ?, state = ?, claimed_at = NULL WHERE drive_id = ?')
        .bind(attempts, String(e.message || e).slice(0, 300), attempts >= 3 ? 'failed' : 'listed', p.drive_id).run();
      out.failed++;
    }
  };
  // A few at once (JobTread fetches each from the link while its call waits, about 2 seconds a photo), never past the time
  const list = results || [];
  for (let i = 0; i < list.length && Date.now() <= until; i += AT_ONCE) await Promise.all(list.slice(i, i + AT_ONCE).map(one));
  return out;
}

/**
 * On the heartbeat, once a founder has turned it on: one folder listed, or photos copied, within the heartbeat's time.
 * Scope 'first' (the first past job only) until a founder turns on every job.
 */
// deadline is on the real clock (the heartbeat's), whatever `now` says
export async function maybeRunPastPhotos(env, { fetchImpl = fetch, now = Date.now(), deadline = Date.now() + COPY_MS + 2000 } = {}) {
  const { DB } = env;
  if (!DB || !env.JOBTREAD_GRANT_KEY) return null;
  try {
    await ensurePastPhotos(DB);
    const on = await getState(DB, 'on');
    if (!on?.scope) return null;
    const next = String(now + TURN_MS);
    const ins = await DB.prepare("INSERT OR IGNORE INTO past_photos_state (key, value) VALUES ('turn', ?)").bind(next).run();
    if (!ins?.meta?.changes) {
      const upd = await DB.prepare("UPDATE past_photos_state SET value = ? WHERE key = 'turn' AND CAST(value AS INTEGER) <= ?").bind(next, now).run();
      if (!upd?.meta?.changes) return null;
    }
    const scope = on.scope === 'first' ? { key: on.key } : null;
    const listed = await listNext(env, { scope, fetchImpl, now });
    const copied = listed ? { copied: 0, failed: 0 } : await copySome(env, { scope, fetchImpl, now, until: Math.min(deadline - 2000, Date.now() + COPY_MS) });
    const run = { at: iso(now), listed: listed ? `${listed.key}: ${listed.photos}` : null, ...copied };
    await setState(DB, 'lastRun', run);
    return run;
  } catch (e) {
    try { await setState(DB, 'lastError', { at: iso(now), error: String(e.message || e).slice(0, 300) }); } catch { /* nothing more to do */ }
    return { error: e.message };
  }
}

/** Founders turn it on: 'first' (the first past job's photos alone), 'all', or 'off' */
export async function setPhotosScope(DB, scope, { by = null, now = Date.now() } = {}) {
  await ensurePastPhotos(DB);
  if (scope === 'off') { await setState(DB, 'on', { scope: null, at: iso(now), by }); return { ok: true }; }
  const first = await DB.prepare("SELECT value FROM past_jobs_state WHERE key = 'first'").first();
  const firstKey = first ? JSON.parse(first.value)?.key : null;
  if (scope === 'first') {
    if (!firstKey) return { ok: false, error: 'Make the first job first.' };
    await setState(DB, 'on', { scope: 'first', key: firstKey, at: iso(now), by });
    return { ok: true };
  }
  if (scope === 'all') {
    const done = await DB.prepare("SELECT count(*) AS n FROM past_photos WHERE key = ? AND state = 'copied'").bind(firstKey || '').first();
    if (!done?.n) return { ok: false, error: 'Copy the first job’s photos and check them first.' };
    await setState(DB, 'on', { scope: 'all', at: iso(now), by });
    return { ok: true };
  }
  return { ok: false, error: 'first, all or off?' };
}

/** For the admin and Automations: photo counts by state, per job and in all, and the last run */
export async function photosStatus(DB) {
  await ensurePastPhotos(DB);
  const { results } = await DB.prepare('SELECT state, count(*) AS n FROM past_photos GROUP BY state').all();
  const by = Object.fromEntries((results || []).map((r) => [r.state, r.n]));
  const stages = Object.fromEntries(((await DB.prepare("SELECT coalesce(stage, 'none') AS s, count(*) AS n FROM past_photos GROUP BY s").all()).results || []).map((r) => [r.s, r.n]));
  const listed = await DB.prepare("SELECT count(*) AS n FROM past_jobs WHERE photos_listed_at IS NOT NULL").first();
  const toList = await DB.prepare("SELECT count(*) AS n FROM past_jobs WHERE state = 'made' AND folder IS NOT NULL AND folder <> '' AND photos_listed_at IS NULL").first();
  const failed = (await DB.prepare("SELECT key, name, error FROM past_photos WHERE state = 'failed' ORDER BY key LIMIT 5").all()).results || [];
  // The newest copied, with the stage each was given (to set beside JobTread's own view of the same files)
  const newest = (await DB.prepare("SELECT key, name, stage, stage_how, copied_at FROM past_photos WHERE state = 'copied' ORDER BY copied_at DESC LIMIT 6").all()).results || [];
  const [on, lastRun, lastError] = await Promise.all([getState(DB, 'on'), getState(DB, 'lastRun'), getState(DB, 'lastError')]);
  return { by, stages, jobsListed: listed?.n || 0, jobsToList: toList?.n || 0, failed, newest, on, lastRun, lastError, today: todayEastern() };
}

/**
 * Who JobTread would tell about each photo (read only): every role's and member's "Jobs: File Uploaded" subscription,
 * and custom notifications on new files → { subscribed: ['Role: Admin (email)'…], custom: [names] } or { error }
 */
export async function uploadNotices(grant, fetchImpl = fetch) {
  try {
    // Only "Jobs: File Uploaded" (all of every list at once is more than JobTread answers)
    const subs = { $: { size: 5, where: ['notificationType', '=', 'jobFileCreated'] }, nodes: { notificationType: {}, viaEmail: {}, viaPushNotification: {}, condition: {} } };
    const body = await pave(grant, { organization: { $: { id: SOARD_ORG_ID },
      roles: { $: { size: 50 }, nodes: { name: {}, notificationSubscriptions: subs } },
      memberships: { $: { size: 50 }, nodes: { user: { name: {} }, useRoleNotificationSubscriptions: {}, notificationSubscriptions: subs } },
    } }, fetchImpl);
    const org = body?.organization;
    const fileSubs = (list) => (list?.nodes || []).filter((n) => n.notificationType === 'jobFileCreated' && (n.viaEmail || n.viaPushNotification));
    const how = (n) => [n.viaEmail ? 'email' : null, n.viaPushNotification ? 'push' : null].filter(Boolean).join(' and ') + (n.condition ? `, ${n.condition}` : '');
    const subscribed = [
      ...(org?.roles?.nodes || []).flatMap((r) => fileSubs(r.notificationSubscriptions).map((n) => `Role ${r.name} (${how(n)})`)),
      ...(org?.memberships?.nodes || []).filter((m) => !m.useRoleNotificationSubscriptions).flatMap((m) => fileSubs(m.notificationSubscriptions).map((n) => `${m.user?.name || 'Someone'} (${how(n)})`)),
    ];
    return { subscribed };
  } catch (e) {
    return { error: String(e.message || e).slice(0, 200) };
  }
}
