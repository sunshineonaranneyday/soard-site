/**
 * The backup's smaller parts on their own (the whole Worker is ./worker.test.mjs): the SQL splitter the restore
 * drill replays with, the one spelling of a real in the digests, the quiet second, and the READ ME kept to one file.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createSplitter, canonical, digester } from '../src/sql.js';
import { readDatabase } from '../src/db.js';
import { untilQuiet, checkSetup, filesJob } from '../src/jobs.js';
import { newIdentity } from '../src/stage.js';
import { b2Client } from '../src/b2.js';
import { createWorld, ACCT } from './fake-world.mjs';
import { redact } from '../src/settings.js';
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const enc = new TextEncoder();
const dec = new TextDecoder();

test('the splitter finds the same statements however the bytes arrive', () => {
  const sql = `-- a comment; with a semicolon\nPRAGMA defer_foreign_keys = true;\nCREATE TABLE "a;b" (x TEXT, [c;d] INTEGER, \`e;f\` BLOB);\nINSERT INTO "a;b" VALUES ('it''s; here', 1, X'3B'), (CAST(X'00' AS TEXT), 2, NULL);\n/* a block; comment */ CREATE TRIGGER t AFTER INSERT ON "a;b" BEGIN UPDATE "a;b" SET x = x || ';' WHERE 0; SELECT 1; END;\nCREATE VIEW v AS SELECT ';' AS s;\n`;
  const want = (() => { const s = createSplitter(); return [...s.push(enc.encode(sql)), ...s.end()].map((b) => dec.decode(b)); })();
  assert.equal(want.length, 5);
  assert.match(want[3], /^\s*\/\* a block; comment \*\/ CREATE TRIGGER[\s\S]*END;$/);
  for (const size of [1, 2, 3, 7, 64]) {
    const s = createSplitter();
    const got = [];
    const bytes = enc.encode(sql);
    for (let i = 0; i < bytes.length; i += size) got.push(...s.push(bytes.subarray(i, i + size)));
    got.push(...s.end());
    assert.deepEqual(got.map((b) => dec.decode(b)), want, `in pieces of ${size}`);
  }
  // Every statement runs in SQLite as it was split
  const db = new DatabaseSync(':memory:');
  for (const st of want) db.exec(st);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM "a;b"').get().n, 2);
  assert.throws(() => { const s = createSplitter(); s.push(enc.encode("INSERT INTO t VALUES ('cut short")); s.end(); }, /cut short/);
});

test('a real is spelled one way in the digests, whichever SQLite wrote it', async () => {
  assert.equal(canonical('r4.94065645841247e-324'), canonical('r4.9406564584124654e-324'));
  assert.equal(canonical('r1.797693134862315692e+308'), canonical('r1.7976931348623157e+308'));
  assert.equal(canonical('r9.0e+999'), 'rInfinity');
  assert.equal(canonical('r-0.0'), 'r-0');
  assert.notEqual(canonical('r0.1'), canonical('r0.10000000000000002'));
  assert.equal(canonical('i9007199254740993'), 'i9007199254740993', 'integers stay exact');
  const a = digester(); await a.add(['i1', 'r4.94065645841247e-324']);
  const b = digester(); await b.add(['i1', 'r4.9406564584124654e-324']);
  assert.equal(a.value, b.value);
});

test('the quiet second: just after the site’s minute jobs', () => {
  const at = (s) => Date.parse(`2026-11-14T07:00:${String(s).padStart(2, '0')}Z`);
  assert.equal(untilQuiet(28, at(28)), 0);
  assert.equal(untilQuiet(28, at(29)), 0);
  assert.equal(untilQuiet(28, at(10)), 18_000);
  assert.equal(untilQuiet(28, at(40)), 48_000);
});

test('a write between the bookmarks throws the read away', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE t (k INTEGER PRIMARY KEY, v TEXT); INSERT INTO t VALUES (1, \'a\')');
  let mark = 1;
  let calls = 0;
  const source = { bookmark: async () => `bm-${mark}`, batch: async (stmts) => { if (++calls === 2) { db.exec("INSERT INTO t VALUES (2, 'b')"); mark++; } return stmts.map(({ sql, params = [] }) => db.prepare(sql).all(...params).map((r) => Object.values(r))); } };
  await assert.rejects(readDatabase(source), (e) => e.name === 'Moved');
  const again = await readDatabase(source);
  assert.equal(again.tables.t.rows, 2);
});

test('the READ ME is replaced in Drive when its words change, never written twice', async () => {
  const google = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const world = createWorld({ gitDir: '/nowhere', repo: 'x/y', streamPublicJwk: null });
  world.addDb('db1');
  const kv = new Map();
  const key = await newIdentity();
  const state = {
    get: async (k) => kv.get(k) ?? null,
    set: async (k, v) => { kv.set(k, v); },
    merge: async (k, v) => { const n = { ...(kv.get(k) || {}), ...v }; kv.set(k, n); return n; },
    publicKey: async () => ({ recipient: key.recipient, fingerprint: key.fingerprint, made: 'then' }),
  };
  const env = { CF_ACCOUNT_ID: ACCT, CF_BACKUP_TOKEN: 'cf-read-key', B2_KEY_ID: 'b2-key-id', B2_APPLICATION_KEY: 'b2-app-key', DATABASES: JSON.stringify([{ name: 'db1', id: 'db1' }]), REPOS: '[]', GOOGLE_BACKUP_KEY: JSON.stringify({ client_email: 'b@x.iam.gserviceaccount.com', private_key: google.privateKey.export({ type: 'pkcs8', format: 'pem' }) }) };
  const fetchImpl = (url, init) => world.handle(new Request(url, init));
  await checkSetup(env, state, { fetchImpl });
  const first = world.driveFile('READ ME FIRST - how to restore.txt');
  assert.equal(first.length, 1);
  // An older version on record: the next check writes the new words over it, as a new version of the same file
  kv.set('readme', { drive: '1:old', b2: '1:old' });
  first[0].bytes = Buffer.from('older words');
  await checkSetup(env, state, { fetchImpl });
  const after = world.driveFile('READ ME FIRST - how to restore.txt');
  assert.equal(after.length, 1, 'still one READ ME');
  assert.match(after[0].bytes.toString(), new RegExp(key.fingerprint));
  assert.deepEqual(after[0].versions.map(String), ['older words'], 'Drive keeps the old words as an earlier version');
  assert.equal(world.deletes.length, 0);
});

test('the splitter keeps a trigger whole with CASE … END inside it', () => {
  const sql = "CREATE TRIGGER t AFTER INSERT ON a BEGIN UPDATE a SET x = CASE WHEN NEW.x IS NULL THEN 'none; at all' ELSE NEW.x END WHERE rowid = NEW.rowid; SELECT CASE 1 WHEN 1 THEN 'end' END; END;\nINSERT INTO a VALUES ('next');\n";
  for (const size of [1, 5, 1000]) {
    const sp = createSplitter();
    const got = [];
    const bytes = enc.encode(sql);
    for (let i = 0; i < bytes.length; i += size) got.push(...sp.push(bytes.subarray(i, i + size)));
    got.push(...sp.end());
    assert.equal(got.length, 2, `in pieces of ${size}`);
    assert.match(dec.decode(got[0]), /END;$/);
  }
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE a (x TEXT)');
  const sp = createSplitter();
  for (const st of [...sp.push(enc.encode(sql)), ...sp.end()]) db.exec(dec.decode(st));
  db.exec('INSERT INTO a VALUES (NULL)');
  assert.deepEqual(db.prepare('SELECT x FROM a ORDER BY rowid').all().map((r) => r.x), ['next', 'none; at all']);
});

test('settings never carry a secret, whatever its shape, nor a header’s or rewritten query’s value', () => {
  const out = redact({
    idp: { config: { client_id: 'id', client_secret: 'shh', secrets: ['a', 'b'], private_key: { pem: 'x' } } },
    script: { bindings: [{ name: 'K', type: 'secret_text', text: 'shh' }, { name: 'V', type: 'plain_text', text: 'value' }], env_vars: { A: { type: 'secret_text', value: 'shh' } } },
    rule: { action_parameters: { headers: { Authorization: { operation: 'set', value: 'Bearer shh' }, 'X-Gone': { operation: 'remove' } }, uri: { query: { value: 'token=shh' }, path: { value: '/kept' } } } },
    redirect: { from_value: { target_url: { value: 'https://example.org/kept' } } },
    flags: { is_private: true },
  });
  const text = JSON.stringify(out);
  assert.equal(text.includes('shh'), false, text);
  assert.ok(text.includes('/kept') && text.includes('https://example.org/kept'), 'ordinary values stay');
  assert.equal(out.rule.action_parameters.headers['X-Gone'].operation, 'remove');
  assert.equal(out.flags.is_private, true);
  assert.equal(out.idp.config.client_id, 'id');
});

// index.js runs on Cloudflare; here its start rules run on their own, with Cloudflare's classes stood in for
async function loadIndex() {
  const dir = mkdtempSync(join(tmpdir(), 'soard-backup-index-'));
  const here = dirname(fileURLToPath(import.meta.url));
  writeFileSync(join(dir, 'cf.js'), 'export class WorkerEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }\nexport class WorkflowEntrypoint {}\nexport class DurableObject {}\n');
  const out = join(dir, 'index.mjs');
  await build({ entryPoints: [join(here, '../src/index.js')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'warning', alias: { 'cloudflare:workers': join(dir, 'cf.js') }, external: ['node:*'] });
  const mod = await import(out);
  rmSync(dir, { recursive: true, force: true });
  return mod;
}

function fakeEnv({ statuses = {}, failCreate = false } = {}) {
  const kv = new Map();
  const made = [];
  const state = {
    get: async (k) => kv.get(k) ?? null,
    set: async (k, v) => { if (v == null) kv.delete(k); else kv.set(k, v); },
    claimStart: async (t) => { const c = kv.get('starting'); if (c && c.until > Date.now() && c.ticket !== t) return false; kv.set('starting', { ticket: t, until: Date.now() + 60_000 }); return true; },
    releaseStart: async (t) => { if (kv.get('starting')?.ticket === t) kv.delete('starting'); },
  };
  const env = {
    TEST_MODE: '',
    STATE: { idFromName: () => 'id', get: () => state },
    NIGHT: {
      create: async ({ id, params }) => { if (failCreate) throw new Error('no'); made.push({ id, params }); statuses[id] = 'queued'; return {}; },
      get: async (id) => { if (!(id in statuses)) throw new Error('instance.not_found'); if (statuses[id] === 'boom') throw new Error('network'); return { status: async () => ({ status: statuses[id] }) }; },
    },
  };
  return { env, kv, made, statuses };
}

test('a run starts once a night after 2 AM Eastern, never beside another, and again (twice at most) if it broke', async () => {
  const { startNight, runStatus } = await loadIndex();
  const w = fakeEnv();
  const at = (iso) => new Date(iso);
  // 1:45 AM Eastern (06:45 UTC in November): not yet
  assert.equal((await startNight(w.env, { now: at('2026-11-15T06:45:00Z') })).why, 'before 2 AM');
  const r1 = await startNight(w.env, { now: at('2026-11-15T07:00:00Z') });
  assert.equal(r1.started, true);
  assert.equal(r1.run, '2026-11-15');
  assert.equal(r1.drill, true, 'Sunday, and no drill has passed yet');
  // While it runs, neither the schedule nor a person starts another
  w.statuses[r1.id] = 'running';
  assert.match((await startNight(w.env, { now: at('2026-11-15T07:15:00Z') })).why, /running now/);
  assert.match((await startNight(w.env, { now: at('2026-11-15T07:16:00Z'), by: 'peter@example.org' })).why, /running now/);
  // Done: the schedule leaves tonight alone; a person can still ask for one, named by its time
  w.statuses[r1.id] = 'complete';
  assert.match((await startNight(w.env, { now: at('2026-11-15T07:30:00Z') })).why, /done/);
  const manual = await startNight(w.env, { now: at('2026-11-15T15:04:00Z'), by: 'peter@example.org' });
  assert.equal(manual.run, '2026-11-15 1004');
  assert.equal(manual.by, 'peter@example.org');
  w.statuses[manual.id] = 'complete';
  // Cloudflare can't say how the last run is: nothing starts (asked again in 15 minutes)
  w.statuses[manual.id] = 'boom';
  assert.match((await startNight(w.env, { now: at('2026-11-16T07:00:00Z') })).why, /couldn’t say/);
  w.statuses[manual.id] = 'complete';
  // The next night's run breaks: tried again twice, then left for the alert
  const n2 = await startNight(w.env, { now: at('2026-11-16T07:00:00Z') });
  assert.equal(n2.run, '2026-11-16');
  assert.equal(n2.drill, true, 'no drill has passed yet, so the drill runs again');
  w.statuses[n2.id] = 'errored';
  const again1 = await startNight(w.env, { now: at('2026-11-16T07:15:00Z') });
  assert.equal(again1.restarts, 1);
  delete w.statuses[again1.id]; // gone from Cloudflare
  const again2 = await startNight(w.env, { now: at('2026-11-16T07:30:00Z') });
  assert.equal(again2.restarts, 2);
  w.statuses[again2.id] = 'terminated';
  assert.match((await startNight(w.env, { now: at('2026-11-16T07:45:00Z') })).why, /broke three times/);
  // A drill that passed: weekdays skip it
  w.kv.set('drill', { ok: true });
  const n3 = await startNight(w.env, { now: at('2026-11-17T07:00:00Z') });
  assert.equal(n3.drill, false);
  // Two starters at the same moment: one waits
  w.statuses[n3.id] = 'complete';
  w.kv.set('starting', { ticket: 'someone else', until: Date.now() + 60_000 });
  assert.match((await startNight(w.env, { now: at('2026-11-18T07:00:00Z') })).why, /another start/);
  // Run names: only TEST_MODE may choose one
  w.kv.delete('starting');
  const named = await startNight(w.env, { now: at('2026-11-18T07:00:00Z'), run: '2020-01-01' });
  assert.equal(named.run, '2026-11-18');
  assert.equal(await runStatus(w.env, 'never-made'), 'gone');
  w.statuses.x = 'boom';
  assert.equal(await runStatus(w.env, 'x'), 'unknown');
});

test('files: Cloudflare failing on every file fails the step (to wait and stop), a file’s own trouble doesn’t, and past its time the run stops copying', async () => {
  const item = { source: 'images', key: 'kids/someone/before-1', version: '1', name: 'x.jpg' };
  const fake = (status) => {
    const st = { tried: 0, failed: null };
    st.state = {
      todo: async () => [item], get: async () => null, copy: async () => null, sourceDone: async () => {},
      sourceTrying: async () => { st.tried++; }, sourceFailed: async (s, k, v, e) => { st.failed = e; },
      failures: async () => [{ error: st.failed }], todoCount: async () => ({ left: 1, failed: 0 }),
    };
    st.env = { CF_ACCOUNT_ID: ACCT, CF_BACKUP_TOKEN: 'cf-read-key', API_PACE_MS: '0', API_RETRY_MS: '0' };
    st.fetchImpl = async () => new Response('no', { status });
    return st;
  };
  const down = fake(503);
  await assert.rejects(filesJob(down.env, down.state, { drive: null, b2: null }, '2026-11-16', { fetchImpl: down.fetchImpl }), /no file could be copied: .*Cloudflare 503/);
  assert.equal(down.tried, 1, 'the try is counted before it starts');
  const own = fake(404);
  const r = await filesJob(own.env, own.state, { drive: null, b2: null }, '2026-11-16', { fetchImpl: own.fetchImpl });
  assert.deepEqual([r.copied, r.failed], [0, 1], 'one file Cloudflare doesn’t have is that file’s trouble, and the run goes on');
  const late = fake(200);
  const t = await filesJob(late.env, late.state, { drive: null, b2: null }, '2026-11-16', { until: Date.now() - 1, fetchImpl: late.fetchImpl });
  assert.equal(t.outOfTime, true);
  assert.equal(late.tried, 0, 'nothing more is started');
});

test('a busy moment at Backblaze’s sign-in is asked again, not taken for a home down', async () => {
  const world = createWorld({ gitDir: '/nowhere', repo: 'x/y', streamPublicJwk: null });
  let busy = 2;
  const fetchImpl = async (url, init) => (busy-- > 0 ? new Response('{"code":"service_unavailable"}', { status: 503 }) : world.handle(new Request(url, init)));
  const c = await b2Client({ B2_KEY_ID: 'b2-key-id', B2_APPLICATION_KEY: 'b2-app-key' }, { fetchImpl, wait: async () => {} });
  assert.equal(c.bucket.name, 'soard-backup-test');
});

test('the account’s inventory: every Durable Object is on the list with its reason or it’s a problem, and a listing the key may not read is named once', async () => {
  const { inventory, coverage, NOT_COPIED } = await import('../src/inventory.js');
  const world = createWorld({ gitDir: '/nowhere', repo: 'x/y', streamPublicJwk: null });
  world.addDb('db-1', 'main-db');
  world.addDb('spare', 'spare-db');
  world.buckets.files = new Map();
  world.kv.push({ id: 'k1', title: 'DEVICES', keys: new Map() });
  world.durableObjects.push({ script: 'soard-live-hub', class: 'LiveHub', id: 'a' }, { script: 'soard-live-hub', class: 'PrintHub', id: 'b' }, { script: 'deploy-coordinator', class: 'DeployCoordinator', id: 'c' }, { script: 'soard-backup', class: 'BackupState', id: 'd' }, { script: 'x', class: 'Unknown', id: 'e' });
  const { cfApi } = await import('../src/sources.js');
  const api = cfApi({ CF_ACCOUNT_ID: ACCT, CF_BACKUP_TOKEN: 'cf-read-key' }, { fetchImpl: (url, init) => world.handle(new Request(url, init)), pace: 0, retryMs: 0 });
  const inv = await inventory(api, { skip: { database: 'spare-db', bucket: 'backup-staging' } });
  assert.deepEqual(inv.databases.map((d) => d.name), ['main-db'], 'the spare drill database is left out');
  assert.deepEqual(inv.buckets, ['files'], 'and so is the staging bucket');
  assert.deepEqual(inv.kv, [{ id: 'k1', title: 'DEVICES' }]);
  assert.deepEqual(inv.notListed, []);
  const cov = coverage(inv);
  assert.deepEqual(cov.problems.map((p) => p.kind), ['coverage:do:x:Unknown']);
  assert.equal(cov.notCopied.length, 4, 'the four on the list, each with why');
  assert.ok(Object.values(NOT_COPIED).every((why) => why.length > 20));
  // The key can't list KV: a problem naming the permission, unless the setup check already names it
  world.faults.denied = ['/storage/kv'];
  const inv2 = await inventory(api, {});
  assert.deepEqual(inv2.notListed.map((n) => [n.type, n.permission]), [['kv', 'Workers KV Storage Read']]);
  assert.deepEqual(coverage(inv2).problems.map((p) => p.kind), ['coverage:list:kv', 'coverage:do:x:Unknown']);
  const named = coverage(inv2, { permissionsNamed: ['Workers KV Storage Read'] }).problems;
  assert.deepEqual(named.map((p) => p.kind), ['coverage:list:kv', 'coverage:do:x:Unknown'], 'still said: that night copied less');
  assert.match(named[0].text, /KV namespaces weren’t copied tonight: the read-only key needs “Workers KV Storage Read” \(as the setup check says\)/);
  assert.deepEqual(coverage(null).problems.map((p) => p.kind), ['coverage:inventory']);
});

test('what a run copies: every database and bucket found (the set ones keep their labels), and the set ones if nothing could be listed', async () => {
  const { targets } = await import('../src/extra.js');
  const env = { DATABASES: JSON.stringify([{ name: 'soard-db', id: 'id-1', label: 'SOARD website' }, { name: 'gone-db', id: 'id-9', label: 'Gone' }]), R2_BUCKETS: '["soard-files"]' };
  const inv = { databases: [{ name: 'soard-db', id: 'id-1' }, { name: 'new-db', id: 'id-2' }], buckets: ['soard-files', 'store-photos'], kv: [], vectorize: [], workers: [], notListed: [] };
  const t = targets(env, inv);
  assert.deepEqual(t.databases.map((d) => [d.name, d.label]), [['soard-db', 'SOARD website'], ['new-db', 'new-db'], ['gone-db', 'Gone']], 'one set but no longer listed is still tried, so its trouble is said');
  assert.equal(t.databases[1].quiet, false, 'a database found later has no quiet second to wait for');
  assert.deepEqual(t.buckets, ['soard-files', 'store-photos']);
  assert.deepEqual(targets(env, null).databases.map((d) => d.name), ['soard-db', 'gone-db']);
  assert.deepEqual(targets(env, { ...inv, notListed: [{ type: 'buckets' }] }).buckets, ['soard-files']);
});

test('the setup check names each permission the key lacks, and never takes Stream switched off on Cloudflare’s side for one', async () => {
  const { missingPermissions } = await import('../src/jobs.js');
  const world = createWorld({ gitDir: '/nowhere', repo: 'x/y', streamPublicJwk: null });
  const env = { CF_ACCOUNT_ID: ACCT, CF_BACKUP_TOKEN: 'cf-read-key' };
  const fetchImpl = (url, init) => world.handle(new Request(url, init));
  assert.deepEqual(await missingPermissions(env, { fetchImpl }), []);
  world.faults.streamListDown = true;
  assert.deepEqual(await missingPermissions(env, { fetchImpl }), [], 'Stream’s lapse answers 403 too, saying it isn’t enabled');
  world.faults.denied = ['/vectorize', '/workers/routes'];
  assert.deepEqual(await missingPermissions(env, { fetchImpl }), ['Vectorize Read', 'Workers Routes Read']);
  // A domain's firewall rules the key may not read: named as the permission that kind of rule needs
  world.faults.denied = ['/rulesets/zr-waf'];
  assert.deepEqual(await missingPermissions(env, { fetchImpl }), ['Zone WAF Read']);
});

test('the restore tool splits a Worker’s code back into its files, leaves out (and says so) a name that would land outside the folder, and takes the older one-file form', async () => {
  const world = createWorld({ gitDir: '/nowhere', repo: 'x/y', streamPublicJwk: null });
  const wasm = Buffer.from([0, 0x61, 0x73, 0x6d, 13, 10, 45, 45, 1, 0]);
  const { body } = world.workerBody({ name: 'w', files: [{ name: 'index.js', type: 'application/javascript+module', bytes: Buffer.from('export default {};\r\n--not a boundary\r\n') }, { name: 'lib/x..y.wasm', type: 'application/wasm', bytes: wasm }, { name: '../escape.js', type: 'application/javascript', bytes: Buffer.from('no') }] });
  const dir = mkdtempSync(join(tmpdir(), 'restore-worker-'));
  const tool = join(dirname(fileURLToPath(import.meta.url)), '../scripts/restore.mjs');
  const { spawnSync } = await import('node:child_process');
  const { readFileSync, existsSync } = await import('node:fs');
  try {
    writeFileSync(join(dir, 'code'), body);
    const r = spawnSync('node', [tool, 'worker', join(dir, 'code'), join(dir, 'out')], { encoding: 'utf8' });
    assert.equal(r.status, 1, 'a part left out ends with an error');
    assert.match(r.stdout, /Wrote 2 files/);
    assert.match(r.stderr, /1 part was left out.*\.\.\/escape\.js/);
    assert.equal(readFileSync(join(dir, 'out', 'index.js'), 'utf8'), 'export default {};\r\n--not a boundary\r\n');
    assert.ok(readFileSync(join(dir, 'out', 'lib', 'x..y.wasm')).equals(wasm), 'a name with two dots in it is fine');
    assert.equal(existsSync(join(dir, 'escape.js')) || existsSync(join(dir, 'out', 'escape.js')), false);
    writeFileSync(join(dir, 'old'), 'addEventListener("fetch", () => {});\n');
    const o = spawnSync('node', [tool, 'worker', join(dir, 'old'), join(dir, 'old-out')], { encoding: 'utf8' });
    assert.equal(o.status, 0, o.stderr);
    assert.equal(readFileSync(join(dir, 'old-out', 'index.js'), 'utf8'), 'addEventListener("fetch", () => {});\n');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the restore tool opens a KV part ready for wrangler, leaving out a key whose expiry has passed', async () => {
  const { encrypt } = await import('../src/stage.js');
  const { gzipSync } = await import('node:zlib');
  const { spawnSync } = await import('node:child_process');
  const { readFileSync } = await import('node:fs');
  const key = await newIdentity();
  const now = Math.floor(Date.now() / 1000);
  const items = [{ key: 'a', value: 'eA==', base64: true }, { key: 'old', value: 'eQ==', base64: true, expiration: now - 10 }, { key: 'later', value: 'eg==', base64: true, expiration: now + 86400, metadata: { n: 1 } }];
  const cipher = await encrypt(key.recipient, new Response(gzipSync(Buffer.from(JSON.stringify(items)))).body);
  const dir = mkdtempSync(join(tmpdir(), 'restore-kv-'));
  try {
    const file = join(dir, '2026-11-17 DEVICES part 1 of 1 (abc).json.gz.age');
    writeFileSync(file, Buffer.from(await new Response(cipher).arrayBuffer()));
    writeFileSync(join(dir, 'key.txt'), `${key.identity}\n`);
    const r = spawnSync('node', [join(dirname(fileURLToPath(import.meta.url)), '../scripts/restore.mjs'), 'kv', file, '--key', join(dir, 'key.txt')], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Wrote 2 keys .*1 left out: expired/);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, '2026-11-17 DEVICES part 1 of 1 (abc) ready.json'))).map((x) => x.key), ['a', 'later']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/** A small staging bucket and backup records in memory, for the KV jobs on their own */
function memoryBackup(world, extra = {}) {
  const objects = new Map();
  const STAGING = {
    put: async (k, v) => { objects.set(k, Buffer.from(typeof v === 'string' ? v : v instanceof Uint8Array ? v : await new Response(v).arrayBuffer())); },
    head: async (k) => (objects.has(k) ? { size: objects.get(k).length } : null),
    get: async (k) => (objects.has(k) ? { text: async () => objects.get(k).toString('utf8'), arrayBuffer: async () => objects.get(k) } : null),
    delete: async (k) => { for (const x of [].concat(k)) objects.delete(x); },
    createMultipartUpload: async () => { throw new Error('parts are small here'); },
  };
  const kv = new Map();
  const copies = new Map();
  let keyPair;
  const state = {
    get: async (k) => kv.get(k) ?? null, set: async (k, v) => { kv.set(k, v); },
    copy: async (id) => copies.get(id) || null,
    addCopy: async (c) => { if (!copies.has(id(c))) copies.set(id(c), c); return copies.get(id(c)); },
    publicKey: async () => (keyPair ||= await newIdentity()),
  };
  const id = (c) => c.id;
  const env = { STAGING, CF_ACCOUNT_ID: ACCT, CF_BACKUP_TOKEN: 'cf-read-key', API_PACE_MS: '0', API_RETRY_MS: '0', KV_PART_KEYS: '3', ...extra };
  const fetchImpl = (url, init) => world.handle(new Request(url, init));
  return { env, state, objects, copies, fetchImpl, open: async (c) => { const { decrypt } = await import('../src/stage.js'); const { gunzipSync } = await import('node:zlib'); return JSON.parse(gunzipSync(Buffer.from(await new Response(await decrypt(keyPair.identity, new Response(objects.get(c.staged)).body)).arrayBuffer()))); } };
}

test('KV: a night started again goes on from its own listing, so its manifest is of one listing; a key gone since is said, one listed but unreadable is trouble', async () => {
  const { kvListJob, kvPartJob, kvDoneJob } = await import('../src/extra.js');
  const world = createWorld({ gitDir: '/nowhere', repo: 'x/y', streamPublicJwk: null });
  const ns = { id: 'k1', title: 'DEVICES', keys: new Map('abcdefg'.split('').map((c) => [c, { value: Buffer.from(c.repeat(3)) }])) };
  world.kv.push(ns);
  const b = memoryBackup(world);
  const run = '2026-11-17';
  const l1 = await kvListJob(b.env, b.state, ns, run, { fetchImpl: b.fetchImpl });
  assert.deepEqual([l1.count, l1.parts], [7, 3]);
  await kvPartJob(b.env, b.state, {}, ns, run, 1, l1, { fetchImpl: b.fetchImpl });
  // The night breaks here; before it starts again, 'b' and 'e' are removed and 'a0' added
  ns.keys.delete('b'); ns.keys.delete('e'); ns.keys.set('a0', { value: Buffer.from('new') });
  const l2 = await kvListJob(b.env, b.state, ns, run, { fetchImpl: b.fetchImpl });
  assert.deepEqual(l2, l1, 'the night started again keeps its own listing');
  const r2 = await kvPartJob(b.env, b.state, {}, ns, run, 2, l2, { fetchImpl: b.fetchImpl });
  assert.equal(r2.gone, 1, 'e went between the listing and its part');
  await kvPartJob(b.env, b.state, {}, ns, run, 3, l2, { fetchImpl: b.fetchImpl });
  const done = await kvDoneJob(b.env, b.state, {}, ns, run, l2);
  assert.equal(done.keys, 6, 'every key of the listing that still existed: none dropped at a part’s edge');
  const man = JSON.parse([...b.copies.values()].find((c) => c.kind === 'manifest').path ? b.objects.get([...b.copies.values()].find((c) => c.kind === 'manifest').staged).toString() : '{}');
  const got = [];
  for (const p of man.parts) got.push(...(await b.open([...b.copies.values()].find((c) => c.path === p.file))).map((x) => x.key));
  assert.deepEqual(got, ['a', 'b', 'c', 'd', 'f', 'g'], 'one listing, part by part (b was copied before it went)');
  // A listing that isn't the one the parts were counted from is refused, never mixed in
  const stale = { ...l2, list: 'not-this-one' };
  await assert.rejects(kvPartJob(b.env, b.state, {}, ns, run, 1, stale, { fetchImpl: b.fetchImpl }), /changed under this run/);
  await assert.rejects(kvDoneJob(b.env, b.state, {}, ns, run, stale), /no copy from this run’s listing/);
  // The next night: a key Cloudflare lists but won't give is trouble, never a key quietly left out
  world.faults.kvUnreadable = 'c';
  const l3 = await kvListJob(b.env, b.state, ns, '2026-11-18', { fetchImpl: b.fetchImpl });
  await assert.rejects(kvPartJob(b.env, b.state, {}, ns, '2026-11-18', 1, l3, { fetchImpl: b.fetchImpl }), /listed but Cloudflare won’t give its value/);
});

test('the inventory tells Cloudflare being down from a permission the key lacks, and a Worker’s static files no one has checked are a problem', async () => {
  const { inventory, coverage } = await import('../src/inventory.js');
  const { cfApi } = await import('../src/sources.js');
  const world = createWorld({ gitDir: '/nowhere', repo: 'x/y', streamPublicJwk: null });
  world.workers.push({ name: 'site', modified: '2026-01-01T00:00:00Z', assets: true, files: null });
  world.faults.listingDown = '/queues';
  const api = cfApi({ CF_ACCOUNT_ID: ACCT, CF_BACKUP_TOKEN: 'cf-read-key' }, { fetchImpl: (url, init) => world.handle(new Request(url, init)), pace: 0, retryMs: 0, wait: async () => {} });
  const inv = await inventory(api, {});
  assert.deepEqual(inv.notListed.map((n) => [n.type, n.permission]), [['queues', null]], 'Cloudflare failing is never taken for a permission');
  assert.match(inv.notListed[0].why, /Cloudflare 500/);
  const cov = coverage(inv, { permissionsNamed: ['Workers Scripts Read'] });
  assert.deepEqual(cov.problems.map((p) => p.kind), ['coverage:list:queues', 'coverage:assets:site'], 'said even while a permission is named: it isn’t one');
  assert.doesNotMatch(cov.problems[0].text, /give the read-only key/);
});

test('settings keep a plain variable’s value and never a key’s, nor a plain one whose name looks like a key', () => {
  const out = redact({ script: { bindings: [{ name: 'MEDUSA_URL', type: 'plain_text', text: 'https://store.example' }, { name: 'K', type: 'secret_text', text: 'shh' }, { name: 'MY_TOKEN', type: 'plain_text', text: 'shh' }, { name: 'CONF', type: 'json', json: { a: 1 } }], env_vars: { ORIGIN: { type: 'plain_text', value: 'https://example.org' }, S: { type: 'secret_text', value: 'shh' } } } });
  assert.equal(JSON.stringify(out).includes('shh'), false);
  assert.equal(out.script.bindings[0].text, 'https://store.example');
  assert.deepEqual(out.script.bindings[3].json, { a: 1 });
  assert.deepEqual(out.script.env_vars, { ORIGIN: { type: 'plain_text', value: 'https://example.org' }, S: { type: 'secret_text' } });
});

test('the restore tool sets aside, with the command that sends it, a KV key whose metadata wrangler won’t take', async () => {
  const { encrypt } = await import('../src/stage.js');
  const { gzipSync } = await import('node:zlib');
  const { spawnSync } = await import('node:child_process');
  const { readFileSync } = await import('node:fs');
  const key = await newIdentity();
  const items = [{ key: 'a', value: 'eA==', base64: true, metadata: { n: 1 } }, { key: 'b', value: 'eQ==', base64: true, metadata: 'reader-1' }, { key: 'c', value: 'eg==', base64: true, metadata: 7 }, { key: 'd', value: 'eg==', base64: true }];
  const cipher = await encrypt(key.recipient, new Response(gzipSync(Buffer.from(JSON.stringify(items)))).body);
  const dir = mkdtempSync(join(tmpdir(), 'restore-kv2-'));
  try {
    const file = join(dir, 'p.json.gz.age');
    writeFileSync(file, Buffer.from(await new Response(cipher).arrayBuffer()));
    writeFileSync(join(dir, 'key.txt'), key.identity);
    const r = spawnSync('node', [join(dirname(fileURLToPath(import.meta.url)), '../scripts/restore.mjs'), 'kv', file, '--key', join(dir, 'key.txt')], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'p ready.json'))).map((x) => x.key), ['a', 'd']);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'p for the API.json'))).map((x) => [x.key, x.metadata]), [['b', 'reader-1'], ['c', 7]]);
    assert.match(r.stdout, /curl -X PUT .*\/storage\/kv\/namespaces\/.*\/bulk.*--data-binary @/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Vectorize: a vector the index listed but doesn’t give back, with the index unchanged, is trouble; once the index has changed it was removed', async () => {
  const { vectorizeListJob, vectorizePartJob } = await import('../src/extra.js');
  const world = createWorld({ gitDir: '/nowhere', repo: 'x/y', streamPublicJwk: null });
  const ix = { name: 'idx', dimensions: 2, metric: 'cosine', mutation: null, vectors: new Map() };
  world.vectorize.push(ix);
  for (let i = 1; i <= 4; i++) world.setVector(ix, `v${i}`, { values: [i, 0] });
  const b = memoryBackup(world, { VECTORIZE_PART: '10' });
  const l = await vectorizeListJob(b.env, b.state, ix, '2026-11-17', { fetchImpl: b.fetchImpl });
  world.faults.vectorWithheld = 'v3';
  await assert.rejects(vectorizePartJob(b.env, b.state, {}, ix, '2026-11-17', 1, l, { fetchImpl: b.fetchImpl }), /didn’t give back 1 vector/);
  // Removed since the listing: the index changed, so it's gone, and the next night copies the index again
  world.faults.vectorWithheld = null;
  ix.vectors.delete('v3'); ix.mutation = 'after-a-delete';
  const r = await vectorizePartJob(b.env, b.state, {}, ix, '2026-11-17', 1, l, { fetchImpl: b.fetchImpl });
  assert.equal(r.vectors, 3);
});

test('a permission lost later is an alert of its own; a Pages project or a regional bucket the backup doesn’t copy is named', async () => {
  const { setupKind } = await import('../src/jobs.js');
  const { coverage } = await import('../src/inventory.js');
  const one = setupKind({ home: 'cloudflare', why: 'the read-only key needs these added: AI Gateway Read (…)', missing: ['AI Gateway Read'] });
  const two = setupKind({ home: 'cloudflare', why: 'the read-only key needs these added: AI Gateway Read, Workers KV Storage Read (…)', missing: ['Workers KV Storage Read', 'AI Gateway Read'] });
  assert.notEqual(one, two);
  assert.equal(two, 'setup:cloudflare:needs AI Gateway Read, Workers KV Storage Read');
  assert.equal(setupKind({ home: 'b2', why: 'the Backblaze key can delete: make a key with read and write only' }), 'setup:b2:the Backblaze key can delete');
  const inv = { databases: [], buckets: [], regionBuckets: [{ name: 'eu-files', region: 'eu' }], kv: [], vectorize: [], workers: [], durableObjects: [], queues: [], hyperdrive: [], pipelines: [], notListed: [], pages: [{ name: 'soard-site', repo: 'org/soard-site' }, { name: 'other', repo: 'org/other' }, { name: 'upload', repo: null }] };
  assert.deepEqual(coverage(inv, { repos: ['org/soard-site'] }).problems.map((p) => p.kind), ['coverage:region:eu-files', 'coverage:pages:other', 'coverage:pages:upload']);
});

test('Vectorize: a listing shorter than the index, with the index unchanged, is trouble', async () => {
  const { vectorizeListJob } = await import('../src/extra.js');
  const world = createWorld({ gitDir: '/nowhere', repo: 'x/y', streamPublicJwk: null });
  const ix = { name: 'idx', dimensions: 2, metric: 'cosine', mutation: null, vectors: new Map() };
  world.vectorize.push(ix);
  for (let i = 1; i <= 3; i++) world.setVector(ix, `v${i}`, { values: [i, 0] });
  const b = memoryBackup(world);
  // The index says it holds one more than its listing names
  const real = world.handle;
  world.handle = async (req) => { const res = await real(req); if (new URL(req.url).pathname.endsWith('/info')) { const j = await res.json(); j.result.vectorCount += 1; return Response.json(j); } return res; };
  await assert.rejects(vectorizeListJob(b.env, b.state, ix, '2026-11-17', { fetchImpl: (url, init) => world.handle(new Request(url, init)) }), /listed 3 vectors, though it holds 4/);
});

test('the restore tool splits a big KV part into requests Cloudflare takes, and won’t open anything inside a synced folder', async () => {
  const { encrypt } = await import('../src/stage.js');
  const { gzipSync } = await import('node:zlib');
  const { spawnSync } = await import('node:child_process');
  const { readFileSync } = await import('node:fs');
  const tool = join(dirname(fileURLToPath(import.meta.url)), '../scripts/restore.mjs');
  const key = await newIdentity();
  const items = Array.from({ length: 1500 }, (_, i) => ({ key: `k${String(i).padStart(4, '0')}`, value: 'eA==', base64: true }));
  const cipher = await encrypt(key.recipient, new Response(gzipSync(Buffer.from(JSON.stringify(items)))).body);
  const dir = mkdtempSync(join(tmpdir(), 'restore-kv3-'));
  try {
    const file = join(dir, 'big.json.gz.age');
    writeFileSync(file, Buffer.from(await new Response(cipher).arrayBuffer()));
    writeFileSync(join(dir, 'key.txt'), key.identity);
    const r = spawnSync('node', [tool, 'kv', file, '--key', join(dir, 'key.txt')], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual([JSON.parse(readFileSync(join(dir, 'big ready 1.json'))).length, JSON.parse(readFileSync(join(dir, 'big ready 2.json'))).length], [1000, 500]);
    assert.equal((r.stdout.match(/kv bulk put/g) || []).length, 2);
    const synced = spawnSync('node', [tool, 'kv', join(dir, 'Library', 'CloudStorage', 'GoogleDrive-x', 'Shared drives', 'Website backup', 'p.json.gz.age'), '--key', join(dir, 'key.txt')], { encoding: 'utf8' });
    assert.equal(synced.status, 2);
    assert.match(synced.stderr, /syncs to the cloud/);
    // The key read from a synced folder is refused too, and a Windows OneDrive path
    assert.equal(spawnSync('node', [tool, 'kv', file, '--key', join(dir, 'Dropbox', 'key.txt')], { encoding: 'utf8' }).status, 2);
    assert.equal(spawnSync('node', [tool, 'kv', 'C:\\Users\\x\\OneDrive\\Desktop\\p.json.gz.age', '--key', join(dir, 'key.txt')], { encoding: 'utf8' }).status, 2);
    for (const team of ['C:\\Users\\x\\Dropbox (Sunshine on a Ranney Day)\\p.json.gz.age', '/Users/x/SOARD Dropbox/p.json.gz.age', 'C:\\Users\\x\\Box\\p.json.gz.age']) assert.equal(spawnSync('node', [tool, 'kv', team, '--key', join(dir, 'key.txt')], { encoding: 'utf8' }).status, 2, team);
    // A link into a synced folder is followed
    const { symlinkSync, mkdirSync } = await import('node:fs');
    mkdirSync(join(dir, 'Dropbox'), { recursive: true });
    symlinkSync(join(dir, 'Dropbox'), join(dir, 'looks-local'));
    assert.equal(spawnSync('node', [tool, 'kv', join(dir, 'looks-local', 'p.json.gz.age'), '--key', join(dir, 'key.txt')], { encoding: 'utf8' }).status, 2);
    // On a Mac, a folder iCloud syncs (marked by the Mac itself), as this Mac's Desktop is
    const { homedir } = await import('node:os');
    if (process.platform === 'darwin' && spawnSync('xattr', ['-p', 'com.apple.file-provider-domain-id', join(homedir(), 'Desktop')]).status === 0) {
      assert.equal(spawnSync('node', [tool, 'kv', join(homedir(), 'Desktop', 'never-made', 'p.json.gz.age'), '--key', join(dir, 'key.txt')], { encoding: 'utf8' }).status, 2);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('settings: a cursor is sent as Cloudflare gave it, an empty one ends a listing, and only a refusal of the domain registrations is a note', async () => {
  const { readSettings } = await import('../src/settings.js');
  const world = createWorld({ gitDir: '/nowhere', repo: 'x/y', streamPublicJwk: null });
  const env = { CF_ACCOUNT_ID: ACCT, CF_BACKUP_TOKEN: 'cf-read-key' };
  let calls = 0;
  const fetchImpl = (url, init) => { if (String(url).includes('/registrar/')) calls++; return world.handle(new Request(url, init)); };
  const r = await readSettings(env, { fetchImpl });
  assert.deepEqual(r.problems, [], JSON.stringify(r.problems));
  assert.deepEqual(r.json.accountRulesets.map((x) => x.id), ['rs-root'], 'the second page, by its cursor');
  assert.equal(calls, 1, 'a full page with an empty cursor is the end, not a reason to ask again');
  world.faults.registrations = 503;
  const down = await readSettings(env, { fetchImpl });
  assert.deepEqual(down.problems.map((p) => p.what), ['Domain registrations'], 'Cloudflare down is trouble');
  world.faults.registrations = 403;
  const refused = await readSettings(env, { fetchImpl });
  assert.deepEqual(refused.problems, []);
  assert.match(refused.off.map((o) => o.what).join(' '), /the domain registrations \(Cloudflare doesn’t let an account’s own key read them\)/);
});

test('settings: page rules, which Cloudflare never lets an account’s own key read, are one note and never trouble, refused or failing; read, they’re in the copy', async () => {
  const { readSettings, settingsSection, unreadOf } = await import('../src/settings.js');
  const world = createWorld({ gitDir: '/nowhere', repo: 'x/y', streamPublicJwk: null });
  const env = { CF_ACCOUNT_ID: ACCT, CF_BACKUP_TOKEN: 'cf-read-key' };
  const fetchImpl = (url, init) => world.handle(new Request(url, init));
  const note = 'the page rules of example.org (Cloudflare doesn’t let an account’s own key read them, so any page rules these domains have aren’t in the backup; a rule made under Rules instead is)';
  // As Cloudflare answers the backup's key: refused
  const refused = await readSettings(env, { fetchImpl });
  assert.deepEqual(refused.problems, [], JSON.stringify(refused.problems));
  assert.deepEqual(refused.off.map((o) => o.what), [note]);
  assert.deepEqual(refused.json.notRead, []);
  assert.deepEqual(refused.json.switchedOff.map((o) => o.what), [note], 'the copy says so too');
  assert.equal(refused.json.zones[0].pageRules, null);
  // Cloudflare failing them is the same: the key can't read them anyway
  world.faults.pagerules = 503;
  const failing = await readSettings(env, { fetchImpl });
  assert.deepEqual(failing.problems, []);
  assert.deepEqual(failing.off.map((o) => o.what), [note]);
  // Should Cloudflare ever let the key read them, they're in the copy and nothing is said
  world.faults.pagerules = 'ok';
  const read = await readSettings(env, { fetchImpl });
  assert.deepEqual(read.off, []);
  assert.equal(read.json.zones[0].pageRules[0].id, 'pr1');
  // Another setting refused is still trouble, its reason kept
  world.faults.pagerules = undefined;
  world.faults.settingsDenied = '/members';
  const other = await readSettings(env, { fetchImpl });
  assert.deepEqual(other.problems.map((p) => [p.what, p.why, p.refused]), [['Who can sign in to Cloudflare', 'the key isn’t allowed to read it', true]]);
  assert.deepEqual(other.off.map((o) => o.what), [note]);
  // As the run keeps it: a permission only for a refusal; Cloudflare failing a read that has one asks for none
  world.faults.settingsDenied = undefined;
  world.faults.denied = ['/zones/zone1/workers/routes'];
  assert.deepEqual(unreadOf((await readSettings(env, { fetchImpl })).problems), { notRead: ['example.org: Workers routes'], why: ['the key isn’t allowed to read it'], refused: [true], needs: ['Workers Routes Read'] });
  world.faults.denied = [];
  world.faults.settingsFail = '/zones/zone1/workers/routes';
  assert.deepEqual(unreadOf((await readSettings(env, { fetchImpl })).problems), { notRead: ['example.org: Workers routes'], why: ['Cloudflare 500: Internal error'], refused: [false], needs: [null] });
  world.faults.settingsFail = undefined;

  // A run's settings from before this was known (its page rules listed as not read, without reasons) is said the same way
  const old = { zones: 4, records: 141, notRead: ['a.org: page rules', 'Who can sign in to Cloudflare', 'b.org: page rules'], needs: [null, 'Account Settings Read', null], off: ['the domain registrations (x)'], shipped: true };
  assert.deepEqual(settingsSection(old), {
    zones: 4, records: 141, shipped: true, notRead: ['Who can sign in to Cloudflare'], needs: ['Account Settings Read'], why: [null], refused: [null],
    off: ['the domain registrations (x)', 'the page rules of a.org, b.org (Cloudflare doesn’t let an account’s own key read them, so any page rules these domains have aren’t in the backup; a rule made under Rules instead is)'],
  });
  // A run's own (reasons kept): each stays with its reason
  const own = { zones: 1, notRead: ['a.org: page rules', 'x: settings'], needs: [null, null], why: ['the key isn’t allowed to read it', 'Cloudflare 500'], refused: [true, false], off: [] };
  assert.deepEqual(settingsSection(own), { zones: 1, notRead: ['x: settings'], needs: [null], why: ['Cloudflare 500'], refused: [false], off: ['the page rules of a.org (Cloudflare doesn’t let an account’s own key read them, so any page rules these domains have aren’t in the backup; a rule made under Rules instead is)'] });
  assert.deepEqual(settingsSection(settingsSection(own)), settingsSection(own), 'the same however often it runs (a retried finish)');
  // Nothing to move: the very same section
  const clean = { zones: 1, notRead: ['x: settings'], needs: [null], why: ['Cloudflare 500'] };
  assert.equal(settingsSection(clean), clean);
  assert.equal(settingsSection(null), null);
});

test('the restore tool won’t open anything, nor read the key, inside a folder of code', async () => {
  const { spawnSync } = await import('node:child_process');
  const { mkdirSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'restore-repo-'));
  try {
    mkdirSync(join(dir, 'site', '.git'), { recursive: true });
    mkdirSync(join(dir, 'site', 'workers', 'backup'), { recursive: true });
    writeFileSync(join(dir, 'site', 'workers', 'backup', 'key.txt'), 'AGE-SECRET-KEY-PQ-1X');
    mkdirSync(join(dir, 'download'), { recursive: true });
    const tool = join(dirname(fileURLToPath(import.meta.url)), '../scripts/restore.mjs');
    const r = spawnSync('node', [tool, 'kv', join(dir, 'download', 'p.json.gz.age'), '--key', join(dir, 'site', 'workers', 'backup', 'key.txt')], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /inside a folder of code/);
    const missing = spawnSync('node', [tool, 'kv', join(dir, 'download', 'p.json.gz.age'), '--key', join(dir, 'download', 'key.txt')], { encoding: 'utf8' });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /There's no key file at/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('GitHub busy (429, or a 5xx) is asked again, as long as GitHub says, before it’s trouble', async () => {
  const { githubFetch } = await import('../src/github.js');
  const waits = [];
  let n = 0;
  const fetchImpl = async () => (++n < 3 ? new Response('slow down', { status: 429, headers: { 'retry-after': n === 1 ? '7' : '' } }) : new Response('ok'));
  const res = await githubFetch(fetchImpl, 'https://github.com/x/y.git/info/refs', {}, { wait: async (ms) => { waits.push(ms); } });
  assert.equal(res.status, 200);
  assert.deepEqual(waits, [7000, 10000], 'Retry-After first, then a little longer each time');
  let m = 0;
  const always = await githubFetch(async () => { m++; return new Response('no', { status: 503 }); }, 'u', {}, { wait: async () => {} });
  assert.equal(always.status, 503);
  assert.equal(m, 5, 'four more tries, then it’s said');
  const notFound = await githubFetch(async () => new Response('no', { status: 404 }), 'u', {}, { wait: async () => { throw new Error('a 404 is never waited on'); } });
  assert.equal(notFound.status, 404);
});
