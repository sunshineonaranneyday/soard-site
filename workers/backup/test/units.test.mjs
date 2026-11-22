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
