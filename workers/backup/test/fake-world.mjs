/**
 * Everything outside Cloudflare that soard-backup talks to, faked for its tests (./worker.test.mjs), strictly:
 *   - Cloudflare's API: D1 (real SQLite behind /raw, a bookmark that moves on every write), Images, Stream,
 *     R2 objects, and the settings it reads
 *   - Google: sign-in, shared drives, folders, resumable uploads (pieces must be whole 256 KiB, start where Google
 *     is, and Google's MD5 is of what it really kept); never a delete or trash
 *   - Backblaze B2: a bucket with Object Lock, uploads checked against their SHA-1, large files in parts; never a delete
 *   - GitHub: real `git upload-pack` over smart HTTP, from a real repo on disk
 *   - Stream's MP4 host: a private video only through a signed link the test's signing key made
 *   - the site's own Stream key (a different key from the backup's): it makes and removes MP4s and signing keys
 * world.calls lists every request, so a test can say what was (or wasn't) asked; world.deletes every delete the
 * backup asked for (there must be none), world.siteDeletes the site's.
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash, createPublicKey, verify as verifySig } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Response } from 'miniflare';

export const ACCT = 'acct0000000000000000000000000000';
export const QUANTUM = 256 * 1024;
const md5 = (b) => createHash('md5').update(b).digest('hex');
const sha1 = (b) => createHash('sha1').update(b).digest('hex');
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const cf = (result, extra = {}) => json({ success: true, errors: [], messages: [], result, ...extra });
const cfError = (status, message) => json({ success: false, errors: [{ code: status, message }], result: null }, status);

export function createWorld({ gitDir, repo, streamPublicJwk, streamPrivateJwk }) {
  const w = {
    calls: [],
    deletes: [],
    siteDeletes: [],
    streamKeys: [],
    keyN: 0,
    dbs: {}, // id → { db: DatabaseSync, bookmark: n }
    images: [], // { id, filename, uploaded, bytes }
    videos: [], // { uid, name, private, bytes, download: 'ready' | null, state: 'ready' | 'inprogress', siteMade }
    buckets: {}, // name → Map(key → { bytes, etag, last_modified })
    drive: { drives: [{ id: 'shared1', name: 'Website backup', capabilities: { canAddChildren: true, canTrashChildren: false, canDeleteChildren: false } }], files: new Map(), sessions: new Map(), n: 0 },
    b2: { bucket: { id: 'bk1', name: 'soard-backup-test' }, lock: { isFileLockEnabled: true, defaultRetention: { mode: 'compliance', period: { duration: 90, unit: 'days' } } }, files: [], large: new Map(), n: 0, caps: ['listBuckets', 'listFiles', 'readFiles', 'writeFiles', 'readBucketRetentions', 'readFileRetentions'] },
    faults: { loseDrivePieces: 0, corruptDriveOnce: false, failB2Parts: 0, writeDuringRead: null },
  };
  w.addDb = (id) => { const db = new DatabaseSync(':memory:'); w.dbs[id] = { db, bookmark: 1 }; return db; };
  // A write the site makes: the database's bookmark moves, as D1's does
  w.write = (id, sql) => { w.dbs[id].db.exec(sql); w.dbs[id].bookmark++; };
  // Every file at `path`, through every folder of each name on the way (a folder in the trash and its new twin)
  w.driveFile = (path, { trashed = false } = {}) => {
    let parents = ['shared1'];
    const parts = path.split('/');
    for (let i = 0; i < parts.length; i++) {
      const kids = [...w.drive.files.values()].filter((f) => parents.includes(f.parents[0]) && f.name === parts[i]);
      if (!kids.length) return null;
      if (i === parts.length - 1) { const live = kids.filter((f) => trashed || !f.trashed); return live.length ? live : null; }
      parents = kids.map((k) => k.id);
    }
    return null;
  };
  w.b2File = (name) => w.b2.files.filter((f) => f.fileName === name);

  const finish = (s) => {
    const bytes = Buffer.concat(s.got);
    const id = `file${++w.drive.n}`;
    const kept = w.faults.corruptDriveOnce ? Buffer.concat([bytes.subarray(0, -1), Buffer.from([bytes[bytes.length - 1] ^ 1])]) : bytes;
    w.faults.corruptDriveOnce = false;
    w.drive.files.set(id, { id, ...s.meta, bytes: kept, mimeType: s.meta.mimeType, modifiedTime: new Date().toISOString() });
    s.done = id;
  };

  w.handle = async (request) => {
    const u = new URL(request.url);
    const method = request.method;
    const auth = request.headers.get('authorization');
    w.calls.push(`${method} ${u.host}${u.pathname}`);
    if (method === 'DELETE' && auth !== 'Bearer site-stream-key') w.deletes.push(request.url);

    // ── Cloudflare ──
    if (u.host === 'api.cloudflare.com' && auth === 'Bearer site-stream-key') {
      // The site's own Stream key: Stream only
      const p = u.pathname.replace(`/client/v4/accounts/${ACCT}`, '');
      let m;
      if (p === '/stream/keys' && method === 'POST') { const id = `kid${++w.keyN}`; w.streamKeys.push(id); return cf({ id, jwk: Buffer.from(JSON.stringify(streamPrivateJwk)).toString('base64'), pem: 'PEM', created: '2026-11-14T00:00:00Z' }); }
      if ((m = /^\/stream\/keys\/([^/]+)$/.exec(p)) && method === 'DELETE') { w.siteDeletes.push(`key ${m[1]}`); w.streamKeys = w.streamKeys.filter((k) => k !== m[1]); return cf(null); }
      if ((m = /^\/stream\/([^/]+)\/downloads$/.exec(p))) {
        const v = w.videos.find((x) => x.uid === m[1]);
        if (!v) return cfError(404, 'no such video');
        if (method === 'POST') { v.download = 'ready'; v.siteMade = true; return cf({ default: { status: 'inprogress', percentComplete: 0 } }); }
        if (method === 'DELETE') { w.siteDeletes.push(`mp4 ${v.uid}`); v.download = null; return cf(null); }
        return cf(v.download ? { default: { status: v.download, url: `https://customer-test.cloudflarestream.com/${v.uid}/downloads/default.mp4`, percentComplete: 100 } } : {});
      }
      return cfError(403, 'the site’s Stream key opens Stream only');
    }
    if (u.host === 'api.cloudflare.com') {
      if (auth !== 'Bearer cf-read-key') return cfError(403, 'Authentication error');
      const p = u.pathname.replace(`/client/v4/accounts/${ACCT}`, '');
      let m;
      if ((m = /^\/d1\/database\/([^/]+)\/time_travel\/bookmark$/.exec(p))) return cf({ bookmark: `bm-${w.dbs[m[1]].bookmark}` });
      if ((m = /^\/d1\/database\/([^/]+)\/raw$/.exec(p))) {
        if (method !== 'POST') return cfError(405, 'no');
        const d = w.dbs[m[1]];
        const body = await request.json();
        const fault = w.faults.writeDuringRead;
        if (fault && fault.db === m[1] && --fault.after === 0) { w.write(m[1], fault.sql); w.faults.writeDuringRead = null; }
        const results = body.batch.map(({ sql, params = [] }) => {
          if (!/^\s*(SELECT|WITH)\b/i.test(sql)) throw new Error(`the backup only ever reads: ${sql.slice(0, 40)}`);
          const rows = d.db.prepare(sql).all(...params);
          return { results: { columns: rows[0] ? Object.keys(rows[0]) : [], rows: rows.map((r) => Object.values(r)) }, success: true, meta: {} };
        });
        return cf(results);
      }
      if (p === '/images/v2') return cf({ images: w.images.map(({ bytes, ...im }) => im), continuation_token: null });
      if ((m = /^\/images\/v1\/([^/]+)\/blob$/.exec(p))) { const im = w.images.find((x) => x.id === decodeURIComponent(m[1])); return im ? new Response(im.bytes, { headers: { 'content-length': String(im.bytes.length) } }) : cfError(404, 'no'); }
      if (p === '/stream' && w.faults.streamListDown) return cfError(403, 'Cloudflare Stream not enabled');
      if (p === '/stream') return cf(w.videos.map((v) => ({ uid: v.uid, size: v.bytes.length, requireSignedURLs: v.private, readyToStream: (v.state || 'ready') === 'ready', status: { state: v.state || 'ready' }, uploaded: '2026-01-01T00:00:00Z', created: '2026-01-01T00:00:00Z', meta: { name: v.name } })));
      if ((m = /^\/stream\/([^/]+)\/downloads$/.exec(p))) {
        if (method !== 'GET') return cfError(403, 'the backup’s key is read only');
        const v = w.videos.find((x) => x.uid === m[1]);
        return cf(v.download ? { default: { status: v.download, url: `https://customer-test.cloudflarestream.com/${v.uid}/downloads/default.mp4`, percentComplete: 100 } } : {});
      }
      if ((m = /^\/r2\/buckets\/([^/]+)\/objects$/.exec(p))) {
        const b = w.buckets[m[1]];
        return cf([...b.entries()].sort().map(([key, o]) => ({ key, size: o.bytes.length, etag: o.etag, last_modified: o.last_modified })), { result_info: { is_truncated: false } });
      }
      if ((m = /^\/r2\/buckets\/([^/]+)\/objects\/(.+)$/.exec(p))) {
        const o = w.buckets[m[1]].get(decodeURIComponent(m[2]));
        return o ? new Response(o.bytes) : cfError(404, 'no such object');
      }
      // The account settings the backup copies (./settings.js): one can be refused on purpose
      if (method === 'GET' && ['/members', '/access/apps', '/access/policies', '/access/groups', '/access/identity_providers', '/pages/projects', '/workers/scripts', '/r2/buckets', '/d1/database'].includes(p)) {
        return w.faults.settingsDenied === p ? cfError(403, 'Authentication error') : cf(p === '/r2/buckets' ? { buckets: [] } : []);
      }
      if (u.pathname === '/client/v4/zones') return cf([{ id: 'zone1', name: 'example.org', status: 'active', plan: { name: 'Free' }, name_servers: ['a.ns', 'b.ns'] }]);
      if (u.pathname === '/client/v4/zones/zone1/dns_records/export') return new Response('example.org. 300 IN A 192.0.2.1\nwww 300 IN CNAME example.org.\n');
      if (u.pathname.startsWith('/client/v4/zones/zone1/')) return cf([]);
      return cfError(403, 'not allowed for this test key');
    }

    // ── Stream's MP4s ──
    if (u.host === 'customer-test.cloudflarestream.com') {
      const id = u.pathname.split('/')[1];
      let v = w.videos.find((x) => x.uid === id && !x.private);
      if (!v && id.includes('.')) {
        const [h, p, s] = id.split('.');
        const claims = JSON.parse(Buffer.from(p, 'base64url'));
        const ok = verifySig('sha256', Buffer.from(`${h}.${p}`), createPublicKey({ key: streamPublicJwk, format: 'jwk' }), Buffer.from(s, 'base64url'));
        if (ok && claims.downloadable === true && claims.exp * 1000 > Date.now() && w.streamKeys.includes(claims.kid)) v = w.videos.find((x) => x.uid === claims.sub);
      }
      return v?.download === 'ready' ? new Response(v.bytes) : new Response('no', { status: 401 });
    }

    // ── Google ──
    if (u.host === 'oauth2.googleapis.com') {
      const assertion = new URLSearchParams(await request.text()).get('assertion');
      const claims = JSON.parse(Buffer.from(assertion.split('.')[1], 'base64url'));
      if (claims.sub !== undefined) throw new Error('the backup acts as its own service account, never as a person');
      if (claims.scope !== 'https://www.googleapis.com/auth/drive') throw new Error(`unexpected scope ${claims.scope}`);
      return json({ access_token: 'g-token', expires_in: 3600 });
    }
    if (u.host === 'www.googleapis.com') {
      const isSession = u.pathname === '/upload/drive/v3/files' && u.searchParams.get('upload_id');
      if (!isSession && auth !== 'Bearer g-token') return json({ error: { message: 'unauthorized' } }, 401);
      if (method === 'DELETE') throw new Error('the backup must never delete in Drive');
      if (u.pathname === '/drive/v3/drives') return json({ drives: w.drive.drives });
      if (u.pathname === '/drive/v3/files' && method === 'GET') {
        const q = u.searchParams.get('q');
        // The whole drive, as the run's look at what Drive still holds asks for it
        if (!/name = '/.test(q)) return json({ files: [...w.drive.files.values()].filter((f) => (f.driveId || 'shared1') === u.searchParams.get('driveId') && !(/trashed = false/.test(q) && f.trashed)).map((f) => ({ id: f.id })) });
        const name = /name = '((?:\\'|[^'])*)'/.exec(q)[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
        const parent = /'([^']+)' in parents/.exec(q)[1];
        const folder = /mimeType = 'application\/vnd.google-apps.folder'/.test(q);
        // (one shared drive at a time, as Drive searches with corpora=drive)
        const found = [...w.drive.files.values()].filter((f) => (f.driveId || 'shared1') === u.searchParams.get('driveId') && f.parents[0] === parent && f.name === name && (!folder || f.mimeType === 'application/vnd.google-apps.folder') && !(/trashed = false/.test(q) && f.trashed));
        if (u.searchParams.get('orderBy') === 'modifiedTime desc') found.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
        return json({ files: found.map(({ bytes, versions, ...f }) => f) });
      }
      if (u.pathname === '/drive/v3/files' && method === 'POST') {
        const meta = await request.json();
        const id = `folder${++w.drive.n}`;
        w.drive.files.set(id, { id, ...meta, modifiedTime: new Date().toISOString() });
        return json({ id });
      }
      let m;
      if ((m = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname))) {
        const f = w.drive.files.get(m[1]);
        if (!f) return json({ error: { message: 'not found' } }, 404);
        if (u.searchParams.get('alt') === 'media') return new Response(f.bytes);
        return json({ id: f.id, name: f.name, trashed: !!f.trashed, driveId: f.driveId || 'shared1', ...(f.bytes ? { size: String(f.bytes.length), md5Checksum: md5(f.bytes) } : {}) });
      }
      if ((m = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname)) && method === 'PATCH') {
        const f = w.drive.files.get(m[1]);
        if (!f) return json({ error: { message: 'not found' } }, 404);
        (f.versions ||= []).push(f.bytes);
        f.bytes = Buffer.from(await request.arrayBuffer());
        f.modifiedTime = new Date().toISOString();
        return json({ id: f.id, size: String(f.bytes.length), md5Checksum: md5(f.bytes) });
      }
      if (u.pathname === '/upload/drive/v3/files' && method === 'POST') {
        if (w.faults.driveRefuse) return json({ error: { message: 'The user does not have sufficient permissions for this file.', errors: [{ reason: 'insufficientFilePermissions' }] } }, 403);
        const meta = await request.json();
        const id = String(++w.drive.n);
        const size = request.headers.get('x-upload-content-length');
        w.drive.sessions.set(id, { meta, size: size != null ? Number(size) : null, got: [], have: 0, done: null });
        return new Response(null, { status: 200, headers: { location: `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=${id}` } });
      }
      if (u.pathname === '/upload/drive/v3/files' && method === 'PUT') {
        const s = w.drive.sessions.get(u.searchParams.get('upload_id'));
        if (!s) return json({ error: { message: 'gone' } }, 404);
        const body = new Uint8Array(await request.arrayBuffer());
        const range = request.headers.get('content-range');
        const answer = () => (s.done ? json({ id: s.done, size: String(w.drive.files.get(s.done).bytes.length), md5Checksum: md5(w.drive.files.get(s.done).bytes) }) : new Response(null, { status: 308, headers: s.have ? { range: `bytes=0-${s.have - 1}` } : {} }));
        let mm;
        if ((mm = /^bytes \*\/(\d+|\*)$/.exec(range))) return answer();
        mm = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(range);
        if (!mm) throw new Error(`a piece must say which bytes it is: ${range}`);
        const [from, to, total] = [Number(mm[1]), Number(mm[2]), mm[3] === '*' ? null : Number(mm[3])];
        if (body.length !== to - from + 1) throw new Error('a piece is as long as it says');
        if (from !== s.have) throw new Error(`a piece must start where Google is (${s.have}), not ${from}`);
        const last = total != null && to + 1 === total;
        if (!last && body.length % QUANTUM) throw new Error('every piece but the last is whole 256 KiB');
        s.got.push(body);
        s.have += body.length;
        if (last) finish(s);
        if (w.faults.loseDrivePieces > 0) { w.faults.loseDrivePieces--; return json({ error: { message: 'backend error' } }, 503); }
        return answer();
      }
    }

    // ── Backblaze ──
    if (u.host === 'api.backblazeb2.com' && u.pathname === '/b2api/v4/b2_authorize_account') {
      if (w.faults.b2Down) return json({ code: 'unauthorized', message: 'the key isn’t valid right now' }, 401);
      if (auth !== `Basic ${Buffer.from('b2-key-id:b2-app-key').toString('base64')}`) return json({ code: 'unauthorized', message: 'bad key' }, 401);
      return json({ accountId: 'b2acct', authorizationToken: 'b2-token', apiInfo: { storageApi: { apiUrl: 'https://api001.backblaze.test', downloadUrl: 'https://f001.backblaze.test', allowed: { buckets: [{ id: w.b2.bucket.id, name: w.b2.bucket.name }], capabilities: w.b2.caps } } } });
    }
    if (u.host === 'api001.backblaze.test') {
      if (auth !== 'b2-token') return json({ code: 'unauthorized' }, 401);
      const name = u.pathname.split('/').pop();
      const body = await request.json();
      if (/delete|hide|cancel/.test(name)) throw new Error(`the backup must never call ${name}`);
      if (name === 'b2_list_buckets') return json({ buckets: [{ bucketId: w.b2.bucket.id, bucketName: w.b2.bucket.name, fileLockConfiguration: { isClientAuthorizedToRead: true, value: w.b2.lock } }] });
      if (name === 'b2_get_upload_url') return json({ uploadUrl: `https://pod.backblaze.test/upload/${body.bucketId}`, authorizationToken: 'up-token' });
      if (name === 'b2_list_file_versions') return json({ files: w.b2.files.filter((f) => f.fileName.startsWith(body.prefix)).map(({ bytes, ...f }) => f), nextFileName: null });
      if (name === 'b2_start_large_file') { const fileId = `large${++w.b2.n}`; w.b2.large.set(fileId, { name: body.fileName, info: body.fileInfo, parts: new Map() }); return json({ fileId }); }
      if (name === 'b2_get_upload_part_url') return json({ uploadUrl: `https://pod.backblaze.test/part/${body.fileId}`, authorizationToken: 'part-token' });
      if (name === 'b2_list_parts') { const l = w.b2.large.get(body.fileId); if (!l) return json({ code: 'bad_request', message: 'No active upload for: ' + body.fileId }, 400); return json({ parts: [...l.parts.entries()].sort((a, b) => a[0] - b[0]).map(([partNumber, p]) => ({ partNumber, contentSha1: p.sha1, contentLength: p.bytes.length })), nextPartNumber: null }); }
      if (name === 'b2_finish_large_file') {
        const l = w.b2.large.get(body.fileId);
        const parts = [...l.parts.entries()].sort((a, b) => a[0] - b[0]);
        if (JSON.stringify(parts.map(([, p]) => p.sha1)) !== JSON.stringify(body.partSha1Array)) throw new Error('finish names the parts Backblaze has');
        parts.slice(0, -1).forEach(([, p]) => { if (p.bytes.length < 5_000_000) throw new Error('every part but the last is at least 5 MB'); });
        const bytes = Buffer.concat(parts.map(([, p]) => p.bytes));
        if (sha1(bytes) !== l.info.large_file_sha1) throw new Error('the large file isn’t what its SHA-1 said');
        const f = { fileId: body.fileId, fileName: l.name, contentSha1: 'none', contentLength: bytes.length, action: 'upload', fileInfo: l.info, bytes };
        w.b2.files.push(f);
        return json({ fileId: f.fileId, fileName: f.fileName, contentSha1: 'none' });
      }
      return json({ code: 'bad_request', message: `unknown ${name}` }, 400);
    }
    if (u.host === 'pod.backblaze.test') {
      const bytes = Buffer.from(await request.arrayBuffer());
      if (w.faults.b2RefuseUploads) return json({ code: 'storage_cap_exceeded', message: 'Cannot upload files, storage cap exceeded' }, 403);
      const sum = request.headers.get('x-bz-content-sha1');
      if (sha1(bytes) !== sum) return json({ code: 'bad_request', message: 'Sha1 did not match data received' }, 400);
      if (u.pathname.startsWith('/upload/')) {
        const fileName = decodeURIComponent(request.headers.get('x-bz-file-name'));
        const f = { fileId: `small${++w.b2.n}`, fileName, contentSha1: sum, contentLength: bytes.length, action: 'upload', fileInfo: {}, bytes };
        w.b2.files.push(f);
        return json({ fileId: f.fileId, fileName, contentSha1: sum, contentLength: bytes.length });
      }
      if (u.pathname.startsWith('/part/')) {
        if (w.faults.failB2Parts > 0) { w.faults.failB2Parts--; return json({ code: 'service_unavailable', message: 'busy' }, 503); }
        const l = w.b2.large.get(u.pathname.split('/').pop());
        l.parts.set(Number(request.headers.get('x-bz-part-number')), { sha1: sum, bytes });
        return json({ partNumber: Number(request.headers.get('x-bz-part-number')), contentSha1: sum });
      }
    }
    if (u.host === 'f001.backblaze.test') {
      const f = w.b2.files.find((x) => x.fileId === u.searchParams.get('fileId'));
      if (f && w.faults.b2GivesBackDamaged) { const b = Buffer.from(f.bytes); b[b.length - 1] ^= 1; return new Response(b); }
      return f ? new Response(f.bytes) : json({ code: 'not_found' }, 404);
    }

    // ── GitHub, by real git ──
    if (u.host === 'github.com') {
      if (auth !== `Basic ${Buffer.from('x-access-token:gh-read-key').toString('base64')}`) return new Response('no', { status: 401 });
      if (u.pathname !== `/${repo}.git/info/refs` && u.pathname !== `/${repo}.git/git-upload-pack`) return new Response('no such repo', { status: 404 });
      if (u.pathname.endsWith('/info/refs')) {
        const r = spawnSync('git', ['upload-pack', '--stateless-rpc', '--advertise-refs', gitDir]);
        const head = Buffer.from('001e# service=git-upload-pack\n0000');
        return new Response(Buffer.concat([head, r.stdout]), { headers: { 'Content-Type': 'application/x-git-upload-pack-advertisement' } });
      }
      const r = spawnSync('git', ['upload-pack', '--stateless-rpc', gitDir], { input: Buffer.from(await request.arrayBuffer()), maxBuffer: 1 << 30 });
      if (r.status !== 0) throw new Error(`git upload-pack failed: ${r.stderr}`);
      return new Response(r.stdout, { headers: { 'Content-Type': 'application/x-git-upload-pack-result' } });
    }
    throw new Error(`the test world doesn't know ${method} ${request.url}`);
  };
  return w;
}
