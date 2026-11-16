/**
 * Backblaze B2, the backup's second home: a bucket with Object Lock on, so for its lock period no file in it can
 * be changed or deleted by anyone, SOARD and Backblaze included. The key the backup has (B2_KEY_ID and
 * B2_APPLICATION_KEY) is limited to that one bucket and can't delete: it adds files and reads them back.
 *
 * Backblaze's native API, version 4 (the one its documentation describes field by field). Every upload carries its
 * SHA-1 and Backblaze refuses bytes that don't match it (whole files, and each part of a large one). A large file is sent in parts that are listed back before each send, so a step cut off part way
 * carries on from the last part Backblaze has.
 */

const AUTH = 'https://api.backblazeb2.com/b2api/v4/b2_authorize_account';
const PASSING = new Set([408, 429, 500, 502, 503, 504]);

export class B2Error extends Error {
  constructor(message, status, code) { super(message); this.name = 'B2Error'; this.status = status; this.code = code; }
}

const encName = (name) => name.split('/').map(encodeURIComponent).join('/');

/** A signed-in client for the one bucket the key may use */
export async function b2Client(env, { fetchImpl = fetch, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  if (!env.B2_KEY_ID || !env.B2_APPLICATION_KEY) throw new B2Error('Backblaze isn’t set up yet (B2_KEY_ID and B2_APPLICATION_KEY)', 0, 'not_set');
  // Backblaze says any call can answer 503 and should be asked again: one busy moment isn't a home down
  let res;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetchImpl(AUTH, { headers: { Authorization: `Basic ${btoa(`${env.B2_KEY_ID}:${env.B2_APPLICATION_KEY}`)}` } });
      if (!PASSING.has(res.status) || attempt >= 3) break;
    } catch (e) { if (attempt >= 3) throw e; }
    await wait(1000 * 2 ** attempt);
  }
  const auth = await res.json().catch(() => null);
  if (!res.ok) throw new B2Error(`Backblaze sign-in ${res.status}: ${auth?.message || res.statusText}`, res.status, auth?.code);
  const api = auth.apiInfo?.storageApi || {};
  const allowed = api.allowed || {};
  const buckets = allowed.buckets || [];
  const bucket = buckets.find((b) => !env.B2_BUCKET || b.name === env.B2_BUCKET) || null;
  if (!bucket?.id) throw new B2Error('The Backblaze key isn’t limited to one bucket (make the key for the backup bucket only)', 0, 'no_bucket');
  const caps = new Set(allowed.capabilities || []);
  const call = async (name, body, { retry = true } = {}) => {
    for (let attempt = 0; ; attempt++) {
      const r = await fetchImpl(`${api.apiUrl}/b2api/v4/${name}`, { method: 'POST', headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await r.json().catch(() => null);
      if (r.ok) return data;
      if (retry && PASSING.has(r.status) && attempt < 4) { await wait(1000 * 2 ** attempt); continue; }
      throw new B2Error(`Backblaze ${name} ${r.status}: ${data?.message || r.statusText}`.slice(0, 300), r.status, data?.code);
    }
  };
  // An upload address is good until it fails; a failed send gets a new one (Backblaze's own advice)
  // `already()` (for a whole file) looks before each re-send: a send whose answer was lost may have been kept, and
  // a locked bucket would keep a second one for the whole lock
  const send = async (getUrl, headers, body, already = null) => {
    for (let attempt = 0; ; attempt++) {
      if (attempt > 0 && already) { const had = await already(); if (had) return had; }
      const target = await getUrl();
      let r;
      try {
        // A send is at most 16 MiB: ten minutes is ample, and a stalled one ends instead of holding the step
        r = await fetchImpl(target.uploadUrl, { method: 'POST', headers: { Authorization: target.authorizationToken, ...headers }, body, signal: AbortSignal.timeout(10 * 60_000) });
      } catch (e) {
        if (attempt < 4) { await wait(1000 * 2 ** attempt); continue; }
        throw e;
      }
      const data = await r.json().catch(() => null);
      if (r.ok) return data;
      if ((PASSING.has(r.status) || r.status === 401) && attempt < 4) { await wait(1000 * 2 ** attempt); continue; }
      throw new B2Error(`Backblaze upload ${r.status}: ${data?.message || r.statusText}`.slice(0, 300), r.status, data?.code);
    }
  };
  const findFile = async (name, sha1) => {
    const data = await call('b2_list_file_versions', { bucketId: bucket.id, startFileName: name, prefix: name, maxFileCount: 20 });
    return (data.files || []).find((f) => f.fileName === name && f.action === 'upload' && (f.contentSha1 === sha1 || f.fileInfo?.large_file_sha1 === sha1)) || null;
  };
  return {
    bucket,
    capabilities: caps,
    /** The bucket's lock: { on, mode, days } (mode 'compliance' means nobody at all can delete in that time) */
    async lock() {
      const data = await call('b2_list_buckets', { accountId: auth.accountId, bucketId: bucket.id });
      const b = data.buckets?.[0];
      const v = b?.fileLockConfiguration?.value;
      const p = v?.defaultRetention?.period;
      const days = p ? (p.unit === 'years' ? p.duration * 365 : p.duration) : 0;
      return { on: !!v?.isFileLockEnabled, mode: v?.defaultRetention?.mode || null, days, versioned: true };
    },
    /** The newest version of `name` with this SHA-1, if it's already there (so a retried upload isn't kept twice) */
    find: (name, sha1) => findFile(name, sha1),
    /** A whole file in one request (Backblaze checks it against `sha1`) */
    async upload(name, bytes, { sha1, type = 'application/octet-stream', info = {} }) {
      const headers = { 'X-Bz-File-Name': encName(name), 'Content-Type': type, 'Content-Length': String(bytes.length), 'X-Bz-Content-Sha1': sha1 };
      for (const [k, v] of Object.entries(info)) headers[`X-Bz-Info-${k}`] = encodeURIComponent(v);
      const got = await send(() => call('b2_get_upload_url', { bucketId: bucket.id }), headers, bytes, () => findFile(name, sha1));
      if (got.contentSha1 !== sha1 || Number(got.contentLength) !== bytes.length) throw new B2Error(`Backblaze kept something other than what was sent for ${name}`, 200, 'mismatch');
      return got;
    },
    startLarge: (name, { sha1, type = 'application/octet-stream' }) => call('b2_start_large_file', { bucketId: bucket.id, fileName: name, contentType: type, fileInfo: { large_file_sha1: sha1 } }),
    async parts(fileId) {
      const out = [];
      let start = 1;
      for (;;) {
        const data = await call('b2_list_parts', { fileId, startPartNumber: start, maxPartCount: 1000 });
        out.push(...(data.parts || []));
        if (!data.nextPartNumber) return out;
        start = data.nextPartNumber;
      }
    },
    sendPart: (fileId, number, bytes, sha1) => send(() => call('b2_get_upload_part_url', { fileId }), { 'X-Bz-Part-Number': String(number), 'Content-Length': String(bytes.length), 'X-Bz-Content-Sha1': sha1 }, bytes),
    finishLarge: (fileId, sha1s) => call('b2_finish_large_file', { fileId, partSha1Array: sha1s }),
    /** Reads a file back (the restore drill) */
    async download(fileId) {
      const r = await fetchImpl(`${api.downloadUrl}/b2api/v4/b2_download_file_by_id?fileId=${encodeURIComponent(fileId)}`, { headers: { Authorization: auth.authorizationToken } });
      if (!r.ok) throw new B2Error(`Backblaze download ${r.status}`, r.status, 'download');
      return r;
    },
  };
}
