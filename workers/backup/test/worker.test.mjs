/**
 * soard-backup end to end, in Cloudflare's own runtime (Miniflare: the real Workflow engine, Durable Object,
 * R2, D1 and service binding), against a strict fake of everything outside it (./fake-world.mjs, with real git
 * behind GitHub). The backup is reached only as the website reaches it: a second Worker built from the site's own
 * functions/api/_backup.js, bound to the backup's BackupAPI entrypoint.
 *   1. everything is copied into both homes; every copy is opened with the key and compared with what it came
 *      from, byte for byte: databases (restored and every table compared), photos, videos, R2 files, the code
 *      (cloned and checked by git), the settings; the restore drill passes. The private video and the video with
 *      no MP4 wait, and the site's upkeep hands over a Stream signing key and asks Stream for the MP4.
 *   2. with trouble on purpose: the site writes during the database read, Google drops pieces and keeps one
 *      damaged copy, Backblaze is busy for a part, a file changes, a photo is added, the code moves on. Only
 *      what's new is copied, nothing is lost, the backup deletes nothing, and the MP4 the site made goes again.
 *   cd workers/backup && npm test
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, chmodSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { generateKeyPairSync, randomBytes, createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { Decrypter } from 'age-encryption';
import { createWorld, ACCT } from './fake-world.mjs';
import { readDatabase } from '../src/db.js';
import { CODE_STEPS } from '../src/readme.js';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = 'soard-test/site';
const N1 = '2026-11-14';
const N2 = '2026-11-15';
const N3 = '2026-11-16';
const N4 = '2026-11-17';
const N5 = '2026-11-18';
const N6 = '2026-11-19';
const N7 = '2026-11-20';
const N8 = '2026-11-21';
const N9 = '2026-11-22';
const N10 = '2026-11-23';
const N11 = '2026-11-24';
const N12 = '2026-11-25';
const N13 = '2026-11-26';
const N14 = '2026-11-27';
const tmp = mkdtempSync(join(tmpdir(), 'soard-backup-test-'));
const gitDir = join(tmp, 'repo');
const git = (...a) => execFileSync('git', ['-C', gitDir, ...a], { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.org', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.org' } }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const md5 = (b) => createHash('md5').update(b).digest('hex');
const codeOf = (source, key, version) => createHash('sha256').update(`${source}|${key}|${version}`).digest('hex').slice(0, 32);
const photoPath = (im, ext = 'jpg') => `Files/Photos/${codeOf('images', im.id, im.uploaded)}.${ext}.age`;
const videoPath = (uid) => `Files/Videos/${codeOf('videos', uid, '2026-01-01T00:00:00Z')}.mp4.age`;
const photoCount = () => [...world.drive.files.values()].filter((f) => /^[0-9a-f]{32}\.(jpg|png)\.age$/.test(f.name)).length;
// Nothing in the homes may say whose a file is: not in a name, not in a file left in plain
const SECRETS = ['sample-kid', 'sample-staffer', 'kids/', 'team/', 'photo one', 'vendor.pdf', 'Reveal one', 'Private one', 'Sample kid before'];
function noNames(where, text) { for (const x of SECRETS) assert.equal(text.includes(x), false, `${where} doesn’t say “${x}”`); }

let world;
let mf;
let identity;
let streamSecret;

const local = (db) => ({ bookmark: async () => 'local', batch: async (stmts) => stmts.map(({ sql, params = [] }) => db.prepare(sql).all(...params).map((r) => Object.values(r))) });
async function open(bytes) {
  const d = new Decrypter();
  d.addIdentity(identity);
  return Buffer.from(await d.decrypt(new Uint8Array(bytes)));
}
const only = (path) => { const f = world.driveFile(path); assert.ok(f?.length, `${path} is in Google Drive`); return f[f.length - 1]; };
const twin = (path) => { const f = world.b2File(path); assert.equal(f.length, 1, `${path} is in Backblaze once`); return f[0]; };
// The site, as the admin and its minute jobs use it
const site = async (path, body = {}) => {
  const res = await mf.dispatchFetch(`http://site${path}`, { method: 'POST', body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data;
};
const call = async (method, arg) => (await site('/call', { method, arg })).value;

const gz = async (path) => gunzipSync(await open(only(path).bytes));
// The newest manifest in a folder of the homes, as a person restoring would pick it
const newestManifest = (folder) => {
  // (the one written last, as the READ ME says: not the last by name, as a by-hand run's sorts before its night's)
  const all = [...world.drive.files.values()].filter((f) => !f.trashed && / manifest( \d+)?\.json$/.test(f.name) && world.driveFile(`${folder}/${f.name}`)).map((f) => JSON.parse(f.bytes));
  assert.ok(all.length, `a manifest in ${folder}`);
  return all.sort((a, b) => a.written.localeCompare(b.written)).at(-1);
};
// The KV namespace, the search index and the Workers' code as the run left them: each put back the way the READ ME
// says (the KV parts through the restore tool), and compared with the account
async function checkAccount(run, s) {
  // KV: the manifest names the file of each part; together they're every key, as `wrangler kv bulk put` takes them
  const ns = world.kv[0];
  const manifest = newestManifest('KV/DEVICES/2026');
  assert.equal(manifest.run, run);
  noNames('the KV manifest', JSON.stringify(manifest));
  assert.equal(manifest.parts.length, Math.ceil(ns.keys.size / 3));
  assert.equal(manifest.keys, ns.keys.size);
  const put = [];
  for (const p of manifest.parts) {
    const local = join(tmp, p.file.split('/').pop());
    writeFileSync(local, only(p.file).bytes);
    execFileSync('node', [join(here, '../scripts/restore.mjs'), 'kv', local, '--key', join(tmp, 'key.txt')], { stdio: 'ignore' });
    const ready = JSON.parse(readFileSync(local.replace(/\.json\.gz\.age$/, ' ready.json')));
    assert.equal(createHash('sha256').update(await open(only(p.file).bytes)).digest('hex'), p.openedSha256, 'the part is the one the manifest names');
    put.push(...ready);
  }
  assert.deepEqual(put.map((x) => x.key), [...ns.keys.keys()].sort(), 'every key, in order');
  for (const x of put) {
    const k = ns.keys.get(x.key);
    assert.equal(x.base64, true);
    assert.ok(Buffer.from(x.value, 'base64').equals(k.value), `${x.key}: its value, byte for byte`);
    assert.equal(x.expiration ?? null, k.expiration ?? null);
    assert.deepEqual(x.metadata ?? null, k.metadata ?? null);
  }
  // Vectorize: the manifest names the index's size, measure, metadata indexes and every file; every vector, whole
  const ix = world.vectorize[0];
  const vm = newestManifest('Vectorize/product-catalog/2026');
  assert.deepEqual([vm.dimensions, vm.metric, vm.vectors], [ix.dimensions, ix.metric, ix.vectors.size]);
  assert.deepEqual(vm.metadataIndexes, ix.metadataIndexes || []);
  const lines = [];
  for (const p of vm.parts) lines.push(...(await gz(p.file)).toString().trim().split('\n').map((l) => JSON.parse(l)));
  assert.deepEqual(lines, [...ix.vectors.keys()].sort().map((id) => ({ id, ...ix.vectors.get(id) })), 'every vector exactly');
  // Workers: the restore tool splits the code back into each file, as it ran; the .json beside it names the main module
  for (const wk of world.workers) {
    const newest = [...world.drive.files.values()].filter((f) => f.name.includes(` ${wk.name} code (`) && f.name.endsWith(').age') && !f.trashed).map((f) => f.name).sort().at(-1);
    if (!wk.files) { assert.equal(newest, undefined, `${wk.name} has no code of its own to copy`); continue; }
    assert.ok(newest, `${wk.name}’s code is copied`);
    const info = JSON.parse(only(`Workers/${wk.name}/2026/${newest.replace(/\.age$/, '.json')}`).bytes);
    assert.equal(info.mainModule, wk.oneFile ? 'index.js' : wk.main || wk.files[0].name);
    const code = join(tmp, `${wk.name}-${run}.code`);
    writeFileSync(code, await open(only(`Workers/${wk.name}/2026/${newest}`).bytes));
    const back = join(tmp, `${wk.name}-${run}`);
    execFileSync('node', [join(here, '../scripts/restore.mjs'), 'worker', code, back], { stdio: 'ignore' });
    for (const f of wk.files) assert.ok(readFileSync(join(back, wk.oneFile ? 'index.js' : f.name)).equals(f.bytes), `${wk.name}/${f.name} back exactly`);
  }
  assert.ok(s.night.kv.every((k) => k.ok) && s.night.vectorize.every((v) => v.ok), JSON.stringify([s.night.kv, s.night.vectorize]));
}

async function runNight(run) {
  const r = await call('run', { by: 'test', run, drill: true });
  assert.ok(r.started, JSON.stringify(r));
  // Never two runs at once: "Back up now" while one is going is refused
  const again = await call('run', { by: 'test' });
  assert.equal(again.started, false);
  assert.match(again.why, /running now/);
  for (let i = 0; i < 1500; i++) {
    const s = await call('status');
    if (s.started?.id === r.id && ['complete', 'errored', 'terminated'].includes(s.started.status)) return s;
    await sleep(200);
  }
  throw new Error('the run never finished');
}

before(async () => {
  // A real repo: two commits, a branch and a tag
  execFileSync('git', ['init', '-q', '-b', 'main', gitDir]);
  writeFileSync(join(gitDir, 'index.html'), '<h1>SOARD</h1>\n');
  git('add', '.'); git('commit', '-q', '-m', 'first');
  writeFileSync(join(gitDir, 'about.html'), '<p>about</p>\n');
  git('add', '.'); git('commit', '-q', '-m', 'second');
  git('tag', 'v1'); git('branch', 'feature');

  const stream = generateKeyPairSync('rsa', { modulusLength: 2048 });
  streamSecret = stream.privateKey.export({ format: 'jwk' }).d;
  world = createWorld({ gitDir, repo: REPO, streamPublicJwk: stream.publicKey.export({ format: 'jwk' }), streamPrivateJwk: stream.privateKey.export({ format: 'jwk' }) });

  // The site's database: every hard case, plus tables that point at each other
  const db1 = world.addDb('site-db');
  db1.exec(`
    CREATE TABLE t_none (k INTEGER PRIMARY KEY, v);
    CREATE TABLE t_real (k INTEGER PRIMARY KEY, v REAL);
    CREATE TABLE t_strict (k INTEGER PRIMARY KEY, v ANY) STRICT;
    CREATE TABLE "we""ird name" ("col ""q""" TEXT, [b r] INTEGER, \`c\` BLOB);
    CREATE TABLE t_big (k INTEGER PRIMARY KEY, v TEXT CHECK (length(v) > 100000), w BLOB);
    CREATE TABLE t_norowid (a TEXT PRIMARY KEY, b) WITHOUT ROWID;
    CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent(id), note TEXT);
    CREATE TABLE parent (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE t_auto (k INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT);
    CREATE TABLE t_rowid (name TEXT, rowid_is_a_column INTEGER);
    CREATE TABLE t_hidden (a TEXT);
    CREATE INDEX t_none_v ON t_none (v);
    CREATE VIEW v_none AS SELECT k, v FROM t_none;
    CREATE VIEW v_parent AS SELECT id, name FROM parent;
    CREATE TRIGGER t_auto_trig AFTER INSERT ON t_auto BEGIN UPDATE t_auto SET v = v || ';' WHERE k = NEW.k AND 0; END;
    CREATE TRIGGER v_parent_add INSTEAD OF INSERT ON v_parent BEGIN INSERT INTO parent VALUES (NEW.id, CASE WHEN NEW.name IS NULL THEN 'none; at all' ELSE NEW.name END); END;
  `);
  const vals = ['1.0', '1152921504606846976', '9007199254740993', '-9223372036854775808', '9223372036854775807', '0.1', '5e-324', '1.7976931348623157e308', '9e999', '-9e999', "CAST(X'61006200' AS TEXT)", "'a' || char(13) || char(10) || 'b'", "'it''s 😀'", "X'00FF'", "''", "X''", 'NULL', "'back\\nslash'", "CAST(X'FF41' AS TEXT)"];
  vals.forEach((v, i) => { db1.exec(`INSERT INTO t_none VALUES (${i + 1}, ${v})`); db1.exec(`INSERT INTO t_strict VALUES (${i + 1}, ${v})`); });
  db1.exec("INSERT INTO t_real VALUES (1, 1.0), (2, 1152921504606846976), (3, 0.1); INSERT INTO \"we\"\"ird name\" VALUES ('q''uote', 3, X'0102'), ('gone', 4, NULL), ('kept', 5, NULL); DELETE FROM \"we\"\"ird name\" WHERE \"col \"\"q\"\"\" = 'gone';");
  db1.exec("INSERT INTO t_big VALUES (1, hex(randomblob(60000)) || char(0) || 'end' || char(13), randomblob(300000)), (2, replace(hex(zeroblob(120000)), '00', 'é'), NULL)");
  db1.exec("INSERT INTO t_norowid VALUES ('b', 2.0), ('a', 1152921504606846977); INSERT INTO parent VALUES (1, 'p'); INSERT INTO child VALUES (1, 1, 'c'); INSERT INTO t_auto (v) VALUES ('one'), ('two'); DELETE FROM t_auto WHERE v = 'two';");
  // Rowids with gaps, in a table with no INTEGER PRIMARY KEY: a restore must keep them, not renumber
  db1.exec("INSERT INTO t_hidden (rowid, a) VALUES (5, 'five'), (90, 'ninety'), (7, 'seven'); INSERT INTO t_rowid VALUES ('x', 1); INSERT INTO v_parent (id, name) VALUES (3, NULL);");
  const store = world.addDb('store-db');
  store.exec("CREATE TABLE staff (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT); CREATE TABLE shifts (id INTEGER PRIMARY KEY, staff_id INTEGER REFERENCES staff(id)); INSERT INTO staff (name) VALUES ('A'), ('B'); INSERT INTO shifts VALUES (1, 2);");

  // Shaped like the real ones: an image id can carry a kid's or a staff member's name
  world.images = [
    { id: 'kids/sample-kid/before-1', filename: 'Sample kid before.jpg', uploaded: '2026-01-01T00:00:00Z', bytes: randomBytes(50_000) },
    { id: 'team/sample-staffer/headshot', filename: 'Staffer.jpg', uploaded: '2026-01-01T00:00:00Z', bytes: randomBytes(50_000) },
    { id: 'img-3', filename: 'photo 3.jpg', uploaded: '2026-01-01T00:00:00Z', bytes: randomBytes(50_000) },
  ];
  world.videos = [
    { uid: 'v1', name: 'Reveal one.mp4', private: false, download: 'ready', bytes: randomBytes(300_000) },
    { uid: 'v2', name: 'Private one', private: true, download: 'ready', bytes: randomBytes(200_000) },
    { uid: 'v3', name: 'No MP4 yet', private: false, download: null, bytes: randomBytes(1000) },
    { uid: 'v4', name: 'Still processing', private: false, download: null, state: 'inprogress', bytes: randomBytes(1000) },
  ];
  // The rest of the account, shaped like SOARD's: the backup's own spare database (never copied), a KV namespace,
  // the store's search index, Workers (one with a binary module) and the Durable Objects on the list
  world.addDb('drill-db');
  world.kv.push({ id: 'kv1', title: 'DEVICES', keys: new Map([
    ['a/b c ü', { value: Buffer.from('plain text') }],
    ['binary', { value: randomBytes(2000) }],
    ['with-meta', { value: Buffer.from('{"x":1}'), metadata: { by: 'test', n: 2 } }],
    ['expiring', { value: Buffer.from('soon'), expiration: 4102444800 }],
    ['sample-kid-session', { value: Buffer.from('a session') }],
  ]) });
  const ix = { name: 'product-catalog', dimensions: 4, metric: 'cosine', mutation: null, vectors: new Map(), metadataIndexes: [{ propertyName: 'price', indexType: 'number' }] };
  world.vectorize.push(ix);
  for (let i = 1; i <= 5; i++) world.setVector(ix, `prod-${i}`, { values: [i / 10, -0.5, 1e-7, 0.123456789], ...(i === 2 ? { metadata: { title: 'Plush', price: 25 } } : {}), ...(i === 3 ? { namespace: 'store' } : {}) });
  world.workers.push(
    { name: 'soard-live-hub', modified: '2026-11-01T00:00:00Z', files: [{ name: 'index.js', type: 'application/javascript+module', bytes: Buffer.from('export default { fetch() { return new Response("hub"); } };\n') }, { name: 'lib/codec.wasm', type: 'application/wasm', bytes: randomBytes(3000) }] },
    { name: 'shop-redirect', modified: '2026-10-01T00:00:00Z', main: 'worker.js', files: [{ name: 'worker.js', type: 'application/javascript+module', bytes: Buffer.from('export default {};\n') }] },
    { name: 'static-site', modified: '2026-10-01T00:00:00Z', files: null },
    { name: 'old-style', modified: '2026-09-01T00:00:00Z', oneFile: true, files: [{ name: 'index.js', type: 'application/javascript', bytes: Buffer.from('addEventListener("fetch", (e) => e.respondWith(new Response("old")));\n') }] },
  );
  world.cors = { 'soard-files': { rules: [{ allowed: { origins: ['https://example.org'], methods: ['GET'] } }] } };
  world.durableObjects.push({ script: 'soard-backup', class: 'BackupState', id: 'do1' }, { script: 'soard-live-hub', class: 'LiveHub', id: 'do2' });
  const obj = (bytes) => ({ bytes, etag: md5(bytes), last_modified: '2026-01-01T00:00:00Z' });
  world.buckets['soard-files'] = new Map([['a.txt', obj(Buffer.from('first'))], ['kids/photo one.jpg', obj(randomBytes(100_000))], ['big/video.mov', obj(randomBytes(20 * 1024 * 1024 + 123))]]);
  world.buckets['soard-vendor-docs'] = new Map([['w9/vendor.pdf', obj(randomBytes(10_000))]]);

  const google = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const out = join(tmp, 'worker.js');
  const opts = { bundle: true, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], external: ['cloudflare:workers', 'node:*'], logLevel: 'warning' };
  await build({ ...opts, entryPoints: [join(here, '../src/index.js')], outfile: out });
  // The website's side, from its own file
  const siteEntry = join(tmp, 'site-entry.js');
  writeFileSync(siteEntry, `import { backupFacts, maybeBackupChores, askBackup } from ${JSON.stringify(join(here, '../../../functions/api/_backup.js'))};
export default {
  async fetch(request, env) {
    const u = new URL(request.url);
    const body = await request.json().catch(() => ({}));
    try {
      if (u.pathname === '/facts') return Response.json(await backupFacts(env));
      if (u.pathname === '/chores') { const alerts = []; const r = await maybeBackupChores(env, { now: body.now, alert: async (c) => { alerts.push(c); } }); return Response.json({ r, alerts }); }
      if (u.pathname === '/call') return Response.json({ value: (await askBackup(env, body.method, body.arg)) ?? null });
      return Response.json({ error: 'no' }, { status: 404 });
    } catch (e) { return Response.json({ error: String(e.message) }, { status: 500 }); }
  },
};`);
  const siteOut = join(tmp, 'site.js');
  await build({ ...opts, entryPoints: [siteEntry], outfile: siteOut });
  const common = { modules: true, modulesRoot: tmp, compatibilityDate: '2026-05-01', compatibilityFlags: ['nodejs_compat'], outboundService: (request) => world.handle(request) };
  mf = new Miniflare({
    workers: [
      { ...common, name: 'site', scriptPath: siteOut, d1Databases: { DB: 'site-config' }, serviceBindings: { BACKUP: { name: 'backup', entrypoint: 'BackupAPI' } }, bindings: { CF_ACCOUNT_ID: ACCT, CF_STREAM_TOKEN: 'site-stream-key' } },
      {
        ...common,
        name: 'backup',
        scriptPath: out,
        durableObjects: { STATE: { className: 'BackupState', useSQLite: true } },
        workflows: { NIGHT: { name: 'soard-backup-night', className: 'Night' } },
        r2Buckets: ['STAGING'],
        d1Databases: { DRILL: 'drill-db' },
        bindings: {
          TEST_MODE: '1', CF_ACCOUNT_ID: ACCT, API_PACE_MS: '0', STEP_DELAY: '1 second', AUDIT_SETTLE_MS: '0',
          DRILL_DATABASE: 'drill-db', STAGING_BUCKET: 'backup-staging', KV_PART_KEYS: '3', VECTORIZE_PART: '3',
          DATABASES: JSON.stringify([{ name: 'site-db', id: 'site-db', label: 'Test site', quiet: false }, { name: 'store-db', id: 'store-db', label: 'Test store', quiet: false }]),
          REPOS: JSON.stringify([REPO]), R2_BUCKETS: JSON.stringify(['soard-files', 'soard-vendor-docs']),
          CF_BACKUP_TOKEN: 'cf-read-key', B2_KEY_ID: 'b2-key-id', B2_APPLICATION_KEY: 'b2-app-key', GITHUB_BACKUP_TOKEN: 'gh-read-key',
          GOOGLE_BACKUP_KEY: JSON.stringify({ type: 'service_account', client_email: 'backup@soard-test.iam.gserviceaccount.com', private_key: google.privateKey.export({ type: 'pkcs8', format: 'pem' }) }),
        },
      },
    ],
  });
  await (await mf.getD1Database('DB', 'site')).exec('CREATE TABLE site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)');
  identity = (await call('recoverySheet', { by: 'test' })).identity;
});

after(async () => {
  await mf?.dispose();
  rmSync(tmp, { recursive: true, force: true });
});

test('one door: the site’s binding; the backup’s own address answers nothing, and who asks is always named', async () => {
  const backup = await mf.getWorker('backup');
  assert.equal((await backup.fetch('http://soard-backup/status')).status, 404);
  assert.equal((await backup.fetch('http://soard-backup/recovery-sheet', { method: 'POST' })).status, 404);
  await assert.rejects(call('run', {}), /who asked is needed/);
  await assert.rejects(call('recoverySheet', {}), /who asked is needed/);
  // Before the first listing nothing is known to need a Stream key
  assert.deepEqual(await call('needs'), { streamKey: false, videos: [] });
});

test('setup check: every piece found, the READ ME written, only the recovery sheet left to print', async () => {
  // Before the watchdog in Google is set up, that's a step left too
  assert.deepEqual((await call('check')).problems.map((p) => p.home).sort(), ['key', 'watchdog']);
  world.drive.files.set('note1', { id: 'note1', name: 'Watchdog - last check.txt', parents: ['shared1'], mimeType: 'text/plain', bytes: Buffer.from('ok'), modifiedTime: new Date().toISOString() });
  const s = await call('check');
  assert.equal(s.ready, true);
  assert.equal(s.google.drive, 'Website backup');
  assert.equal(s.google.canDelete, false);
  assert.deepEqual({ on: s.b2.lock.on, mode: s.b2.lock.mode, days: s.b2.lock.days }, { on: true, mode: 'compliance', days: 90 });
  assert.equal(s.b2.canDelete, false);
  assert.equal(s.cloudflare.ok, true);
  assert.deepEqual(s.problems.map((p) => p.home), ['key']);
  assert.match(s.problems[0].why, /only copy of the key that opens every backup is inside Cloudflare/);
  assert.match(identity, /^AGE-SECRET-KEY-PQ-1/);
  const readme = only('READ ME FIRST - how to restore.txt').bytes.toString();
  assert.match(readme, new RegExp(s.key.fingerprint));
  assert.equal(twin('READ ME FIRST - how to restore.txt').bytes.toString(), readme.replace('This drive', 'This bucket'));
  for (const line of CODE_STEPS) assert.ok(readme.includes(line), `the READ ME gives: ${line}`);
  // What the admin reads never carries the key
  const facts = await site('/facts');
  assert.equal(facts.reachable, true);
  assert.equal(JSON.stringify(facts).includes('AGE-SECRET-KEY'), false);
  assert.equal(facts.recovery.shown.length, 1);
  assert.equal(facts.recovery.shown[0].by, 'test');
  // Printed: the sheet is for this very key, and nothing is left
  const printed = await call('recoveryPrinted', { by: 'test' });
  assert.equal(printed.printed.fingerprint, s.key.fingerprint);
  const after = await call('status');
  assert.deepEqual(after.setup.problems, [], 'printing it is seen at once, not after the next run');
  assert.ok(after.setUpAt, 'set up: from now on trouble is alerted');
});

test('night 1: everything is in both homes, and every copy opens to exactly what it came from', async () => {
  const s = await runNight(N1);
  assert.equal(s.started.status, 'complete');
  assert.equal(s.night.ok, true, JSON.stringify(s.night.problems));
  // The private video waits for a signing key, the one with no MP4 waits for it; the one Stream is still making isn't listed
  assert.deepEqual(s.night.failures.map((f) => f.key).sort(), ['v2', 'v3']);
  assert.deepEqual(s.needs.notReady, ['v4']);
  assert.ok(s.night.notes.includes('video v3 is waiting for Stream’s MP4') && s.night.notes.includes('video v2 is waiting for a Stream signing key'), JSON.stringify(s.night.notes));
  assert.deepEqual(await call('needs'), { streamKey: true, videos: ['v3'] }, 'the site is asked for exactly what’s missing');
  assert.equal(s.night.waitingToShip, 0);
  assert.equal(world.deletes.length, 0, 'the backup never deletes anything');
  assert.equal((await (await mf.getR2Bucket('STAGING', 'backup')).list()).objects.length, 0, 'every staged copy left once it was in both homes');

  // Every file in Drive has its twin in Backblaze, byte for byte
  // (the watchdog's note is the watchdog's, not a copy)
  const files = [...world.drive.files.values()].filter((f) => f.bytes && f.name !== 'Watchdog - last check.txt');
  for (const f of world.b2.files.filter((x) => !x.fileName.startsWith('READ ME'))) assert.ok(files.some((d) => d.name === f.fileName.split('/').pop() && d.bytes.equals(f.bytes)), `${f.fileName} is the same in both homes`);
  assert.equal(world.b2.files.length, files.length);

  // The databases: opened, restored, every table compared with the source
  for (const db of ['site-db', 'store-db']) {
    const path = `Database/${db}/2026/${N1} ${db}.sql.gz.age`;
    const sql = gunzipSync(await open(only(path).bytes));
    const restored = new DatabaseSync(':memory:');
    restored.exec(sql.toString('utf8'));
    const want = await readDatabase(local(world.dbs[db].db));
    const got = await readDatabase(local(restored));
    assert.deepEqual(got.tables, want.tables, `${db}: every table back exactly`);
    assert.deepEqual(got.objects, want.objects);
    const manifest = JSON.parse(only(`Database/${db}/2026/${N1} ${db} manifest.json`).bytes);
    assert.deepEqual(manifest.tables, want.tables);
    assert.equal(manifest.bookmark, `bm-${world.dbs[db].bookmark}`);
    if (db === 'site-db') {
      assert.deepEqual(restored.prepare('SELECT rowid AS r, a FROM t_hidden ORDER BY rowid').all().map((r) => [r.r, r.a]), [[5, 'five'], [7, 'seven'], [90, 'ninety']], 'rowids kept, gaps and all');
      restored.exec("INSERT INTO v_parent (id, name) VALUES (9, NULL)");
      assert.equal(restored.prepare('SELECT name FROM parent WHERE id = 9').get().name, 'none; at all', 'the INSTEAD OF trigger came back whole');
      assert.ok(sql.includes(Buffer.from('_restore_big')), 'the big rows went through the holding table');
    }
  }
  // The restore tool, on the real copy and manifest as they'd be downloaded
  const dl = join(tmp, 'download');
  mkdirSync(dl, { recursive: true });
  writeFileSync(join(dl, `${N1} site-db.sql.gz.age`), only(`Database/site-db/2026/${N1} site-db.sql.gz.age`).bytes);
  writeFileSync(join(dl, `${N1} site-db manifest.json`), only(`Database/site-db/2026/${N1} site-db manifest.json`).bytes);
  writeFileSync(join(tmp, 'key.txt'), `# the recovery sheet, typed in with its line breaks\n${identity.slice(0, 40)}\n${identity.slice(40)}\n`);
  const said = execFileSync('node', [join(here, '../scripts/restore.mjs'), 'database', dl, '--key', join(tmp, 'key.txt'), '--check'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  assert.match(said, new RegExp(`the run of ${N1}: the copy matches its manifest`));
  assert.match(said, /every one of the \d+ tables is exactly as copied/);
  // And the READ ME's own database step, with the real age tool when it's installed: the same SQL as the tool wrote
  if (spawnSync('age', ['--version']).status === 0) {
    // (the key typed all on one line, as the READ ME says: age reads it so)
    writeFileSync(join(dl, 'key.txt'), `${identity}\n`);
    execFileSync('sh', ['-c', `age -d -i key.txt "${N1} site-db.sql.gz.age" | gunzip > readme-restore.sql`], { cwd: dl });
    assert.ok(readFileSync(join(dl, 'readme-restore.sql')).equals(readFileSync(join(dl, `${N1} site-db restore.sql`))), 'the READ ME’s age step gives the very SQL the tool gives');
  }

  // Photos, videos, R2 files, under codes, never ids or names
  for (const im of world.images) assert.ok((await open(only(photoPath(im)).bytes)).equals(im.bytes));
  assert.ok((await open(only(videoPath('v1')).bytes)).equals(world.videos[0].bytes));
  for (const [bucket, objs] of Object.entries(world.buckets)) {
    for (const [key, o] of objs) assert.ok((await open(only(`Files/${bucket}/${codeOf(`r2:${bucket}`, key, o.etag)}.age`).bytes)).equals(o.bytes), `${bucket}/${key}`);
  }
  assert.ok(twin(`Files/soard-files/${codeOf('r2:soard-files', 'big/video.mov', world.buckets['soard-files'].get('big/video.mov').etag)}.age`).fileId.startsWith('large'), 'a big file went to Backblaze in parts');
  noNames('a name in Google Drive', [...world.drive.files.values()].map((f) => `${f.name} ${f.description || ''}`).join('\n'));
  noNames('a name in Backblaze', world.b2.files.map((f) => f.fileName).join('\n'));

  // The code: cloned from the bundle and checked by git
  const bundle = world.b2.files.find((f) => f.fileName.startsWith('Code/site/2026/') && f.fileName.includes(' full '));
  writeFileSync(join(tmp, 'n1.bundle'), await open(bundle.bytes));
  execFileSync('git', ['clone', '-q', join(tmp, 'n1.bundle'), join(tmp, 'clone')]);
  execFileSync('git', ['-C', join(tmp, 'clone'), 'fsck', '--full']);
  assert.equal(execFileSync('git', ['-C', join(tmp, 'clone'), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), git('rev-parse', 'HEAD'));
  assert.equal(execFileSync('git', ['-C', join(tmp, 'clone'), 'rev-parse', 'v1'], { encoding: 'utf8' }).trim(), git('rev-parse', 'v1'));

  // Settings, the files list, the run's summary (no names in it), the drill
  const settings = JSON.parse(await open(only(`Cloudflare settings/2026/${N1} cloudflare-settings.json.age`).bytes));
  assert.equal(settings.zones[0].name, 'example.org');
  assert.deepEqual(settings.notRead, [], 'the key read every setting (a bucket with no CORS and no Stream webhook are “none”, not unread)');
  assert.deepEqual(settings.stream.webhook, { none: true });
  assert.deepEqual(settings.r2.find((b) => b.name === 'soard-vendor-docs').cors, { none: true });
  assert.equal(settings.r2.find((b) => b.name === 'soard-files').cors.rules.length, 1);
  assert.deepEqual(settings.stream.liveInputs.map((x) => [x.name, x.recording.mode]), [['Reveals', 'automatic']]);
  assert.deepEqual(settings.pagesDomains, [{ project: 'site', domains: [{ name: 'example.org', status: 'active' }] }]);
  assert.deepEqual(settings.vectorize[0].metadataIndexes, [{ propertyName: 'price', indexType: 'number' }]);
  assert.equal(settings.lists[0].items.length, 3, 'every item of the redirect list, page by page');
  assert.equal(settings.accountRulesets.length, 1, 'the account’s own rule (not Cloudflare’s managed one)');
  assert.deepEqual(settings.notifications.webhooks.map((x) => x.url), ['https://example.org/api/stream-webhook']);
  assert.deepEqual(settings.registrar.map((d) => [d.name, d.expiresAt, d.autoRenew]), [['example.org', '2029-03-14T00:00:00Z', true]]);
  assert.deepEqual(settings.registrar[0], { name: 'example.org', status: 'active', createdAt: '2012-03-14T00:00:00Z', expiresAt: '2029-03-14T00:00:00Z', autoRenew: true, privacyMode: 'redaction', locked: true }, 'only these, never a contact');
  assert.equal(JSON.stringify(settings).includes('never-copied'), false, 'no key, secret or stream key in the settings copy');
  const hub = settings.workers.find((x) => x.name === 'soard-live-hub');
  assert.deepEqual(hub.settings.bindings, [{ type: 'secret_text', name: 'A_KEY' }, { type: 'plain_text', name: 'A_VAR', text: 'shown' }], 'a plain variable keeps its value (to put the Worker back exactly), a key never has one');
  assert.deepEqual(hub.workersDev, { enabled: false, previews_enabled: false });
  assert.match((await open(only(`Cloudflare settings/2026/${N1} example.org DNS records.txt.age`).bytes)).toString(), /192\.0\.2\.1/);
  const list = JSON.parse(gunzipSync(await open(only(`Files/Lists/2026/${N1} files.json.gz.age`).bytes)));
  assert.equal(list.files.filter((f) => f.path).length, 3 + 1 + 4);
  assert.ok(list.files.some((f) => f.name === 'kids/photo one.jpg') && list.files.some((f) => f.key === 'kids/sample-kid/before-1'), 'the encrypted list maps each code back to where it came from');
  const nightFile = only(`Nights/2026/${N1}.json`).bytes.toString();
  assert.equal(JSON.parse(nightFile).run, N1);
  assert.equal(JSON.parse(nightFile).ok, true);
  noNames('the run’s summary', nightFile);
  for (const im of world.images) assert.equal(nightFile.includes(im.id), false, 'the run’s summary names no image');
  noNames('the drill report', only(`Restore drills/2026/${N1} drill.json`).bytes.toString());
  for (const db of ['site-db', 'store-db']) noNames('a manifest', only(`Database/${db}/2026/${N1} ${db} manifest.json`).bytes.toString());
  // The rest of the account, each as the tool that puts it back takes it
  await checkAccount(N1, s);
  const night = JSON.parse(nightFile);
  assert.deepEqual(night.account && { databases: night.account.databases, buckets: night.account.buckets, kv: night.account.kv, vectorize: night.account.vectorize, workers: night.account.workers }, { databases: 2, buckets: 2, kv: 1, vectorize: 1, workers: 4 }, 'the summary says what the account held (the spare database and staging bucket aside)');
  assert.deepEqual(night.workers, { copied: 3, unchanged: 0, noCode: ['static-site'], failed: [] });
  assert.deepEqual(night.notCopied.map((x) => x.what), ['Durable Object BackupState (Worker soard-backup)', 'Durable Object LiveHub (Worker soard-live-hub)'], 'and what needs no copy of its own, each with why');
  assert.ok(night.notCopied.every((x) => x.why.length > 20));
  assert.equal(world.driveFile(`Database/drill-db/2026/${N1} drill-db.sql.gz.age`), null, 'the drill’s spare database isn’t copied');
  const drill = JSON.parse(only(`Restore drills/2026/${N1} drill.json`).bytes);
  assert.equal(drill.ok, true, JSON.stringify(drill.problems));
  assert.deepEqual(drill.databases.map((d) => [d.name, d.different, d.ok]), [['site-db', 0, true], ['store-db', 0, true]]);
  assert.ok(drill.files.checked >= 3 && drill.files.ok === drill.files.checked && drill.code.length === 1 && drill.code[0].ok);
});

test('the site’s upkeep: a Stream signing key (a private video needs one) and the missing MP4, with the site’s own key', async () => {
  const { r, alerts } = await site('/chores', { now: Date.now() });
  assert.deepEqual(alerts, [], 'nothing to alert about');
  assert.ok(r.done.includes('handed the backup a Stream signing key'), JSON.stringify(r.done));
  assert.ok(r.done.includes('asked Stream for an MP4 of video v3'));
  assert.equal(r.choreError, null);
  assert.deepEqual(world.streamKeys, ['kid1']);
  const facts = await site('/facts');
  assert.deepEqual(facts.streamKey.id, 'kid1');
  assert.equal(JSON.stringify(facts).includes(streamSecret), false, 'the signing key itself is never shown');
  assert.equal((await call('needs')).streamKey, false);
});

test('night 2, with trouble: only what changed is copied, nothing is lost or deleted', async () => {
  writeFileSync(join(gitDir, 'new.html'), '<p>new</p>\n');
  git('add', '.'); git('commit', '-q', '-m', 'third');
  git('tag', 'v2');
  world.buckets['soard-files'].set('a.txt', { bytes: Buffer.from('second'), etag: md5(Buffer.from('second')), last_modified: '2026-11-15T00:00:00Z' });
  world.images.push({ id: 'img-4', filename: 'photo 4.png', uploaded: '2026-11-15T00:00:00Z', bytes: randomBytes(40_000) });
  world.videos[3].state = 'ready';
  world.videos[3].download = 'ready';
  world.faults.writeDuringRead = { db: 'site-db', after: 3, sql: "INSERT INTO parent VALUES (2, 'written during the read')" };
  world.faults.corruptDriveOnce = true;
  world.faults.loseDrivePieces = 2;
  world.faults.failB2Parts = 1;
  const photosBefore = photoCount();

  const s = await runNight(N2);
  assert.equal(s.started.status, 'complete');
  assert.equal(s.night.failures.length, 0, JSON.stringify(s.night.failures));
  assert.equal(s.night.waitingToShip, 0);
  assert.equal(s.night.ok, true, JSON.stringify(s.night.problems));
  assert.equal(world.deletes.length, 0);

  // The read that saw the site's write was thrown away; the next one is exact and includes it
  const manifest = JSON.parse(only(`Database/site-db/2026/${N2} site-db manifest.json`).bytes);
  assert.equal(manifest.attempts, 2);
  const dbCopies = world.driveFile(`Database/site-db/2026/${N2} site-db.sql.gz.age`);
  assert.equal(dbCopies.length, 2, 'Google kept a damaged copy (it can’t be deleted), and a good one was made beside it');
  const good = [];
  for (const f of dbCopies) { try { good.push({ f, sql: gunzipSync(await open(f.bytes)) }); } catch { /* the damaged one won't open */ } }
  assert.equal(good.length, 1);
  assert.ok(twin(`Database/site-db/2026/${N2} site-db.sql.gz.age`).bytes.equals(good[0].f.bytes), 'Backblaze has the good copy');
  const restored = new DatabaseSync(':memory:');
  restored.exec(good[0].sql.toString('utf8'));
  assert.deepEqual((await readDatabase(local(restored))).tables, (await readDatabase(local(world.dbs['site-db'].db))).tables);
  assert.ok(good[0].sql.includes(Buffer.from('written during the read')));

  // Only the new photo was copied; the changed file sits beside the old one; the waiting videos arrived
  assert.equal(photoCount(), photosBefore + 1);
  assert.ok((await open(only(photoPath(world.images[3], 'png')).bytes)).equals(world.images[3].bytes));
  assert.equal((await open(only(`Files/soard-files/${codeOf('r2:soard-files', 'a.txt', md5(Buffer.from('second')))}.age`).bytes)).toString(), 'second');
  assert.equal((await open(only(`Files/soard-files/${codeOf('r2:soard-files', 'a.txt', md5(Buffer.from('first')))}.age`).bytes)).toString(), 'first');
  assert.ok((await open(only(videoPath('v2')).bytes)).equals(world.videos[1].bytes), 'the private video, through a link signed with the key the site handed over');
  assert.ok((await open(only(videoPath('v3')).bytes)).equals(world.videos[2].bytes));
  assert.ok((await open(only(videoPath('v4')).bytes)).equals(world.videos[3].bytes));
  assert.deepEqual(await call('needs'), { streamKey: false, videos: [] }, 'nothing left for the site to do');

  // The site's next upkeep: nothing to do, nothing to say, and the MP4s stay (each is as public or private as its video)
  const { alerts } = await site('/chores', { now: Date.now() + 16 * 60_000 });
  assert.deepEqual(alerts, []);
  assert.deepEqual(world.siteDeletes, []);
  assert.equal(world.videos[2].download, 'ready');

  // The code, put back exactly as the READ ME says: with the real age tool when it's installed, else a stand-in
  const realAge = spawnSync('age', ['--version']).status === 0;
  const restore = join(tmp, 'readme-restore');
  mkdirSync(join(restore, 'bin'), { recursive: true });
  writeFileSync(join(restore, 'bin', 'age'), `#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { Decrypter } from ${JSON.stringify(join(here, '../node_modules/age-encryption/dist/index.js'))};
const a = process.argv.slice(2);
if (a[0] !== '-d' || a[1] !== '-i') { console.error('age: only -d -i here'); process.exit(2); }
const d = new Decrypter();
d.addIdentity(readFileSync(a[2], 'utf8').split('\\n').find((l) => l.startsWith('AGE-SECRET-KEY')).trim());
process.stdout.write(Buffer.from(await d.decrypt(readFileSync(a[3]))));
`);
  chmodSync(join(restore, 'bin', 'age'), 0o755);
  writeFileSync(join(restore, 'key.txt'), `${identity}\n`);
  const fullCopy = world.b2.files.find((f) => f.fileName.startsWith(`Code/site/2026/${N1}`) && f.fileName.includes(' full '));
  const newCopy = world.b2.files.find((f) => f.fileName.startsWith(`Code/site/2026/${N2}`));
  assert.ok(newCopy.fileName.includes(' new '), 'night 2 has only what’s new');
  writeFileSync(join(restore, fullCopy.fileName.split('/').pop()), fullCopy.bytes);
  writeFileSync(join(restore, newCopy.fileName.split('/').pop()), newCopy.bytes);
  const stem = (f) => f.fileName.split('/').pop().replace(/\.bundle\.age$/, '');
  for (const line of CODE_STEPS) {
    const cmd = line.replace("<the month's full copy>", stem(fullCopy)).replace("<a later night's copy>", stem(newCopy));
    execFileSync('sh', ['-c', cmd], { cwd: restore, env: { ...process.env, PATH: realAge ? process.env.PATH : `${join(restore, 'bin')}:${process.env.PATH}` }, stdio: ['ignore', 'ignore', 'pipe'] });
  }
  const back = (...a) => execFileSync('git', ['-C', join(restore, 'site'), ...a], { encoding: 'utf8' }).trim();
  back('fsck', '--full');
  assert.equal(back('rev-parse', 'main'), git('rev-parse', 'main'));
  assert.equal(back('rev-parse', 'v2'), git('rev-parse', 'v2'));
  assert.equal(back('rev-parse', 'feature'), git('rev-parse', 'feature'));
  assert.equal(back('show', 'HEAD:new.html'), '<p>new</p>');

  // The restore tool with two nights in the folder: the newest unless another is named
  const dl = join(tmp, 'download');
  writeFileSync(join(dl, `${N2} site-db.sql.gz.age`), twin(`Database/site-db/2026/${N2} site-db.sql.gz.age`).bytes);
  writeFileSync(join(dl, `${N2} site-db manifest.json`), only(`Database/site-db/2026/${N2} site-db manifest.json`).bytes);
  const tool = (...a) => execFileSync('node', [join(here, '../scripts/restore.mjs'), 'database', dl, '--key', join(tmp, 'key.txt'), ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  assert.match(tool('--check'), new RegExp(`using the newest, ${N2}[\\s\\S]*the run of ${N2}: the copy matches[\\s\\S]*exactly as copied`));
  assert.match(tool('--night', N1, '--check'), new RegExp(`the run of ${N1}: the copy matches[\\s\\S]*exactly as copied`));
  assert.ok(readdirSync(dl).includes(`${N1} site-db restore.sql`) && readdirSync(dl).includes(`${N2} site-db restore.sql`));
});

test('night 3: a signing key Stream no longer takes is replaced (the old one removed), and a setting the key can’t read is trouble', async () => {
  world.streamKeys = []; // someone revoked the key in Stream
  world.videos.push({ uid: 'v5', name: 'Another private one', private: true, download: 'ready', bytes: randomBytes(150_000) });
  world.faults.settingsDenied = '/members';
  const s = await runNight(N3);
  assert.equal(s.night.ok, false);
  assert.deepEqual(s.night.problemKinds, ['settings-not-read'], JSON.stringify(s.night.problems));
  assert.match(s.night.problems[0], /couldn’t read 1 of Cloudflare’s settings \(Who can sign in to Cloudflare\)/);
  assert.ok(s.night.notes.includes('video v5 is waiting for a Stream signing key'));
  assert.ok(s.streamKey.refused, 'the refused key is set aside');
  assert.deepEqual(await call('needs'), { streamKey: true, videos: [] });

  const { r, alerts } = await site('/chores', { now: Date.now() + 32 * 60_000 });
  assert.equal(alerts.length, 1, 'one alert, for the settings');
  assert.match(alerts[0].detail, /couldn’t read 1 of Cloudflare’s settings/);
  assert.ok(r.done.includes('handed the backup a Stream signing key'), JSON.stringify(r.done));
  assert.deepEqual(world.streamKeys, ['kid1', 'kid2'].filter((k) => k !== 'kid1'), 'the new key is the only one left in Stream');
  assert.deepEqual(world.siteDeletes, ['key kid1'], 'the key the backup replaced is removed from Stream');
  assert.equal((await call('status')).streamKey.id, 'kid2');
});

test('night 4: a Photos folder put in the trash: its photos are sent to Drive again from Backblaze, new ones go to a new folder, and it’s said', async () => {
  world.faults.settingsDenied = null;
  // Someone puts the Photos folder in the trash (the trash empties itself): every copy in it is as good as gone
  const photos = [...world.drive.files.values()].find((f) => f.name === 'Photos' && f.mimeType === 'application/vnd.google-apps.folder');
  photos.trashed = true;
  for (const f of world.drive.files.values()) if (f.parents?.[0] === photos.id) f.trashed = true;
  world.images.push({ id: 'kids/another-kid/before-1', filename: 'Another.jpg', uploaded: '2026-11-17T00:00:00Z', bytes: randomBytes(30_000) });
  const s = await runNight(N4);
  assert.deepEqual(s.night.problemKinds, ['drive-lost'], JSON.stringify(s.night.problems));
  assert.match(s.night.problems[0], /^4 copies were gone from Google Drive/);
  assert.equal(s.night.waitingToShip, 0, 'and every one is back in both homes');
  for (const im of world.images) {
    const live = world.driveFile(photoPath(im, im.filename.endsWith('.png') ? 'png' : 'jpg'));
    assert.ok(live?.length, `${im.id} is in Drive again, outside the trash`);
    assert.ok((await open(live.at(-1).bytes)).equals(im.bytes));
    assert.notEqual(world.drive.files.get(live.at(-1).parents[0]).id, photos.id);
  }
  assert.equal(world.deletes.length, 0);
  const { alerts } = await site('/chores', { now: Date.now() + 48 * 60_000 });
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].detail, /gone from Google Drive/);
});

test('night 5: everything well again, an all-clear, and the photos put back under their own names from the list', async () => {
  const s = await runNight(N5);
  assert.equal(s.night.ok, true, JSON.stringify(s.night.problems));
  assert.equal(s.night.audit.lost, 0);
  const { alerts } = await site('/chores', { now: Date.now() + 64 * 60_000 });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].resolves, 'backup');

  // The photos as they'd be downloaded from Files/Photos, and the run's list: each back under its own id
  const dir = join(tmp, 'photos');
  mkdirSync(dir, { recursive: true });
  for (const im of world.images) { const p = photoPath(im, im.filename.endsWith('.png') ? 'png' : 'jpg'); writeFileSync(join(dir, p.split('/').pop()), world.driveFile(p).at(-1).bytes); }
  // One copy cut short in the download: it's listed, and nothing half-written is left as if it were the photo
  const cut = join(dir, photoPath(world.images[2]).split('/').pop());
  writeFileSync(cut, world.driveFile(photoPath(world.images[2])).at(-1).bytes.subarray(0, 300));
  const listName = `${N5} files.json.gz.age`;
  writeFileSync(join(dir, listName), only(`Files/Lists/2026/${listName}`).bytes);
  let out = '';
  let failedRun = null;
  try { execFileSync('node', [join(here, '../scripts/restore.mjs'), 'files', dir, '--key', join(tmp, 'key.txt'), '--list', join(dir, listName)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { failedRun = e; out = `${e.stdout}${e.stderr}`; }
  assert.ok(failedRun, 'a file that won’t open makes the tool say so and end with an error');
  assert.match(out, /1 file wouldn’t open/);
  assert.ok(readFileSync(join(dir, 'restored', 'images', 'kids', 'sample-kid', 'before-1')).equals(world.images[0].bytes));
  assert.ok(readFileSync(join(dir, 'restored', 'images', 'team', 'sample-staffer', 'headshot')).equals(world.images[1].bytes));
  assert.equal(existsSync(join(dir, 'restored', 'images', 'img-3')), false);
  assert.equal(readdirSync(join(dir, 'restored', 'images')).some((n) => n.endsWith('.part')), false, 'nothing half-written left behind');
});

test('the whole account: nothing unchanged is copied again, a change is, what’s made later is found, and what can’t be copied is named', async () => {
  const R1 = `${N5} 1200`;
  const R2 = `${N5} 1300`;
  const R3 = `${N5} 1400`;
  const R4 = `${N5} 1500`;
  // Nothing changed: no KV part, index or Worker code is sent again
  const s1 = await runNight(R1);
  assert.equal(s1.night.ok, true, JSON.stringify([s1.night.problems, s1.drill?.problems]));
  const names = () => [...world.drive.files.values()].map((f) => f.name);
  assert.deepEqual(names().filter((n) => n.startsWith(`${R1} `) && /DEVICES|product-catalog| code \(/.test(n)), [], 'unchanged since the last copy');
  assert.equal(s1.night.workers.unchanged, 4);
  assert.ok(s1.night.vectorize[0].unchanged);

  // Then: one KV value changes (in the second part), a vector is added, a Worker is changed, and someone makes a new
  // database, a new bucket and a Worker with a Durable Object nobody has checked
  world.kv[0].keys.get('with-meta').value = Buffer.from('{"x":2}');
  world.setVector(world.vectorize[0], 'prod-6', { values: [0, 0, 0, 1] });
  world.workers[1].modified = '2026-11-18T00:00:00Z';
  world.workers[1].files[0].bytes = Buffer.from('export default { changed: true };\n');
  world.addDb('later-db').exec("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT); INSERT INTO notes VALUES (1, 'made later');");
  const later = randomBytes(4000);
  world.buckets['store-email-photos'] = new Map([['photo.jpg', { bytes: later, etag: md5(later), last_modified: '2026-11-18T00:00:00Z' }]]);
  world.durableObjects.push({ script: 'new-worker', class: 'Mystery', id: 'do9' });
  const s2 = await runNight(R2);
  assert.deepEqual(s2.night.problemKinds, ['coverage:do:new-worker:Mystery'], JSON.stringify([s2.night.problems, s2.drill?.problems]));
  assert.match(s2.night.problems[0], /Durable Object Mystery in the Worker new-worker .*needs checking/);
  // KV: only the changed part is new, and the new manifest says which file holds each part
  const m2 = newestManifest('KV/DEVICES/2026');
  assert.deepEqual(m2.parts.map((p) => [p.part, p.copiedIn]), [[1, N1], [2, R2]]);
  assert.equal(names().some((n) => n.startsWith(`${R2} DEVICES part 1 of 2`)), false, 'the unchanged part wasn’t sent again');
  await checkAccount(R2, s2);
  // The new database and bucket: found, copied, and the database restored exactly in the drill
  const sql = gunzipSync(await open(only(`Database/later-db/2026/${R2} later-db.sql.gz.age`).bytes));
  const restored = new DatabaseSync(':memory:');
  restored.exec(sql.toString('utf8'));
  assert.equal(restored.prepare('SELECT body FROM notes').get().body, 'made later');
  assert.ok((await open(only(`Files/store-email-photos/${codeOf('r2:store-email-photos', 'photo.jpg', md5(later))}.age`).bytes)).equals(later));
  const drill = JSON.parse(only(`Restore drills/2026/${R2} drill.json`).bytes);
  assert.ok(drill.databases.some((d) => d.name === 'later-db' && d.ok), JSON.stringify(drill.databases));
  // The site tells the admins, once
  const { alerts } = await site('/chores', { now: Date.now() + 80 * 60_000 });
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].detail, /Durable Object Mystery/);

  // Next: the Durable Object is checked and gone, but the read-only key loses a permission: the setup check names it,
  // once, and the run says it once (not again as a listing or a setting it couldn't read)
  world.durableObjects.pop();
  world.faults.denied = ['/storage/kv'];
  const s3 = await runNight(R3);
  // Said as the setup step, and as what that night didn't copy (so the night is never taken for a well one)
  assert.deepEqual(s3.night.problemKinds.sort(), ['coverage:list:kv', 'settings-not-read', 'setup:cloudflare:needs Workers KV Storage Read'], JSON.stringify(s3.night.problems));
  assert.match(s3.night.problems.join(' '), /KV namespaces? weren’t copied tonight: the read-only key needs “Workers KV Storage Read” \(as the setup check says\)/);
  assert.deepEqual(s3.setup.cloudflare.missing, ['Workers KV Storage Read']);
  // Stream switched off on Cloudflare's side (as in Sept and Nov 2026) is not a permission to add
  world.faults.streamListDown = true;
  const checked = await call('check');
  assert.deepEqual(checked.cloudflare.missing, ['Workers KV Storage Read']);
  world.faults.streamListDown = false;

  // All well again
  world.faults.denied = [];
  const s4 = await runNight(R4);
  assert.equal(s4.night.ok, true, JSON.stringify([s4.night.problems, s4.drill?.problems]));
  const after = await site('/chores', { now: Date.now() + 96 * 60_000 });
  assert.equal(after.alerts.at(-1)?.resolves, 'backup', JSON.stringify(after.alerts));
  assert.equal(world.deletes.length, 0);
});

test('nights 6 to 8: a copy that reached only Drive while Backblaze was down is never stranded; a night Stream can’t be listed still names every video', async () => {
  // Night 6: Backblaze is down all night; a new file reaches Drive only, and waits, staged
  world.faults.b2Down = true;
  const bytes = randomBytes(5000);
  world.buckets['soard-files'].set('new/after.txt', { bytes, etag: md5(bytes), last_modified: '2026-11-19T00:00:00Z' });
  const path = `Files/soard-files/${codeOf('r2:soard-files', 'new/after.txt', md5(bytes))}.age`;
  const s6 = await runNight(N6);
  assert.ok(s6.night.problemKinds.includes('home:b2'), JSON.stringify(s6.night.problems));
  assert.equal(world.b2File(path).length, 0);
  assert.ok(world.driveFile(path)?.length, 'in Drive only, so far');
  // Then someone removes it from Drive, and Backblaze is back; and the next night Stream can't be listed
  for (const f of world.driveFile(path)) world.drive.files.delete(f.id);
  world.faults.b2Down = false;
  world.faults.streamListDown = true;
  const s7 = await runNight(N7);
  assert.ok(s7.night.problemKinds.includes('list:videos'), JSON.stringify(s7.night.problems));
  // Stream switched off on Cloudflare's side is said once, as the videos not listed: not as settings the key can't read
  assert.equal(s7.night.problemKinds.includes('settings-not-read'), false, JSON.stringify(s7.night.problems));
  assert.ok(s7.night.notes.some((x) => /switched off on Cloudflare’s side/.test(x)), JSON.stringify(s7.night.notes));
  assert.ok((await open(twin(path).bytes)).equals(bytes), 'its staged bytes were kept, and reached Backblaze');
  // The night's list still names every video (as Stream was last listed), the one map from codes back to names
  const list7 = JSON.parse(gunzipSync(await open(only(`Files/Lists/2026/${N7} files.json.gz.age`).bytes)));
  assert.deepEqual(list7.files.filter((f) => f.source === 'videos').map((f) => f.key).sort(), ['v1', 'v2', 'v3', 'v4', 'v5']);
  // Night 8: the run's look at Drive finds it gone, and it's sent there again from Backblaze
  world.faults.streamListDown = false;
  const s8 = await runNight(N8);
  assert.deepEqual(s8.night.problemKinds, ['drive-lost'], JSON.stringify(s8.night.problems));
  assert.match(s8.night.problems[0], /^1 copy was gone from Google Drive/);
  assert.ok((await open(only(path).bytes)).equals(bytes), 'in Drive again');
  assert.equal(world.deletes.length, 0);
});

test('nights 9 and 10: Backblaze answers but refuses every upload, and a file is moved into another shared drive: Drive still gets everything, it’s told by home, and all catches up', async () => {
  world.faults.b2RefuseUploads = true;
  world.images.push({ id: 'kids/new-kid/before-1', filename: 'New.jpg', uploaded: '2026-11-22T00:00:00Z', bytes: randomBytes(20_000) });
  // Someone moves a photo's copy into another shared drive the backup's account can see: it's not in the backup drive
  const moved = world.driveFile(photoPath(world.images[0])).at(-1);
  moved.driveId = 'archive';
  // And the whole Code folder moved into that drive: new code copies must not go there
  const codeFolder = [...world.drive.files.values()].find((f) => f.name === 'Code' && f.mimeType === 'application/vnd.google-apps.folder' && !f.trashed);
  // (as Drive does, everything inside moves with it)
  const moveAll = (id) => { for (const f of world.drive.files.values()) if (f.parents?.[0] === id) { f.driveId = 'archive'; moveAll(f.id); } };
  codeFolder.driveId = 'archive';
  moveAll(codeFolder.id);
  writeFileSync(join(gitDir, 'night9.html'), '<p>9</p>\n');
  git('add', '.'); git('commit', '-q', '-m', 'night nine');
  const s9 = await runNight(N9);
  assert.ok(s9.night.problemKinds.includes('ship:b2'), JSON.stringify(s9.night.problems));
  assert.match(s9.night.problems[s9.night.problemKinds.indexOf('ship:b2')], /^Backblaze refused copies this run: .*storage cap exceeded/);
  assert.ok(s9.night.problemKinds.includes('drive-lost'), 'the moved copy counts as gone from the backup drive');
  assert.deepEqual(s9.night.errors, [], 'no step failed: the databases, settings and code were all made and reached Drive');
  for (const db of ['site-db', 'store-db']) assert.ok(world.driveFile(`Database/${db}/2026/${N9} ${db}.sql.gz.age`)?.length, `${db} reached Drive`);
  assert.ok(world.driveFile(photoPath(world.images.at(-1)))?.length, 'the new photo reached Drive');
  const code9 = [...world.drive.files.values()].find((f) => f.name.startsWith(`${N9} site `) && f.name.endsWith('.bundle.age'));
  let up = world.drive.files.get(code9.parents[0]);
  while (up && up.name !== 'Code') up = world.drive.files.get(up.parents[0]);
  assert.ok(up && up.id !== codeFolder.id && !up.driveId, 'the new code copy went into a new Code folder in the backup drive');
  const back = world.driveFile(photoPath(world.images[0])).filter((f) => (f.driveId || 'shared1') === 'shared1');
  assert.ok(back.length && (await open(back.at(-1).bytes)).equals(world.images[0].bytes), 'the moved photo is in the backup drive again, from Backblaze');
  // Night 10: Backblaze takes copies again; everything catches up and the run is well
  world.faults.b2RefuseUploads = false;
  const s10 = await runNight(N10);
  assert.equal(s10.night.ok, true, JSON.stringify(s10.night.problems));
  assert.equal(s10.night.waitingToShip, 0);
  assert.ok((await open(twin(photoPath(world.images.at(-1))).bytes)).equals(world.images.at(-1).bytes));
  assert.ok(twin(`Database/site-db/2026/${N9} site-db.sql.gz.age`), 'night 9’s database copy reached Backblaze too');
  assert.equal(world.deletes.length, 0);
});

test('nights 11 and 12: a backlog for Backblaze (30 copies) all reaches it while Drive refuses, and only the refusing home is named', async () => {
  // Night 11: Backblaze down; 30 new files reach Drive only
  world.faults.b2Down = true;
  const added = [];
  for (let i = 0; i < 30; i++) {
    const bytes = randomBytes(800 + i);
    world.buckets['soard-vendor-docs'].set(`batch/doc-${i}.pdf`, { bytes, etag: md5(bytes), last_modified: '2026-11-24T00:00:00Z' });
    added.push({ path: `Files/soard-vendor-docs/${codeOf('r2:soard-vendor-docs', `batch/doc-${i}.pdf`, md5(bytes))}.age`, bytes });
  }
  await runNight(N11);
  assert.equal(added.filter((a) => world.b2File(a.path).length).length, 0);
  // Night 12: Backblaze is back, and Drive refuses everything (the account made a Viewer)
  world.faults.b2Down = false;
  world.faults.driveRefuse = true;
  const s12 = await runNight(N12);
  assert.equal(added.filter((a) => world.b2File(a.path).length === 1).length, 30, 'every copy of the backlog reached Backblaze');
  assert.ok(s12.night.problemKinds.includes('ship:drive'), JSON.stringify(s12.night.problems));
  assert.match(s12.night.problems[s12.night.problemKinds.indexOf('ship:drive')], /^Google Drive refused copies this run: .*sufficient permissions/);
  assert.equal(s12.night.problemKinds.includes('ship:b2'), false, 'Backblaze isn’t blamed');
  world.faults.driveRefuse = false;
});

test('nights 13 and 14: with Backblaze down for days, copies waiting only for it never crowd out one Drive missed, and Drive isn’t blamed for a hiccup it got past', async () => {
  // Night 13: Backblaze down; 30 more files reach Drive only (they wait for Backblaze alone)
  world.faults.b2Down = true;
  for (let i = 0; i < 30; i++) {
    const bytes = randomBytes(700 + i);
    world.buckets['soard-vendor-docs'].set(`later/doc-${i}.pdf`, { bytes, etag: md5(bytes), last_modified: '2026-11-26T00:00:00Z' });
  }
  await runNight(N13);
  // Night 14: still down, and Google drops tonight's first upload once (the site's database copy)
  world.faults.loseDrivePieces = 1;
  const s14 = await runNight(N14);
  assert.ok(world.driveFile(`Database/site-db/2026/${N14} site-db.sql.gz.age`)?.length, 'tonight’s database copy reached Drive, ahead of the copies only Backblaze lacks');
  assert.deepEqual(s14.night.problemKinds.filter((k) => k.startsWith('ship:') || k.startsWith('step:')), [], 'Drive took it in the end: not blamed');
  assert.ok(s14.night.problemKinds.includes('home:b2'));
  // Backblaze back: everything waiting reaches it
  world.faults.b2Down = false;
  const s15 = await runNight('2026-11-28');
  assert.equal(s15.night.ok, true, JSON.stringify(s15.night.problems));
  assert.equal(s15.night.waitingToShip, 0);
});

test('night 16: a copy gone from Drive that Backblaze gives back damaged is serious trouble, said as such, and nothing is sent', async () => {
  // A photo's Drive copy is deleted, and Backblaze gives back bytes that aren't what was sent
  const im = world.images[2];
  for (const f of world.driveFile(photoPath(im)) || []) world.drive.files.delete(f.id);
  world.faults.b2GivesBackDamaged = true;
  const s = await runNight('2026-11-29');
  world.faults.b2GivesBackDamaged = false;
  assert.ok(s.night.problemKinds.includes('restage'), JSON.stringify(s.night.problems));
  assert.match(s.night.problems[s.night.problemKinds.indexOf('restage')], /Backblaze couldn’t give back a copy .*isn’t what was sent/);
  assert.equal(world.driveFile(photoPath(im)), null, 'nothing damaged was sent to Drive');
  // (the drill reads copies back from Backblaze too; this night's drill finds the damage there as well)
});

test('nights 17 to 22: copies Drive refused for nights are still taken first once it works, though Backblaze now refuses dozens of newer ones', async () => {
  const add = (prefix, n, day) => Array.from({ length: n }, (_, i) => {
    const bytes = randomBytes(600 + i);
    world.buckets['soard-vendor-docs'].set(`${prefix}/doc-${i}.pdf`, { bytes, etag: md5(bytes), last_modified: `${day}T00:00:00Z` });
    return `Files/soard-vendor-docs/${codeOf('r2:soard-vendor-docs', `${prefix}/doc-${i}.pdf`, md5(bytes))}.age`;
  });
  // Nights 17 to 20: Drive refuses; five files reach Backblaze only, and fail Drive night after night
  world.faults.driveRefuse = true;
  const old = add('refused', 5, '2026-11-30');
  for (const night of ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03']) await runNight(night);
  assert.equal(old.filter((p) => world.driveFile(p)).length, 0);
  // Night 21: Drive works again, Backblaze refuses, and eighty new files wait for Backblaze only
  world.faults.driveRefuse = false;
  world.faults.b2RefuseUploads = true;
  add('newer', 80, '2026-12-04');
  await runNight('2026-12-04');
  assert.equal(old.filter((p) => world.driveFile(p)?.length).length, 5, 'the five Drive refused for nights reached it');
  // Night 22: all well
  world.faults.b2RefuseUploads = false;
  const s = await runNight('2026-12-05');
  assert.equal(s.night.waitingToShip, 0);
});
