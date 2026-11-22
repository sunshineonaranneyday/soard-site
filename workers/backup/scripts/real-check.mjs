#!/usr/bin/env node
/**
 * The database copy, proved on a real D1 database without writing to it: reads it with the backup's own reader
 * (src/db.js, exactly as the Worker does, through D1's HTTP API with a read-only key), retrying until it gets one
 * quiet moment; writes the SQL; restores it two ways (Node's SQLite, and the sqlite3 tool as a person would);
 * reads both restores back the same way and compares every table's fingerprint with the original's.
 * The copies are deleted afterwards: they hold real data.
 *
 *   ENV_FILE=<path to the site's .env> node scripts/real-check.mjs <database id> [<database id> …]
 *   (.env needs CLOUDFLARE_ACCOUNT_ID and a read-only CLOUDFLARE_API_TOKEN with D1 Read)
 */
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { readDatabase, d1Http, Moved } from '../src/db.js';

const env = Object.fromEntries(readFileSync(process.env.ENV_FILE || '.env', 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]));
const ids = process.argv.slice(2);
if (!ids.length) { console.error('Usage: ENV_FILE=<.env> node scripts/real-check.mjs <database id> …'); process.exit(2); }
const local = (db) => ({ bookmark: async () => 'here', batch: async (stmts) => stmts.map(({ sql, params = [] }) => db.prepare(sql).all(...params).map((r) => Object.values(r))) });
let bad = 0;
for (const id of ids) {
  const dir = mkdtempSync(join(tmpdir(), 'backup-real-'));
  try {
    const source = d1Http({ accountId: env.CLOUDFLARE_ACCOUNT_ID, databaseId: id, token: env.CLOUDFLARE_API_TOKEN });
    const t0 = Date.now();
    let read;
    let chunks;
    for (let attempt = 1; ; attempt++) {
      chunks = [];
      const began = Date.now();
      try { read = await readDatabase(source, { label: id, write: (b) => { chunks.push(Buffer.from(b)); } }); read.attempts = attempt; read.ms = Date.now() - began; break; } catch (e) {
        if (e instanceof Moved) console.log(`  try ${attempt}: the database was written to during the read (${((Date.now() - began) / 1000).toFixed(1)} s)`);
        if (e instanceof Moved && attempt < 30) { await new Promise((r) => setTimeout(r, 4000)); continue; }
        throw e;
      }
    }
    const sql = Buffer.concat(chunks);
    const longest = Math.max(...sql.toString('utf8').split(';\n').map((s) => Buffer.byteLength(s)));
    console.log(`${id}: ${Object.keys(read.tables).length} tables, ${read.statements} statements, ${(sql.length / 1e6).toFixed(1)} MB of SQL, read at one moment on try ${read.attempts} (that read took ${(read.ms / 1000).toFixed(1)} s; ${((Date.now() - t0) / 1000).toFixed(0)} s in all), longest statement ${longest.toLocaleString('en-US')} bytes`);
    const file = join(dir, 'restore.sql');
    writeFileSync(file, sql);
    const node = new DatabaseSync(':memory:');
    node.exec(sql.toString('utf8'));
    execFileSync('sqlite3', ['-bail', join(dir, 'restored.sqlite')], { input: sql });
    const tool = new DatabaseSync(join(dir, 'restored.sqlite'));
    for (const [name, db] of [["Node's SQLite", node], ['the sqlite3 tool', tool]]) {
      const back = await readDatabase(local(db), { label: name });
      const names = [...new Set([...Object.keys(read.tables), ...Object.keys(back.tables)])];
      const off = names.filter((t) => read.tables[t]?.digest !== back.tables[t]?.digest);
      if (off.length) bad++;
      console.log(`  restored by ${name}: ${off.length ? `DIFFERENT: ${off.join(', ')}` : `all ${names.length} tables exactly as read`} (${back.objects.indexes} indexes, ${back.objects.triggers} triggers, ${back.objects.views} views)`);
    }
    tool.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
process.exit(bad ? 1 : 0);
