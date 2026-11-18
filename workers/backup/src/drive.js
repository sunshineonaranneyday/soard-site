/**
 * Google Drive, the backup's first home: one shared drive ("Website backup") where the backup's own Google
 * service account (GOOGLE_BACKUP_KEY) is a Contributor. It acts as itself, with no domain-wide delegation, so it
 * reaches nothing but that drive, and as a Contributor it can add files and folders there but never move, trash
 * or delete one (Google's rule for the role).
 *
 * Uploads are resumable (Google's upload sessions): a session is opened and saved first, then filled in pieces,
 * so a step cut off part way picks up from the last byte Google has, and nothing is uploaded twice. Google
 * works out an MD5 of every file it keeps; each upload is checked against ours.
 */
import { createHash } from 'node:crypto';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
export const FOLDER = 'application/vnd.google-apps.folder';
// Every piece but the last must be a whole number of 256 KiB (Google's rule)
export const QUANTUM = 256 * 1024;

/** The backup's Google service account key, as pasted (the downloaded .json file) */
export function serviceAccount(env) {
  const raw = env.GOOGLE_BACKUP_KEY;
  if (!raw) return null;
  let key;
  try { key = JSON.parse(String(raw).trim()); } catch { throw new DriveError('GOOGLE_BACKUP_KEY isn’t the downloaded .json key file (paste the whole file, as it is)', 0, 'bad_key'); }
  if (typeof key === 'string') { try { key = JSON.parse(key); } catch { /* checked below */ } }
  if (!key?.client_email || !key?.private_key) throw new DriveError('GOOGLE_BACKUP_KEY is missing client_email or private_key (paste the whole .json file)', 0, 'bad_key');
  return key;
}

/** The address to add to the shared drive as a Contributor */
export function backupAccount(env) {
  try { return serviceAccount(env)?.client_email || null; } catch { return null; }
}

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlText = (text) => b64url(new TextEncoder().encode(text));
let cached = null;

/** A Drive token as the service account itself (no `sub`: no delegation) */
export async function driveToken(env, { fetchImpl = fetch, now = Date.now() } = {}) {
  // Good for the longest step (30 minutes) from the moment it's handed out
  if (cached && cached.email === backupAccount(env) && cached.expiresAt - 35 * 60_000 > now) return cached.token;
  const key = serviceAccount(env);
  if (!key) throw new DriveError('Google isn’t set up yet (GOOGLE_BACKUP_KEY)', 0, 'not_set');
  const iat = Math.floor(now / 1000);
  const unsigned = `${b64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64urlText(JSON.stringify({ iss: key.client_email, scope: DRIVE_SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 }))}`;
  const der = Uint8Array.from(atob(key.private_key.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0));
  const signing = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signing, new TextEncoder().encode(unsigned));
  // One busy moment at Google isn't a home down: asked again, a little later each time
  let res;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetchImpl(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(sig)}` }) });
      if (!(res.status === 408 || res.status === 429 || res.status >= 500) || attempt >= 3) break;
    } catch (e) { if (attempt >= 3) throw e; }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new DriveError(`Google sign-in failed (${res.status}): ${body.error || ''} ${body.error_description || ''}`.trim(), res.status, 'sign_in');
  cached = { email: key.client_email, token: body.access_token, expiresAt: now + (body.expires_in || 3600) * 1000 };
  return body.access_token;
}

export class DriveError extends Error {
  constructor(message, status, reason) { super(message); this.status = status; this.reason = reason; }
}

const PASSING = new Set([429, 500, 502, 503, 504]);
const WAITS = [400, 1500];

/** A JSON call to Drive; reads and creates of folders are asked again when Google is briefly busy */
async function call(token, method, url, { body, fetchImpl = fetch, retry = method === 'GET' } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (res.ok) return data;
    if (retry && PASSING.has(res.status) && attempt < WAITS.length) { await new Promise((r) => setTimeout(r, WAITS[attempt])); continue; }
    const err = data?.error;
    throw new DriveError(`Google Drive ${res.status}: ${err?.message || res.statusText || 'no answer'}`.slice(0, 300), res.status, err?.errors?.[0]?.reason || err?.status || null);
  }
}

/** The shared drives the site is a member of, and what it may do in each */
export async function listDrives(token, { fetchImpl = fetch } = {}) {
  const out = [];
  let pageToken = '';
  do {
    const q = new URLSearchParams({ pageSize: '100', fields: 'nextPageToken,drives(id,name,capabilities(canAddChildren,canTrashChildren,canDeleteChildren))' });
    if (pageToken) q.set('pageToken', pageToken);
    const data = await call(token, 'GET', `${API}/drives?${q}`, { fetchImpl });
    out.push(...(data?.drives || []));
    pageToken = data?.nextPageToken || '';
  } while (pageToken);
  return out;
}

/** Which shared drive to use: one with "backup" in its name, or the only one there is */
export function pickDrive(drives) {
  const named = drives.filter((d) => /back\s*-?\s*up/i.test(d.name || ''));
  if (named.length === 1) return named[0];
  if (!named.length && drives.length === 1) return drives[0];
  return null;
}

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** A file or folder named `name` directly in `parentId`, if there is one (`newest`: the most recently changed of several) */
export async function findChild(token, driveId, parentId, name, { folder = false, newest = false, fetchImpl = fetch } = {}) {
  const q = new URLSearchParams({
    q: `name = '${esc(name)}' and '${esc(parentId)}' in parents and trashed = false${folder ? ` and mimeType = '${FOLDER}'` : ''}`,
    corpora: 'drive', driveId, includeItemsFromAllDrives: 'true', supportsAllDrives: 'true', pageSize: '10', fields: 'files(id,name,size,modifiedTime)',
    ...(newest ? { orderBy: 'modifiedTime desc' } : {}),
  });
  const data = await call(token, 'GET', `${API}/files?${q}`, { fetchImpl });
  return data?.files?.[0] || null;
}

export async function createFolder(token, parentId, name, { fetchImpl = fetch } = {}) {
  const data = await call(token, 'POST', `${API}/files?supportsAllDrives=true&fields=id`, { body: { name, mimeType: FOLDER, parents: [parentId] }, fetchImpl });
  return data.id;
}

/**
 * Opens an upload session for a new file; returns its address, which is good for a week.
 * `size` may be left out when it isn't known yet (the code zip): the last piece says it.
 */
export async function startUpload(token, { name, parentId, mimeType = 'application/octet-stream', description, size, fetchImpl = fetch }) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mimeType };
  if (Number.isFinite(size)) headers['X-Upload-Content-Length'] = String(size);
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(`${UPLOAD}?uploadType=resumable&supportsAllDrives=true&fields=id,size,md5Checksum`, {
      method: 'POST', headers, body: JSON.stringify({ name, parents: [parentId], mimeType, ...(description ? { description: description.slice(0, 4000) } : {}) }),
    });
    const location = res.headers.get('location');
    if (res.ok && location) return location;
    if (PASSING.has(res.status) && attempt < WAITS.length) { await new Promise((r) => setTimeout(r, WAITS[attempt])); continue; }
    const data = await res.json().catch(() => null);
    throw new DriveError(`Google Drive ${res.status} opening an upload: ${data?.error?.message || res.statusText || 'no session address'}`.slice(0, 300), res.status, data?.error?.errors?.[0]?.reason || null);
  }
}

/** What Google answered about a session: done (with the file's id, size and Google's MD5 of what it kept), or how many bytes it has */
async function sessionAnswer(res) {
  if (res.status === 200 || res.status === 201) {
    const data = await res.json().catch(() => null);
    return { done: true, id: data?.id || null, size: data?.size != null ? Number(data.size) : null, md5: data?.md5Checksum || null };
  }
  if (res.status === 308) {
    const range = res.headers.get('range');
    const m = /bytes=0-(\d+)/.exec(range || '');
    return { done: false, received: m ? Number(m[1]) + 1 : 0 };
  }
  if (res.status === 404 || res.status === 410) throw new DriveError('The upload session has expired', res.status, 'expired');
  const data = await res.json().catch(() => null);
  throw new DriveError(`Google Drive ${res.status} during an upload: ${data?.error?.message || res.statusText || 'no answer'}`.slice(0, 300), res.status, data?.error?.errors?.[0]?.reason || null);
}

/** Where a session stands, without sending anything */
export async function uploadStatus(session, { total = null, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(session, { method: 'PUT', headers: { 'Content-Range': `bytes */${total ?? '*'}` }, body: new Uint8Array(0) });
  return sessionAnswer(res);
}

/**
 * Sends one piece: `body` is bytes, or a stream of exactly `length` bytes. `total` is the file's size, or null
 * while it isn't known. Returns sessionAnswer's shape.
 */
export async function sendPiece(session, body, { start, length, total = null, fetchImpl = fetch }) {
  if (!length) return uploadStatus(session, { total: total ?? start, fetchImpl });
  const res = await fetchImpl(session, {
    method: 'PUT',
    // A piece is at most 16 MiB: ten minutes is ample, and a stalled send ends instead of holding the step
    signal: AbortSignal.timeout(PIECE_MS),
    headers: { 'Content-Range': `bytes ${start}-${start + length - 1}/${total ?? '*'}` },
    body: await sized(body, length),
    ...(body instanceof ReadableStream && typeof FixedLengthStream !== 'function' ? { duplex: 'half' } : {}),
  });
  return sessionAnswer(res);
}

/** A stream sent with its length (Workers needs a FixedLengthStream for that); bytes go as they are */
async function sized(body, length) {
  if (!(body instanceof ReadableStream)) return body;
  if (typeof FixedLengthStream === 'function') {
    const fixed = new FixedLengthStream(length);
    body.pipeTo(fixed.writable).catch(() => {});
    return fixed.readable;
  }
  return new Uint8Array(await new Response(body).arrayBuffer()); // Node (tests)
}

export const md5Hex = (bytes) => createHash('md5').update(bytes).digest('hex');

const PIECE_MS = 10 * 60_000;

/**
 * Google's copy is exactly what was sent: the file it names, its size and its MD5 (Google works one out for every
 * file it keeps). When its answer leaves any of them out, Google is asked for the file's own. Throws unless all
 * match; returns { id, size, md5 }.
 */
export async function confirmCopy(token, r, { size, md5, name = 'the file', fetchImpl = fetch }) {
  if (!r?.id) throw new DriveError(`Google didn’t say which file it kept for ${name}`, 200, 'unconfirmed');
  let got = { id: r.id, size: r.size ?? null, md5: r.md5 ?? null };
  if (got.size == null || !got.md5) {
    const info = await fileInfo(token, r.id, { fetchImpl });
    got = { id: r.id, size: info?.size != null ? Number(info.size) : null, md5: info?.md5Checksum || null };
  }
  if (got.size == null || !got.md5) throw new DriveError(`Google gave no size or MD5 for ${name}, so it can’t be confirmed`, 200, 'unconfirmed');
  if (got.size !== size) throw new DriveError(`Google kept ${got.size} bytes of ${name}, not ${size}`, 200, 'mismatch');
  if (got.md5 !== md5) throw new DriveError(`Google's copy of ${name} doesn't match what was sent (MD5 ${got.md5}, not ${md5})`, 200, 'mismatch');
  return got;
}

/** A small file in one go, through a session like the rest, checked against Google's MD5 (returns its id) */
export async function uploadSmall(token, { name, parentId, mimeType, description, bytes, fetchImpl = fetch }) {
  const session = await startUpload(token, { name, parentId, mimeType, description, size: bytes.length, fetchImpl });
  const r = await sendPiece(session, bytes, { start: 0, length: bytes.length, total: bytes.length, fetchImpl });
  if (!r.done) throw new DriveError(`Google Drive kept ${r.received} of ${bytes.length} bytes`, 308, 'incomplete');
  return (await confirmCopy(token, r, { size: bytes.length, md5: md5Hex(bytes), name, fetchImpl })).id;
}

export const folderLink = (id) => `https://drive.google.com/drive/folders/${id}`;

/** A new version of a file the backup made (only the READ ME: Drive keeps the old version, a Contributor may add one) */
export async function replaceContent(token, fileId, bytes, { mimeType = 'text/plain', fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${UPLOAD}/${encodeURIComponent(fileId)}?uploadType=media&supportsAllDrives=true&fields=id,size,md5Checksum`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': mimeType }, body: bytes });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new DriveError(`Google Drive ${res.status} updating a file: ${data?.error?.message || res.statusText}`, res.status, data?.error?.errors?.[0]?.reason || null);
  return (await confirmCopy(token, { id: data?.id || fileId, size: data?.size != null ? Number(data.size) : null, md5: data?.md5Checksum || null }, { size: bytes.length, md5: md5Hex(bytes), name: 'the READ ME', fetchImpl })).id;
}

/** A file's bytes, for the restore drill: the response, with Google's MD5 of what it keeps checked by the caller */
export async function download(token, fileId, { fetchImpl = fetch, range = null } = {}) {
  // (`range`: [first, last] bytes, last included: just those, as the drill reads a large copy a slice at a time)
  const headers = { Authorization: `Bearer ${token}`, ...(range ? { Range: `bytes=${range[0]}-${range[1]}` } : {}) };
  const res = await fetchImpl(`${API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, { headers });
  if (!res.ok) throw new DriveError(`Google Drive ${res.status} reading a file back`, res.status, 'download');
  // A whole file back is only right when it's no more than was asked for (a large one whole is what this avoids)
  const len = res.headers.get('content-length');
  if (range && res.status !== 206 && !(range[0] === 0 && len !== null && Number(len) <= range[1] + 1)) { await res.body?.cancel(); throw new DriveError('Google Drive gave back the whole file, not the part asked for', res.status, 'download'); }
  return res;
}

/** The id of every file in the shared drive that isn't in the trash (the run's look at what Drive still holds) */
export async function listAllIds(token, driveId, { fetchImpl = fetch } = {}) {
  const ids = new Set();
  let pageToken = '';
  do {
    const q = new URLSearchParams({ q: 'trashed = false', corpora: 'drive', driveId, includeItemsFromAllDrives: 'true', supportsAllDrives: 'true', pageSize: '1000', fields: 'nextPageToken,files(id)' });
    if (pageToken) q.set('pageToken', pageToken);
    const data = await call(token, 'GET', `${API}/files?${q}`, { fetchImpl });
    for (const f of data?.files || []) ids.add(f.id);
    pageToken = data?.nextPageToken || '';
  } while (pageToken);
  return ids;
}

/** A file's size and MD5 as Google has them */
export async function fileInfo(token, fileId, { fetchImpl = fetch } = {}) {
  return call(token, 'GET', `${API}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=id,name,size,md5Checksum,trashed,driveId`, { fetchImpl });
}
