#!/usr/bin/env node
/**
 * Puts a backup back on a computer (the READ ME FIRST in the backup drive says the same with the age tool alone).
 * Needs Node 22.13 or newer.   cd workers/backup && npm ci --omit=dev
 *
 *   A database: download a folder from Database → name → year (one night's .sql.gz.age and its manifest.json,
 *   or the whole year: then the newest night is used, or the one you name with --night 2026-11-14).
 *     node scripts/restore.mjs database <folder> --key key.txt [--night <night>] [--check]
 *       checks the copy is the one its manifest names, opens it, writes <night> restore.sql in the folder;
 *       --check also builds it into a database on this computer and compares every table with the manifest
 *     Then, into a new EMPTY D1 database:  npx wrangler d1 execute <its name> --remote --file "<that file>"
 *
 *   Files: download a folder of .age files (photos, videos, R2 files, settings, code).
 *     node scripts/restore.mjs files <folder> --key key.txt [--list "<night> files.json.gz.age"]
 *       opens each one beside itself, without the .age (streamed, so big videos are fine). With --list (that
 *       night's list, from Files → Lists), each file also gets back its original name and folder, under
 *       <folder>/restored/<where it came from>/.
 *
 * key.txt holds the key from the recovery sheet (it starts AGE-SECRET-KEY-PQ-1); line breaks and spaces inside
 * it don't matter. Nothing here touches Cloudflare.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, createReadStream, createWriteStream, renameSync, rmSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { Readable, Writable } from 'node:stream';
import { Decrypter } from 'age-encryption';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) { console.error(`This needs Node 22.13 or newer (this is ${process.versions.node}).`); process.exit(2); }

const [what, dir, ...rest] = process.argv.slice(2);
const opt = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : null; };
const keyFile = opt('--key');
if (!['database', 'files'].includes(what) || !dir || !keyFile) {
  console.error('Usage:\n  node scripts/restore.mjs database <folder> --key key.txt [--night 2026-11-14] [--check]\n  node scripts/restore.mjs files <folder> --key key.txt [--list "<night> files.json.gz.age"]');
  process.exit(2);
}
// The key as typed from paper: any spaces or line breaks inside it are dropped
const typed = readFileSync(keyFile, 'utf8').replace(/\s+/g, '').toUpperCase();
const identity = /AGE-SECRET-KEY-(?:PQ-)?1[02-9AC-HJ-NP-Z]+/.exec(typed)?.[0];
if (!identity) { console.error(`${keyFile} has no key in it: it should start AGE-SECRET-KEY-PQ-1, as on the recovery sheet.`); process.exit(1); }
const decrypter = () => { const d = new Decrypter(); d.addIdentity(identity); return d; };
const open = async (bytes) => Buffer.from(await decrypter().decrypt(new Uint8Array(bytes)));
const folder = resolve(dir);

/**
 * Opens one .age file into `out`, streaming, under a temporary name until the whole file has opened: a copy cut
 * short or damaged (age checks every piece) leaves nothing behind that could pass for the real file.
 */
async function openFile(from, out) {
  mkdirSync(dirname(out), { recursive: true });
  const part = `${out}.part`;
  try {
    const plain = await decrypter().decrypt(Readable.toWeb(createReadStream(from)));
    await plain.pipeTo(Writable.toWeb(createWriteStream(part)));
    renameSync(part, out);
  } catch (e) {
    rmSync(part, { force: true });
    throw e;
  }
}

if (what === 'files') {
  let named = null;
  const listFile = opt('--list');
  if (listFile) {
    const list = JSON.parse(gunzipSync(await open(readFileSync(listFile))).toString('utf8'));
    named = new Map(list.files.filter((f) => f.path).map((f) => [basename(f.path), f]));
    console.log(`The list of the run of ${list.run || list.night}: ${named.size} files.`);
  }
  let n = 0;
  let renamed = 0;
  const failed = [];
  const walk = async (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) { if (name !== 'restored') await walk(p); continue; }
      if (!name.endsWith('.age') || (listFile && resolve(p) === resolve(listFile))) continue;
      const f = named?.get(name);
      const out = f ? join(folder, 'restored', f.source.replace(/[:/\\]/g, ' '), ...String(f.key).split('/').filter((s) => s && s !== '..' && s !== '.')) : p.slice(0, -4);
      if (existsSync(out)) { console.log(`  already open: ${out}`); continue; }
      // One file that won't open (cut short, damaged) is listed at the end; the rest still open
      try { await openFile(p, out); } catch (e) { failed.push(`${p}: ${String(e.message || e).slice(0, 160)}`); continue; }
      n++;
      if (f) renamed++;
    }
  };
  await walk(folder);
  console.log(`Opened ${n} file${n === 1 ? '' : 's'}${named ? `, ${renamed} under their original names in ${join(folder, 'restored')}` : ''}.`);
  if (failed.length) {
    console.error(`\n${failed.length} file${failed.length === 1 ? '' : 's'} wouldn’t open (cut short or damaged: download it again, from the other home if need be):`);
    for (const f of failed) console.error(`  ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

// A database: the nights in the folder, each with its copy and its manifest
const names = readdirSync(folder);
const nights = new Map();
for (const name of names) {
  const m = /^(\d{4}-\d{2}-\d{2}(?: \d{4})?) (.+?)( manifest\.json|\.sql\.gz\.age)$/.exec(name);
  if (!m) continue;
  const k = `${m[1]}|${m[2]}`;
  const e = nights.get(k) || { night: m[1], db: m[2] };
  if (m[3] === ' manifest.json') e.manifest = name; else e.copy = name;
  nights.set(k, e);
}
const wanted = opt('--night');
const whole = [...nights.values()].filter((e) => e.manifest && e.copy && (!wanted || e.night === wanted)).sort((a, b) => a.night.localeCompare(b.night));
if (!whole.length) {
  console.error(wanted ? `No night ${wanted} with both its .sql.gz.age and its manifest.json in ${folder}.` : `${folder} has no night with both its .sql.gz.age and its manifest.json.`);
  process.exit(1);
}
const pick = whole[whole.length - 1];
if (!wanted && whole.length > 1) console.log(`${whole.length} nights here; using the newest, ${pick.night} (name another with --night).`);
const manifest = JSON.parse(readFileSync(join(folder, pick.manifest), 'utf8'));
const sealed = readFileSync(join(folder, pick.copy));
const sha = createHash('sha256').update(sealed).digest('hex');
if (sha !== manifest.file.sha256) { console.error(`${pick.copy} isn't the copy its manifest names: it's damaged or cut short. Download it again.`); process.exit(1); }
console.log(`${manifest.what}, the run of ${manifest.run || manifest.night}: the copy matches its manifest.`);
const sql = gunzipSync(await open(sealed));
const out = join(folder, `${pick.night} ${pick.db} restore.sql`);
writeFileSync(out, sql);
const tables = Object.entries(manifest.tables);
console.log(`Wrote ${out}: ${tables.length} tables, ${tables.reduce((s, [, t]) => s + t.rows, 0).toLocaleString('en-US')} rows.`);

if (rest.includes('--check')) {
  const { DatabaseSync } = await import('node:sqlite');
  const { readDatabase } = await import('../src/db.js');
  const db = new DatabaseSync(':memory:');
  db.exec(sql.toString('utf8'));
  const back = await readDatabase({ bookmark: async () => 'here', batch: async (stmts) => stmts.map(({ sql: q, params = [] }) => db.prepare(q).all(...params).map((r) => Object.values(r))) });
  const off = tables.filter(([name, t]) => back.tables[name]?.digest !== t.digest);
  if (off.length) { for (const [name] of off) console.error(`  ${name} came back different`); process.exit(1); }
  console.log(`Built it on this computer: every one of the ${tables.length} tables is exactly as copied.`);
}
console.log(`\nNext: make a new, empty D1 database in Cloudflare, then run\n  npx wrangler d1 execute <its name> --remote --file "${out}"`);
