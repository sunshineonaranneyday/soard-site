/**
 * A run's work, one job at a time (./flow.js runs each as a Workflow step, so a job cut off part way is retried,
 * and whatever it already finished is kept). A run is a night (named by its Eastern date) or one someone asked
 * for by hand (the date and time): every copy it makes is named by it.
 *   check      what's set up (the read-only key, Google Drive, Backblaze, GitHub, the backup key), READ ME in each home
 *   database   each D1 database, read exactly at one moment (./db.js), squeezed, encrypted, staged and shipped
 *   settings   Cloudflare's settings (./settings.js)
 *   code       each repo as a git bundle (./github.js), when it changed
 *   files      photos, videos and R2 files not copied yet (./sources.js), a batch per step
 *   list       the run's list of every file and where its copy is
 *   drill      (weekly) the run's database copies read back from the homes, opened with the key, restored into a
 *              spare D1 database and compared table by table; a few files and the code checked too
 *   finish     the run's summary: everything that isn't right is in its problems, and ok means there are none
 *
 * Staging is safe even if two runs ever overlap: each staged file has its own name, the copy that's recorded first
 * wins (with the file it was made from), and a copy is shipped by one run at a time (a lease).
 */
import { readDatabase, d1Http, d1Binding, Moved } from './db.js';
import { createSplitter, HOLD } from './sql.js';
import { stageEncrypted, putStream, hasher, decrypt } from './stage.js';
import { shipCopy } from './ship.js';
import { driveToken, listDrives, pickDrive, download as driveDownload, uploadSmall, replaceContent, findChild, backupAccount, listAllIds, fileInfo, DriveError } from './drive.js';
import { b2Client, B2Error } from './b2.js';
import { cfApi, listImages, listVideos, listBucket, openItem, pathFor, SourceError } from './sources.js';
import { listRefs, bundleStream } from './github.js';
import { readSettings, KEY_LINK, KEY_EXTRAS } from './settings.js';
import { readme, README_NAME, README_VERSION } from './readme.js';
import { createHash } from 'node:crypto';

const enc = new TextEncoder();
const WATCHDOG_NOTE = 'Watchdog - last check.txt';
const LEASE_MS = 30 * 60_000;
const HOUR = 3600_000;
export const config = (env) => ({
  databases: JSON.parse(env.DATABASES || '[]'),
  repos: JSON.parse(env.REPOS || '[]'),
  buckets: JSON.parse(env.R2_BUCKETS || '[]'),
  quietSecond: Number(env.QUIET_SECOND ?? 28),
  pace: env.API_PACE_MS != null ? Number(env.API_PACE_MS) : undefined,
  retryMs: env.API_RETRY_MS != null ? Number(env.API_RETRY_MS) : undefined,
});
const year = (run) => run.slice(0, 4);
const short = (repo) => repo.split('/').pop();
const sha256Hex = (s) => createHash('sha256').update(s).digest('hex');
// Each staging attempt has its own file: a second run never overwrites the bytes another run's copy points at
const stageKey = (id) => `stage/${encodeURIComponent(id)}/${crypto.randomUUID()}`;
const errText = (e) => String(e?.message || e).slice(0, 300);

/** The homes that are set up, ready to use: { drive, b2, problems } */
export async function homes(env, state, { fetchImpl = fetch } = {}) {
  const problems = [];
  let drive = null;
  let b2 = null;
  const { fingerprint } = await state.publicKey();
  if (env.GOOGLE_BACKUP_KEY) {
    try {
      const token = await driveToken(env, { fetchImpl });
      const picked = pickDrive(await listDrives(token, { fetchImpl }));
      if (!picked) problems.push({ home: 'drive', why: 'no shared drive with “backup” in its name is shared with the backup’s Google account yet' });
      else drive = { token, driveId: picked.id, name: picked.name, canDelete: !!(picked.capabilities?.canTrashChildren || picked.capabilities?.canDeleteChildren), fingerprint, fetchImpl };
    } catch (e) { problems.push({ home: 'drive', why: errText(e) }); }
  } else problems.push({ home: 'drive', why: 'the backup’s Google key (GOOGLE_BACKUP_KEY) isn’t set yet' });
  if (env.B2_KEY_ID && env.B2_APPLICATION_KEY) {
    try { b2 = await b2Client(env, { fetchImpl }); } catch (e) { problems.push({ home: 'b2', why: errText(e) }); }
  } else problems.push({ home: 'b2', why: 'the Backblaze key (B2_KEY_ID, B2_APPLICATION_KEY) isn’t set yet' });
  return { drive, b2, problems };
}

/** Everything the backup needs, checked now: what the admin shows under Automations → Hosting → Backup */
export async function checkSetup(env, state, { fetchImpl = fetch } = {}) {
  const at = new Date().toISOString();
  const key = await state.publicKey();
  const h = await homes(env, state, { fetchImpl });
  const out = { at, key: { fingerprint: key.fingerprint, made: key.made }, google: { account: backupAccount(env) }, cloudflare: { link: KEY_LINK, extras: KEY_EXTRAS }, b2: {}, github: {}, problems: [...h.problems] };
  out.google.ok = !!h.drive;
  if (h.drive) {
    out.google.drive = h.drive.name;
    out.google.canDelete = h.drive.canDelete;
    if (h.drive.canDelete) out.problems.push({ home: 'drive', why: 'the backup’s Google account can delete in the backup drive: make it a Contributor there, not a Content manager or Manager' });
  }
  if (h.b2) {
    try {
      const lock = await h.b2.lock();
      out.b2 = { ok: true, bucket: h.b2.bucket.name, lock, canDelete: h.b2.capabilities.has('deleteFiles') || h.b2.capabilities.has('bypassGovernance') };
      if (!lock.on || !lock.days) out.problems.push({ home: 'b2', why: 'the Backblaze bucket has no Object Lock default (turn on Object Lock with a default retention)' });
      else if (lock.mode !== 'compliance') out.problems.push({ home: 'b2', why: `the Backblaze bucket’s lock is in ${lock.mode || 'no'} mode, which a key with bypass rights can undo: set its default retention to Compliance` });
      if (out.b2.canDelete) out.problems.push({ home: 'b2', why: 'the Backblaze key can delete: make a key with read and write only' });
    } catch (e) { out.b2 = { ok: false }; out.problems.push({ home: 'b2', why: errText(e) }); }
  }
  // The read-only Cloudflare key: one database's bookmark proves it reads D1
  const cfg = config(env);
  if (!env.CF_BACKUP_TOKEN) out.problems.push({ home: 'cloudflare', why: 'the read-only backup key (CF_BACKUP_TOKEN) isn’t set yet' });
  else {
    try {
      await d1Http({ accountId: env.CF_ACCOUNT_ID, databaseId: cfg.databases[0].id, token: env.CF_BACKUP_TOKEN, fetchImpl }).bookmark();
      out.cloudflare.ok = true;
    } catch (e) { out.cloudflare.ok = false; out.problems.push({ home: 'cloudflare', why: `the read-only key can’t read the database: ${errText(e)}` }); }
  }
  if (!env.GITHUB_BACKUP_TOKEN) out.problems.push({ home: 'github', why: 'the GitHub read-only key (GITHUB_BACKUP_TOKEN) isn’t set yet' });
  else {
    out.github.repos = {};
    for (const repo of cfg.repos) {
      try { const r = await listRefs(env, repo, { fetchImpl }); out.github.repos[repo] = Object.keys(r.refs).length; } catch (e) { out.github.repos[repo] = null; out.problems.push({ home: 'github', why: errText(e) }); }
    }
    out.github.ok = Object.values(out.github.repos).every((n) => n != null);
  }
  // The watchdog outside Cloudflare (workers/backup/watchdog) updates a note in the drive every morning
  if (h.drive) {
    try {
      const note = await findChild(h.drive.token, h.drive.driveId, h.drive.driveId, WATCHDOG_NOTE, { fetchImpl, newest: true });
      out.watchdog = { at: note?.modifiedTime || null };
      if (!note) out.problems.push({ home: 'watchdog', why: 'the watchdog in Google, which checks the backup from outside Cloudflare, isn’t set up yet' });
      else if (Date.now() - Date.parse(note.modifiedTime) > 60 * HOUR) out.problems.push({ home: 'watchdog', why: `the watchdog in Google hasn’t checked since ${note.modifiedTime.slice(0, 10)}` });
    } catch { out.watchdog = { at: null }; }
  }
  out.stream = { key: !!(await state.get('streamKey')) };
  out.recovery = (await state.get('recovery')) || { printed: null };
  // Until the sheet for this very key is printed, the only copy of the key is inside Cloudflare: if Cloudflare is
  // lost, so is every backup. That is trouble, not a footnote.
  if (!out.recovery.printed) out.problems.push({ home: 'key', why: 'the recovery sheet hasn’t been printed yet: until it is, the only copy of the key that opens every backup is inside Cloudflare' });
  else if (out.recovery.printed.fingerprint && out.recovery.printed.fingerprint !== key.fingerprint) out.problems.push({ home: 'key', why: `the backup key changed (now ${key.fingerprint}) since the recovery sheet was printed: print the new sheet` });
  // READ ME in each home, once per version of it (a new version replaces the words, never a second file)
  const text = (where) => enc.encode(readme({ fingerprint: key.fingerprint, databases: cfg.databases, repos: cfg.repos, home: where }));
  const readmeAt = (await state.get('readme')) || {};
  if (h.drive && readmeAt.drive !== `${README_VERSION}:${key.fingerprint}`) {
    try {
      const have = await findChild(h.drive.token, h.drive.driveId, h.drive.driveId, README_NAME, { fetchImpl });
      if (have) await replaceContent(h.drive.token, have.id, text('drive'), { fetchImpl });
      else await uploadSmall(h.drive.token, { name: README_NAME, parentId: h.drive.driveId, mimeType: 'text/plain', bytes: text('drive'), fetchImpl });
      await state.merge('readme', { drive: `${README_VERSION}:${key.fingerprint}` });
    } catch (e) { out.problems.push({ home: 'drive', why: `couldn’t write the READ ME: ${errText(e)}` }); }
  }
  if (h.b2 && readmeAt.b2 !== `${README_VERSION}:${key.fingerprint}`) {
    try {
      const bytes = text('bucket');
      const hb = hasher(); hb.update(bytes);
      await h.b2.upload(README_NAME, bytes, { sha1: hb.result().sha1, type: 'text/plain' });
      await state.merge('readme', { b2: `${README_VERSION}:${key.fingerprint}` });
    } catch (e) { out.problems.push({ home: 'b2', why: `couldn’t write the READ ME: ${errText(e)}` }); }
  }
  out.ready = !!(h.drive || h.b2) && !!env.CF_BACKUP_TOKEN;
  out.homes = { drive: !!h.drive, b2: !!h.b2 };
  // Set up once every piece is in place (the recovery sheet aside, which is then nagged about): from then on
  // trouble is alerted; before, the admin's setup steps say what's left
  if (out.ready && !out.problems.some((p) => p.home !== 'key') && !(await state.get('setUpAt'))) await state.set('setUpAt', at);
  out.setUpAt = await state.get('setUpAt');
  await state.set('setup', out);
  return out;
}

// The recorded copy wins; a staged file that lost (another run recorded the copy first) is removed
async function record(env, state, copy) {
  const got = await state.addCopy(copy);
  if (got.staged !== copy.staged) await env.STAGING.delete(copy.staged);
  return got;
}

/** A plain (unencrypted) file staged as a copy: manifests, summaries, drill reports */
async function stagePlain(env, state, { id, kind, run, path, bytes, meta = null }) {
  const have = await state.copy(id);
  if (have) return have;
  const key = stageKey(id);
  await putStream(env.STAGING, key, new Response(bytes).body);
  const hb = hasher(); hb.update(bytes);
  const r = hb.result();
  return record(env, state, { id, kind, night: run, path, staged: key, size: r.size, md5: r.md5, sha1: r.sha1, sha256: r.sha256, plain_sha256: r.sha256, plain_size: r.size, meta });
}

/**
 * Encrypts and stages a stream (made by `open()`, only if the copy isn't already there) as a copy. `expect` is
 * what the source said it is ({ size, md5 }): bytes that don't match were cut short or changed on the way.
 */
async function stageCopy(env, state, { id, kind, run, path, open, gzip = false, meta = null, expect = null }) {
  const have = await state.copy(id);
  if (have) return have;
  const { recipient } = await state.publicKey();
  const key = stageKey(id);
  const r = await stageEncrypted(env, key, await open(), { recipient, gzip });
  const off = expect?.size != null && r.plain.size !== expect.size ? `${r.plain.size} bytes came, not ${expect.size}`
    : expect?.md5 && r.plain.md5 !== expect.md5 ? 'the bytes that came aren’t the ones the source has (MD5)' : null;
  if (off) { await env.STAGING.delete(key); throw new SourceError(`${path}: ${off}`, 502); }
  return record(env, state, { id, kind, night: run, path, staged: key, size: r.stored.size, md5: r.stored.md5, sha1: r.stored.sha1, sha256: r.stored.sha256, plain_sha256: r.plain.sha256, plain_size: r.plain.size, meta: typeof meta === 'function' ? await meta() : meta });
}

/**
 * Ships a copy to every home that's set up, by one run at a time, and returns it as it stands. It never throws: a
 * copy made is made, and a home that won't take it (down, full, refusing) never holds up the rest or the other
 * home. The failure is kept on the copy (it goes to the back, and is sent again) and, by home, for the run's summary.
 */
export async function ship(env, h, state, id, by) {
  if (!h.drive && !h.b2) return state.copy(id);
  if (!(await state.claimCopy(id, by, LEASE_MS))) return state.copy(id);
  try {
    await state.shipAttempt(id);
    return await shipCopy(env, h, state, id);
  } catch (e) {
    await state.shipFailed(id, errText(e));
    // Which home refused which copy, so the run's summary names a home only while a copy it refused still lacks it
    if (Object.keys(e.byHome || {}).length) {
      const trouble = (await state.get('shipTrouble')) || {};
      for (const [home, words] of Object.entries(e.byHome)) trouble[home] = { at: new Date().toISOString(), error: String(words).slice(0, 300), ids: [...new Set([...(trouble[home]?.ids || []), id])].slice(-200) };
      await state.set('shipTrouble', trouble);
    }
    return state.copy(id);
  } finally {
    await state.releaseCopy(id, by);
  }
}

/** Waits for the database's quiet moment (just after the site's minute jobs) */
export function untilQuiet(second, now = Date.now()) {
  const s = (now / 1000) % 60;
  if (s >= second && s < second + 3) return 0;
  return (((second - s) + 60) % 60) * 1000;
}

/** One database: read exactly at one moment, then staged and shipped. Returns its summary. */
// The read must fit in the quiet time between the site's minute jobs (about 35 s); 20 tries is 20 minutes, inside a step's 30
export const QUIET_TRIES = 20;
const SLOW_READ_MS = 25_000;
export async function databaseJob(env, state, h, db, run, { by, fetchImpl = fetch, wait = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now(), attempts = QUIET_TRIES } = {}) {
  const id = `db:${db.name}:${run}`;
  let c = await state.copy(id);
  if (!c) {
    const source = d1Http({ accountId: env.CF_ACCOUNT_ID, databaseId: db.id, token: env.CF_BACKUP_TOKEN, fetchImpl });
    const { recipient } = await state.publicKey();
    for (let tries = 1; ; tries++) {
      if (db.quiet !== false) await wait(untilQuiet(config(env).quietSecond, now()));
      const key = stageKey(id);
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const staging = stageEncrypted(env, key, readable, { recipient, gzip: true });
      staging.catch(() => {});
      let read;
      const began = now();
      try {
        read = await readDatabase(source, { label: `${db.label} (${db.name})`, now: new Date(now()), write: async (b) => { await writer.ready; await writer.write(b); } });
        await writer.close();
      } catch (e) {
        await writer.abort(e).catch(() => {});
        await staging.catch(() => {});
        if (e instanceof Moved && tries < attempts) continue;
        if (e instanceof Moved) throw new Error(`${db.name} was written to during each of ${tries} reads (the last took ${Math.round((now() - began) / 1000)} s${db.quiet !== false ? '; the quiet time between the site’s minute jobs is about 35 s' : ''}), so no copy was made`);
        throw e;
      }
      const readMs = now() - began;
      const r = await staging;
      const manifest = { what: `${db.label} (${db.name}), read exactly at one moment`, run, at: new Date(now()).toISOString(), bookmark: read.bookmark, attempts: tries, readMs, tables: read.tables, objects: read.objects, statements: read.statements, rowidsNotKept: read.rowidsNotKept || [], sqlBytes: r.plain.size, file: { sha256: r.stored.sha256, bytes: r.stored.size }, sqlGz: { sha256: r.plain.sha256 } };
      c = await record(env, state, { id, kind: 'database', night: run, path: `Database/${db.name}/${year(run)}/${run} ${db.name}.sql.gz.age`, staged: key, size: r.stored.size, md5: r.stored.md5, sha1: r.stored.sha1, sha256: r.stored.sha256, plain_sha256: r.plain.sha256, plain_size: r.plain.size, meta: manifest });
      break;
    }
  }
  const m = await stagePlain(env, state, { id: `manifest:${db.name}:${run}`, kind: 'manifest', run, path: `Database/${db.name}/${year(run)}/${run} ${db.name} manifest.json`, bytes: enc.encode(JSON.stringify(c.meta, null, 1)) });
  c = await ship(env, h, state, id, by);
  await ship(env, h, state, m.id, by);
  const t = Object.values(c.meta.tables);
  return { name: db.name, tables: t.length, rows: t.reduce((s, x) => s + x.rows, 0), bytes: c.size, attempts: c.meta.attempts, readMs: c.meta.readMs, slow: db.quiet !== false && c.meta.readMs > SLOW_READ_MS, bookmark: c.meta.bookmark, shipped: !!c.shipped_at };
}

/** Cloudflare's settings, and each domain's DNS records as a zone file */
export async function settingsJob(env, state, h, run, { by, fetchImpl = fetch } = {}) {
  const id = `settings:${run}`;
  let c = await state.copy(id);
  if (!c) {
    const read = await readSettings(env, { fetchImpl });
    const zoneIds = [];
    for (const z of read.zoneFiles) {
      const zid = `zone:${z.name}:${run}`;
      await stageCopy(env, state, { id: zid, kind: 'settings', run, path: `Cloudflare settings/${year(run)}/${run} ${z.name}.age`, open: async () => enc.encode(z.text) });
      zoneIds.push(zid);
    }
    c = await stageCopy(env, state, { id, kind: 'settings', run, path: `Cloudflare settings/${year(run)}/${run} cloudflare-settings.json.age`, open: async () => enc.encode(JSON.stringify(read.json, null, 1)), meta: { zones: read.zones, records: read.records, notRead: read.problems.map((p) => p.what), zoneIds } });
  }
  for (const zid of c.meta.zoneIds) await ship(env, h, state, zid, by);
  c = await ship(env, h, state, id, by);
  return { zones: c.meta.zones, records: c.meta.records, notRead: c.meta.notRead, shipped: !!c.shipped_at };
}

/** One repo, as a git bundle: all of it on the month's first copy, otherwise only what's new (and nothing if nothing changed) */
export async function codeJob(env, state, h, repo, run, { by, fetchImpl = fetch } = {}) {
  const id = `code:${repo}:${run}`;
  let c = await state.copy(id);
  if (!c) {
    const prev = await state.get(`repo:${repo}`);
    const { head, refs } = await listRefs(env, repo, { fetchImpl });
    const month = run.slice(0, 7);
    const full = !prev || prev.month !== month;
    const same = prev && JSON.stringify(Object.entries(prev.refs).sort()) === JSON.stringify(Object.entries(refs).sort());
    if (!full && same) return { repo, unchanged: true };
    const have = full ? [] : [...new Set(Object.values(prev.refs))];
    let info = null;
    c = await stageCopy(env, state, {
      id, kind: 'code', run, path: `Code/${short(repo)}/${year(run)}/${run} ${short(repo)} ${full ? 'full' : 'new'} ${(head || Object.values(refs)[0]).slice(0, 7)}.bundle.age`,
      open: async () => { const b = await bundleStream(env, repo, { refs, head, have, fetchImpl }); info = b.done; return b.stream; },
      meta: async () => { const d = await info(); return { repo, full, refs, head, have, objects: d.objects, packBytes: d.bytes }; },
    });
  }
  // What the next run's bundle builds on (set from the copy, so a step retried after staging still records it)
  if ((await state.get(`repo:${repo}`))?.run !== run) {
    const prev = await state.get(`repo:${repo}`);
    await state.set(`repo:${repo}`, { refs: c.meta.refs, head: c.meta.head, month: c.meta.full ? run.slice(0, 7) : prev.month, run, full: c.meta.full ? run : prev.full });
  }
  c = await ship(env, h, state, id, by);
  return { repo, full: c.meta.full, objects: c.meta.objects, bytes: c.size, shipped: !!c.shipped_at };
}

/** The run's listing of every photo, video and R2 file, recorded; a source that couldn't be listed is in `error` */
export async function listJob(env, state, run, { fetchImpl = fetch, pace = config(env).pace } = {}) {
  const api = cfApi(env, { fetchImpl, pace });
  const out = {};
  const sources = [['images', () => listImages(api)], ['videos', () => listVideos(api)], ...config(env).buckets.map((b) => [`r2:${b}`, () => listBucket(api, b)])];
  for (const [source, list] of sources) {
    try {
      let items = await list();
      if (source === 'videos') {
        // A video Stream hasn't finished (still uploading or processing, or failed) has no MP4 to copy yet
        const notReady = items.filter((v) => !v.ready).map((v) => v.key);
        items = items.filter((v) => v.ready);
        await state.merge('needs', { notReady });
        out[source] = { found: items.length, notReady: notReady.length, todo: await state.syncSource(source, items, run) };
      } else out[source] = { found: items.length, todo: await state.syncSource(source, items, run) };
    } catch (e) { out[source] = { error: errText(e) }; }
  }
  return out;
}

const SMALL = 16 * 1024 * 1024;
/** The next batch of files with no copy yet: many small ones (photos are under 10 MB), or one big one */
export async function filesJob(env, state, h, run, { by, until = Infinity, fetchImpl = fetch, pace = config(env).pace } = {}) {
  // Past its time (the next night's run is due), the run stops copying files: the next run carries on, with fresh
  // database copies first
  if (Date.now() > until) { const t = await state.todoCount(run); return { copied: 0, failed: 0, left: t.left, gaveUp: t.failed, outOfTime: true }; }
  const api = cfApi(env, { fetchImpl, pace, retryMs: config(env).retryMs });
  const todo = await state.todo(run, 40);
  const batch = [];
  let bytes = 0;
  for (const it of todo) {
    const big = it.source === 'videos' || (it.size != null && it.size > SMALL);
    if (big && batch.length) break;
    batch.push(it);
    bytes += it.size || 1024 * 1024;
    if (big || bytes > 4 * SMALL) break;
  }
  const held = await state.get('streamKey');
  const streamKey = held && !held.refused ? held : null;
  let copied = 0;
  let failed = 0;
  let homeDown = 0;
  let taken = 0;
  for (const it of batch) {
    const code = sha256Hex(`${it.source}|${it.key}|${it.version}`).slice(0, 32);
    const id = `file:${code}`;
    try {
      await state.sourceTrying(it.source, it.key, it.version);
      if (!(await state.copy(id))) {
        const src = await openItem(api, it, { streamKey, fetchImpl });
        await stageCopy(env, state, {
          id, kind: 'file', run, path: `${pathFor(it, { code, type: src.type })}.age`, open: async () => src.body,
          meta: { source: it.source, key: it.key, version: it.version, name: it.name }, expect: { size: src.size, md5: src.md5 },
        });
      }
      await state.sourceDone(it.source, it.key, it.version, id);
    } catch (e) {
      failed++;
      // Trouble that isn't the file's: a home down, or Cloudflare itself failing (5xx, too many requests, no answer)
      if (e instanceof DriveError || e instanceof B2Error || e?.name === 'TypeError' || e?.status >= 500 || e?.status === 429) homeDown++;
      // A signing key Stream refuses is set aside, so the site is asked for a new one
      if (e.keyRefused && (await state.get('streamKey'))?.id === e.keyRefused) await state.merge('streamKey', { refused: new Date().toISOString() });
      await state.sourceFailed(it.source, it.key, it.version, errText(e));
      continue;
    }
    // Copied: made and recorded. Getting it into the homes is shipping's business, home by home
    copied++;
    const c = await ship(env, h, state, id, by);
    // Taken by a home, or being sent by another attempt right now (not this one's to judge)
    if (c?.drive_id || c?.b2_id || (c?.lease_by && c.lease_by !== by && c.lease_until > Date.now())) taken++;
  }
  // Copies made but no home took a single one: every home set up is refusing. Said, not thrown (a retry would only
  // stage another batch with nowhere to go): the run stops copying files and the next run carries on
  const noHome = !!(copied && !taken && (h.drive || h.b2));
  // Every one failed because a home or Cloudflare is down: fail the step, so it's tried again after a wait, and three
  // such steps in a row end the files for this run, rather than every file being tried in turn
  if (batch.length && !copied && homeDown === failed) throw new Error(`no file could be copied: ${(await state.failures(run, 1))[0]?.error || 'a home or Cloudflare is down'}`);
  const t = await state.todoCount(run);
  return { copied, failed, left: t.left, gaveUp: t.failed, ...(noHome ? { noHome: true } : {}) };
}

/**
 * What Google Drive still holds: every copy's Drive file is looked for, and one that's gone (deleted, or in the
 * trash, which empties itself) is sent again from Backblaze. Backblaze's copies are locked: none can go.
 */
export async function auditJob(env, state, h, { settle = Number(env.AUDIT_SETTLE_MS ?? 6 * HOUR), confirmMax = 1000 } = {}) {
  if (!h.drive) return null;
  const copies = await state.driveCopies(new Date(Date.now() - settle).toISOString());
  const there = await listAllIds(h.drive.token, h.drive.driveId, { fetchImpl: h.drive.fetchImpl });
  // Missing from one listing isn't gone: each is asked about by its id, and only one Drive says is gone or in the
  // trash counts (a thousand a run at most; the rest are asked about next run)
  // (oldest looked at first, so a thousand that stay put never hide one behind them)
  const missing = copies.filter((c) => !there.has(c.drive_id)).sort((a, b) => String(a.audited_at || '').localeCompare(String(b.audited_at || ''))).slice(0, confirmMax);
  const lost = [];
  const present = [];
  for (const c of missing) {
    try {
      const info = await fileInfo(h.drive.token, c.drive_id, { fetchImpl: h.drive.fetchImpl });
      // In the trash, or moved out of the backup drive (another drive isn't the backup): gone
      if (info?.trashed || info?.driveId !== h.drive.driveId) lost.push(c.id); else present.push(c.id);
    } catch (e) {
      if (e instanceof DriveError && e.status === 404) lost.push(c.id); else throw e;
    }
  }
  if (present.length) await state.markAudited(present);
  if (lost.length) await state.driveLost(lost);
  return { checked: copies.length, lost: lost.length };
}

/** Copies not yet in every home (a home set up late, or a step cut off), the ones that failed least first */
export async function shipJob(env, state, h, { by, limit = 25 } = {}) {
  if (!h.drive && !h.b2) return { shipped: 0, gained: 0, tried: 0, shippable: 0, left: await state.unshippedCount() };
  const up = { drive: !!h.drive, b2: !!h.b2 };
  const shippable = await state.shippable(up);
  // Progress is counted home by home: Backblaze taking copies while Drive refuses is still progress
  let shipped = 0;
  let gained = 0;
  const batch = await state.unshipped(limit, up);
  for (const id of batch) {
    const was = await state.copy(id);
    const c = await ship(env, h, state, id, by);
    if (c?.shipped_at) shipped++;
    if ((c?.drive_id && !was?.drive_id) || (c?.b2_id && !was?.b2_id)) gained++;
  }
  // (each copy tried goes behind the rest, so the next batch is others)
  return { shipped, gained, tried: batch.length, shippable, left: await state.unshippedCount() };
}

/** The run's list of every file and where its copy is (encrypted: a file's name can say whose it is) */
export async function fileListJob(env, state, h, run, { by } = {}) {
  const id = `list:${run}`;
  await stageCopy(env, state, { id, kind: 'list', run, path: `Files/Lists/${year(run)}/${run} files.json.gz.age`, gzip: true, open: async () => enc.encode(JSON.stringify({ run, files: await state.currentFiles() })) });
  const c = await ship(env, h, state, id, by);
  return { shipped: !!c.shipped_at };
}

// ── The restore drill: each part a step of its own, its result kept as it finishes ──

/** Removes everything from the spare database (an emptied sqlite_sequence stays: SQLite won't drop it) */
async function wipe(DB) {
  const objs = (await DB.prepare("SELECT type AS t, name AS n FROM sqlite_master WHERE substr(name, 1, 7) <> 'sqlite_' AND substr(name, 1, 4) <> '_cf_'").all()).results || [];
  const q = (s) => `"${s.replace(/"/g, '""')}"`;
  const order = { trigger: 0, view: 1, index: 2, table: 3 };
  const drops = objs.sort((a, b) => order[a.t] - order[b.t]).map((o) => DB.prepare(`DROP ${o.t.toUpperCase()} IF EXISTS ${q(o.n)}`));
  const seq = (await DB.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'sqlite_sequence'").first())?.n;
  await DB.batch([DB.prepare('PRAGMA defer_foreign_keys = true'), ...drops, ...(seq ? [DB.prepare('DELETE FROM sqlite_sequence')] : [])]);
}

/** A copy's bytes from a home, checked against its SHA-256 as they arrive, as a stream */
function checked(body, want, label) {
  const h = hasher();
  return body.pipeThrough(new TransformStream({
    transform(chunk, c) { h.update(chunk); c.enqueue(chunk); },
    flush(c) { const got = h.result(); if (got.sha256 !== want) c.error(new Error(`${label} doesn’t match what was sent (SHA-256 ${got.sha256.slice(0, 12)}…)`)); },
  }));
}

async function fromHome(h, c, where) {
  if (where === 'drive') return (await driveDownload(h.drive.token, c.drive_id, { fetchImpl: h.drive.fetchImpl })).body;
  return (await h.b2.download(c.b2_id)).body;
}
const homesUp = (h) => ['drive', 'b2'].filter((w) => h[w]);
const drillKey = (run) => `drill:${run}`;

/** One database copy, read back from a home, restored into the spare database and compared table by table */
export async function drillDatabaseJob(env, state, h, db, run) {
  const c = await state.copy(`db:${db.name}:${run}`);
  let part;
  if (!c?.shipped_at || homesUp(h).length < 2) part = { name: db.name, skipped: 'its copy isn’t in both homes yet' };
  else {
    try {
      const identity = await state.secretKey();
      const where = homesUp(h)[0];
      const plain = await decrypt(identity, checked(await fromHome(h, c, where), c.sha256, `the copy in ${where}`));
      const sql = plain.pipeThrough(new DecompressionStream('gzip'));
      await wipe(env.DRILL);
      const split = createSplitter();
      let batch = [];
      let size = 0;
      let statements = 0;
      const run1 = async () => { if (!batch.length) return; await env.DRILL.batch(batch.map((s) => env.DRILL.prepare(s))); statements += batch.length; batch = []; size = 0; };
      const dec = new TextDecoder('utf-8', { fatal: true });
      const add = async (s) => { batch.push(dec.decode(s)); size += s.length; if (batch.length >= 50 || size > 2_000_000) await run1(); };
      const reader = sql.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const s of split.push(value)) await add(s);
      }
      for (const s of split.end()) await add(s);
      await run1();
      const back = await readDatabase(d1Binding(env.DRILL), { label: 'the restored copy' });
      await wipe(env.DRILL);
      const want = c.meta.tables;
      const names = [...new Set([...Object.keys(want), ...Object.keys(back.tables)])].filter((t) => t !== HOLD);
      const different = names.filter((t) => want[t]?.digest !== back.tables[t]?.digest);
      // The other home holds the very same bytes
      for (const w of homesUp(h).slice(1)) await checked(await fromHome(h, c, w), c.sha256, `the copy in ${w}`).pipeTo(new WritableStream());
      part = { name: db.name, from: where, statements, tables: names.length, rows: Object.values(back.tables).reduce((s, t) => s + t.rows, 0), different, ok: !different.length };
      if (different.length) part.problem = `${db.name}: ${different.length} table(s) came back different: ${different.slice(0, 5).join(', ')}`;
    } catch (e) {
      await wipe(env.DRILL).catch(() => {});
      part = { name: db.name, ok: false, problem: `${db.name}: ${errText(e)}` };
    }
  }
  const d = (await state.get(drillKey(run))) || {};
  await state.set(drillKey(run), { ...d, databases: [...(d.databases || []).filter((x) => x.name !== db.name), part] });
  return { name: db.name, ok: part.ok ?? null };
}

/** A copy of a file opens to exactly what was copied, from each home */
export async function drillFilesJob(env, state, h, run) {
  const parts = [];
  if (homesUp(h).length === 2) {
    const identity = await state.secretKey();
    for (const c of await state.sampleCopies('file', 3)) {
      for (const w of homesUp(h)) {
        try {
          const plain = await decrypt(identity, checked(await fromHome(h, c, w), c.sha256, `the copy in ${w}`));
          const got = hasher();
          await plain.pipeTo(new WritableStream({ write(chunk) { got.update(chunk); } }));
          if (got.result().sha256 !== c.plain_sha256) throw new Error('it opens to something other than what was copied');
          parts.push({ path: c.path, where: w, ok: true });
        } catch (e) { parts.push({ path: c.path, where: w, ok: false, problem: `${c.path} in ${w}: ${errText(e)}` }); }
      }
    }
  }
  const d = (await state.get(drillKey(run))) || {};
  await state.set(drillKey(run), { ...d, files: parts });
  return { checked: parts.length, ok: parts.every((p) => p.ok) };
}

/**
 * A git bundle opens whole: "# v2 git bundle", its lines, a blank line, then a pack whose last 20 bytes are the
 * SHA-1 of the rest. Read as a stream, so a bundle of any size fits.
 */
export async function checkBundle(plain) {
  const reader = plain.getReader();
  const sha = createHash('sha1');
  let header = new Uint8Array(0);
  let inPack = false;
  let tail = new Uint8Array(0);
  let packBytes = 0;
  let magic = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    let chunk = value;
    if (!inPack) {
      const joined = new Uint8Array(header.length + chunk.length);
      joined.set(header);
      joined.set(chunk, header.length);
      let p = -1;
      for (let i = 0; i < joined.length - 1; i++) if (joined[i] === 0x0a && joined[i + 1] === 0x0a) { p = i + 2; break; }
      if (p < 0) { if (joined.length > 1 << 20) throw new Error('its header never ends'); header = joined; continue; }
      if (new TextDecoder().decode(joined.subarray(0, 16)) !== '# v2 git bundle\n') throw new Error('it doesn’t start like a git bundle');
      inPack = true;
      chunk = joined.subarray(p);
    }
    if (magic.length < 4) magic += new TextDecoder('latin1').decode(chunk.subarray(0, 4 - magic.length));
    const joined = new Uint8Array(tail.length + chunk.length);
    joined.set(tail);
    joined.set(chunk, tail.length);
    const keep = Math.max(0, joined.length - 20);
    sha.update(joined.subarray(0, keep));
    tail = joined.slice(keep);
    packBytes += chunk.length;
  }
  const trailer = [...tail].map((x) => x.toString(16).padStart(2, '0')).join('');
  if (!inPack || magic !== 'PACK' || packBytes < 32 || sha.digest('hex') !== trailer) throw new Error('it isn’t a whole git bundle');
  return packBytes;
}

/** The newest code copy of a repo opens to a whole git bundle */
export async function drillCodeJob(env, state, h, repo, run) {
  const c = (await state.copies({ kind: 'code', limit: 200 })).find((x) => x.meta?.repo === repo && x.shipped_at);
  let part;
  if (!c || !homesUp(h).length) part = { repo, skipped: 'no copy in a home yet' };
  else {
    try {
      const where = homesUp(h)[0];
      const plain = await decrypt(await state.secretKey(), checked(await fromHome(h, c, where), c.sha256, `the copy in ${where}`));
      part = { repo, path: c.path, packBytes: await checkBundle(plain), ok: true };
    } catch (e) { part = { repo, ok: false, problem: `${repo}: ${errText(e)}` }; }
  }
  const d = (await state.get(drillKey(run))) || {};
  await state.set(drillKey(run), { ...d, code: [...(d.code || []).filter((x) => x.repo !== repo), part] });
  return { repo, ok: part.ok ?? null };
}

/** The drill's report: ok, failed, or skipped (nothing to drill yet), written beside the run */
export async function drillReportJob(env, state, h, run, { by } = {}) {
  const d = (await state.get(drillKey(run))) || {};
  const problems = [...(d.databases || []), ...(d.files || []), ...(d.code || [])].filter((p) => p.ok === false).map((p) => p.problem);
  // Passed only when every database was restored and came back exactly: one skipped (its copy not in both homes)
  // leaves the drill to run again with the next run
  const skipped = config(env).databases.map((db) => db.name).filter((name) => !(d.databases || []).some((x) => x.name === name && x.ok === true));
  const report = { run, at: new Date().toISOString(), databases: d.databases || [], files: d.files || [], code: d.code || [], problems, ok: problems.length ? false : skipped.length ? null : true };
  if (report.ok === null) report.skipped = `not drilled yet (not in both homes): ${skipped.join(', ')}`;
  await state.set('drill', report);
  // In the homes, in plain: what was drilled and how it came out, never an error's words (they can quote a value)
  const plain = {
    run, at: report.at, ok: report.ok, skipped: report.ok === null ? skipped : [], problems: problems.length,
    databases: report.databases.map((x) => ({ name: x.name, tables: x.tables ?? null, rows: x.rows ?? null, different: x.different?.length ?? null, ok: x.ok ?? null })),
    files: { checked: report.files.length, ok: report.files.filter((x) => x.ok).length },
    code: report.code.map((x) => ({ repo: x.repo, ok: x.ok ?? null })),
  };
  const p = await stagePlain(env, state, { id: `drill:${run}`, kind: 'drill', run, path: `Restore drills/${year(run)}/${run} drill.json`, bytes: enc.encode(JSON.stringify(plain, null, 1)) });
  await ship(env, h, state, p.id, by).catch(() => {});
  return { ok: report.ok, problems: problems.length };
}

// What the run's summary in the homes says of a failure: never a file's name or R2 key
// The run's summary as it's written to the homes (in plain, for the watchdog and whoever restores): counts, kinds
// and words of SOARD's own, never a file's id, key or name, nor the details of an error, which can carry one
const forHomes = (s, plainProblems) => ({
  run: s.run, started: s.started, finished: s.finished, ok: s.ok, key: s.key,
  problems: plainProblems, problemKinds: s.problemKinds, notes: s.notes.length,
  databases: (s.databases || []).filter(Boolean).map((d) => ({ name: d.name, tables: d.tables, rows: d.rows, bytes: d.bytes, attempts: d.attempts })),
  settings: s.settings ? { zones: s.settings.zones, records: s.settings.records, notRead: (s.settings.notRead || []).length } : null,
  code: (s.code || []).filter(Boolean).map((c) => ({ repo: c.repo, full: c.full ?? null, unchanged: !!c.unchanged })),
  listed: Object.fromEntries(Object.entries(s.listed || {}).map(([k, v]) => [k, { found: v?.found ?? null, listed: !v?.error }])),
  files: s.files || null, failures: s.failures.length, waitingToShip: s.waitingToShip, homes: s.homes, drill: s.drill && typeof s.drill === 'object' ? { ok: s.drill.ok } : null, counts: s.counts,
});

/**
 * The run's summary, from everything its steps left: `problems` is everything that isn't right, and ok means there
 * are none. It's kept first (Automations, the site's alert), then written to the homes as the run's last file.
 */
/** A setup problem's kind: its home and what's wrong, without the details or numbers that change from day to day */
export const setupKind = (p) => `setup:${p.home}:${String(p.why).split(':')[0].replace(/\d+/g, '#')}`;

export async function finishJob(env, state, h, run, sections, { by, now = Date.now() } = {}) {
  // Each problem has a kind that stays the same while the trouble does (the site alerts once per kind)
  // and `plain`, the words written to the homes, which never carry an error's details
  const problems = [];
  const add = (kind, text, plain = text) => { if (!problems.some((p) => p.kind === kind)) problems.push({ kind, text, plain }); };
  const notes = [];
  for (const e of sections.errors || []) add(`step:${e.step.replace(/\d+/g, '#')}`, `${e.step} didn’t finish: ${e.error}`, `${e.step} didn’t finish`);
  for (const [source, l] of Object.entries(sections.listed || {})) if (l?.error) add(`list:${source}`, `${source} couldn’t be listed: ${l.error}`, `${source} couldn’t be listed`);
  if (sections.files?.left) add('files-left', `${sections.files.left} file(s) still to copy`);
  if (sections.files?.noHome) add('files-no-home', 'no home took a single copy for three batches in a row, so the run stopped copying files; the next run carries on');
  const failures = await state.failures(run, 50);
  let failed = 0;
  for (const f of failures) {
    // A video waiting on its MP4 (the site asks Stream for one) is a problem only once it has waited a day and a half
    if (f.source === 'videos' && /no MP4|signing key/.test(f.error) && now - Date.parse(f.first_failed || new Date(now).toISOString()) < 36 * HOUR) { notes.push(`video ${f.key} is waiting for ${/no MP4/.test(f.error) ? 'Stream’s MP4' : 'a Stream signing key'}`); continue; }
    failed++;
  }
  // One line however many (each one, and why, is in the run's failures)
  if (failed) add('files-failed', `${failed === 50 ? '50 or more files' : failed === 1 ? '1 file' : `${failed} files`} couldn’t be copied (the run’s summary lists each one and why)`);
  const needs = (await state.get('needs')) || {};
  if (needs.notReady?.length) notes.push(`${needs.notReady.length} video(s) not ready in Stream yet`);
  for (const d of (sections.databases || []).filter((x) => x?.slow)) notes.push(`${d.name} took ${Math.round(d.readMs / 1000)} s to read; the quiet time it must fit in is about 35 s`);
  const waitingToShip = await state.unshippedCount();
  // A home that's set up and answers but refused copies this run (full, a key that lost its rights, Google refusing)
  const refused = (await state.get('shipTrouble')) || {};
  // Backblaze couldn't give back a copy to send to Drive again (it couldn't be read, or isn't what was sent)
  if (refused.restage && (await state.missingHome('drive', refused.restage.ids || []))) add('restage', `Backblaze couldn’t give back a copy to send to Google Drive again: ${refused.restage.error}`, 'Backblaze couldn’t give back a copy to send to Google Drive again');
  for (const [home, t] of Object.entries(refused)) {
    if (home === 'restage') continue;
    const name = home === 'b2' ? 'Backblaze' : 'Google Drive';
    // Only while a copy it refused still lacks it: a home that refused once and then took the copy isn't trouble
    if (h[home] && (await state.missingHome(home, t.ids || []))) add(`ship:${home}`, `${name} refused copies this run: ${t.error}`, `${name} refused copies this run`);
  }
  const stuck = await state.unshippedSince(new Date(now - 24 * HOUR).toISOString());
  if (!h.drive) add('home:drive', 'Google Drive isn’t set up or can’t be reached');
  if (!h.b2) add('home:b2', 'Backblaze isn’t set up or can’t be reached');
  // A copy made today may only be on its way (its send cut off, tried again after its 30 minutes); one a day old is stuck
  if (stuck && h.drive && h.b2) add('waiting-to-ship', `${stuck} cop${stuck === 1 ? 'y has' : 'ies have'} been waiting more than a day to reach both homes`);
  else if (waitingToShip && h.drive && h.b2) notes.push(`${waitingToShip} cop${waitingToShip === 1 ? 'y is' : 'ies are'} still on the way to both homes`);
  if (sections.drill?.ok === false) add('drill', `the restore drill found problems (${sections.drill.problems})`);
  // Someone deleted or trashed backup files in the drive: they're sent again, and it's said
  if (sections.audit?.lost) add('drive-lost', `${sections.audit.lost} cop${sections.audit.lost === 1 ? 'y was' : 'ies were'} gone from Google Drive (deleted, or put in the trash) and ${sections.audit.lost === 1 ? 'is' : 'are'} being sent there again from Backblaze`);
  const setup = (await state.get('setup')) || {};
  for (const p of setup.problems || []) add(setupKind(p), p.why);
  if (sections.settings?.notRead?.length) add('settings-not-read', `the read-only key couldn’t read ${sections.settings.notRead.length} of Cloudflare’s settings (${sections.settings.notRead.slice(0, 3).join('; ')}): add those permissions to it`);
  const summary = {
    run, finished: new Date(now).toISOString(), ...sections, failures, waitingToShip, counts: await state.counts(), key: (await state.publicKey()).fingerprint,
    homes: { drive: !!h.drive, b2: !!h.b2 }, problems: problems.map((p) => p.text), problemKinds: problems.map((p) => p.kind), notes,
  };
  const plainProblems = problems.map((p) => p.plain);
  summary.ok = !summary.problems.length;
  await state.set('night', summary);
  const p = await stagePlain(env, state, { id: `night:${run}`, kind: 'night', run, path: `Nights/${year(run)}/${run}.json`, bytes: enc.encode(JSON.stringify(forHomes(summary, plainProblems), null, 1)) });
  await ship(env, h, state, p.id, by).catch(() => {}); // kept and waiting to ship if a home is down: the next run sends it
  return { ok: summary.ok, problems: summary.problems.length };
}

export { DriveError, B2Error };
