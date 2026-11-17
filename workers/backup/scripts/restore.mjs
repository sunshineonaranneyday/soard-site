#!/usr/bin/env node
/**
 * Puts a backup back on a computer (the READ ME FIRST in the backup drive says the same with the age tool alone).
 * Needs Node 22.13 or newer.   cd workers/backup && npm ci --omit=dev
 *
 *   A database: download a folder from Database → name → year (one night's .sql.gz.age and its manifest.json,
 *   or the whole year: then the newest night is used, or the one you name with --night 2026-11-14).
 *     node scripts/restore.mjs database <folder> --key <folder>/key.txt [--night <night>] [--check]
 *       checks the copy is the one its manifest names, opens it, writes <night> restore.sql in the folder;
 *       --check also builds it into a database on this computer and compares every table with the manifest
 *     Then, into a new EMPTY D1 database:  npx wrangler d1 execute <its name> --remote --file "<that file>"
 *
 *   Files: download a folder of .age files (photos, videos, R2 files, settings, code).
 *     node scripts/restore.mjs files <folder> --key <folder>/key.txt [--list "<folder>/<night> files.json.gz.age"]
 *       opens each one beside itself, without the .age (streamed, so big videos are fine). With --list (that
 *       night's list, from Files → Lists), each file also gets back its original name and folder, under
 *       <folder>/restored/<where it came from>/.
 *
 *   A Worker's code (from Workers/), once opened with age:
 *     node scripts/restore.mjs worker <the opened code file> <a new folder>
 *       writes each of its files into the folder, as Cloudflare ran them (its main module is named in the .json beside
 *       the copy).
 *
 *   A KV part (from KV/, as its manifest names it):
 *     node scripts/restore.mjs kv "<folder>/<the part>.json.gz.age" --key <folder>/key.txt
 *       opens it into "<the part> ready.json" for wrangler kv bulk put, leaving out any key that has expired.
 *
 * key.txt holds the key from the recovery sheet (it starts AGE-SECRET-KEY-PQ-1); line breaks and spaces inside
 * it don't matter. Nothing here touches Cloudflare.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, createReadStream, createWriteStream, renameSync, rmSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { Readable, Writable } from 'node:stream';
import { Decrypter } from 'age-encryption';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) { console.error(`This needs Node 22.13 or newer (this is ${process.versions.node}).`); process.exit(2); }

const [what, dir, ...rest] = process.argv.slice(2);
const opt = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : null; };

// What this tool opens is plain: it must never land in a folder that syncs to the cloud (and so back into the drive),
// nor may the key be read from one. A Mac marks every folder a cloud provider syncs (Google Drive, iCloud, including a
// Desktop or Documents folder iCloud keeps, Dropbox, OneDrive); the names catch the rest, Windows too
const SYNCED = /\/Library\/CloudStorage\/|\/Google ?Drive\/|\/My Drive\/|\/Shared drives\/|\/Dropbox( \([^/]*\))?\/|\/[^/]* Dropbox\/|\/OneDrive|\/Box( Sync)?\/|\/iCloud ?Drive\/|\/Mobile Documents\//i;
const realOf = (p) => {
  let x = resolve(p);
  const tail = [];
  for (;;) {
    try { return join(realpathSync(x), ...tail.reverse()); } catch { const up = dirname(x); if (up === x) return resolve(p); tail.push(basename(x)); x = up; }
  }
};
function syncedFolder(p) {
  const full = realOf(p).replace(/\\/g, '/');
  if (SYNCED.test(`${full}/`)) return true;
  if (process.platform === 'darwin') {
    for (let d = full; d !== dirname(d); d = dirname(d)) {
      if (spawnSync('xattr', ['-p', 'com.apple.file-provider-domain-id', d], { stdio: 'ignore' }).status === 0) return true;
    }
  }
  return false;
}
// Nor inside a folder of code (a git work tree): the website's code is public, and one "git add" would publish it
function inCode(p) {
  for (let d = dirname(realOf(p)); d !== dirname(d); d = dirname(d)) if (existsSync(join(d, '.git'))) return d;
  return null;
}
for (const p of [dir, what === 'worker' ? rest[0] : null, opt('--key')].filter(Boolean)) {
  const repo = inCode(p);
  if (repo) {
    console.error(`${p} is inside a folder of code (${repo}). Keep the backup files and key.txt in a download folder of their own (Downloads, usually), and give the tool that folder's whole path: what it opens is plain, the key opens every backup, and this code may be public.`);
    process.exit(2);
  }
  if (syncedFolder(p)) {
    console.error(`${p} is in a folder that syncs to the cloud (Google Drive, iCloud, Dropbox or OneDrive: on a Mac the Desktop and Documents folders often are). Download the backup files and key.txt into a folder on this computer that doesn't sync (Downloads, usually), and run this there: what it opens is plain, and must never go back into the drive.`);
    process.exit(2);
  }
}

// A Worker's code, opened with age already: Cloudflare's one file of its modules, split back into each file (or,
// for a Worker in the older single-file form, that one file, as index.js)
if (what === 'worker') {
  const out = rest[0];
  if (!dir || !out) { console.error('Usage: node scripts/restore.mjs worker <the opened code file> <a new folder>'); process.exit(2); }
  const body = readFileSync(dir);
  const crlf = body.indexOf('\r\n');
  const firstLine = crlf > 0 ? body.subarray(0, crlf).toString('latin1') : '';
  if (!/^--\S+$/.test(firstLine)) {
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'index.js'), body);
    console.log(`  index.js\nWrote 1 file into ${out} (a Worker in the single-file form: main = "index.js").`);
    process.exit(0);
  }
  const boundary = Buffer.from(`\r\n${firstLine}`);
  const parts = [];
  let at = firstLine.length + 2;
  for (;;) {
    const end = body.indexOf(boundary, at);
    if (end < 0) break;
    parts.push(body.subarray(at, end));
    at = end + boundary.length;
    if (body.subarray(at, at + 2).toString('latin1') === '--') break;
    at += 2;
  }
  if (!parts.length) { console.error(`No files found in ${dir}.`); process.exit(1); }
  let wrote = 0;
  const left = [];
  for (const part of parts) {
    const split = part.indexOf('\r\n\r\n');
    const head = part.subarray(0, split).toString('utf8');
    const name = /filename="([^"]+)"/.exec(head)?.[1] || /name="([^"]+)"/.exec(head)?.[1] || '';
    // Each file lands inside the folder: never an absolute name, and no part of a name may be ".."
    const segments = name.split(/[\\/]+/);
    if (!name || /^[\\/]|^[A-Za-z]:/.test(name) || segments.some((x) => x === '..' || x === '.' || x === '')) { left.push(name); continue; }
    const file = join(out, ...segments);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, part.subarray(split + 4));
    console.log(`  ${segments.join('/')}`);
    wrote++;
  }
  console.log(`Wrote ${wrote} file${wrote === 1 ? '' : 's'} into ${out}.`);
  if (left.length) { console.error(`${left.length} part${left.length === 1 ? ' was' : 's were'} left out, as ${left.length === 1 ? 'its name' : 'their names'} would land outside the folder: ${left.join(', ')}`); process.exit(1); }
  process.exit(0);
}

const keyFile = opt('--key');
if (!['database', 'files', 'kv'].includes(what) || !dir || !keyFile) {
  console.error('Usage (each with the download folder\u2019s whole path, key.txt kept there):\n  node scripts/restore.mjs database <folder> --key <folder>/key.txt [--night 2026-11-14] [--check]\n  node scripts/restore.mjs files <folder> --key <folder>/key.txt [--list "<folder>/<night> files.json.gz.age"]\n  node scripts/restore.mjs kv "<folder>/<a KV part>.json.gz.age" --key <folder>/key.txt');
  process.exit(2);
}
// The key as typed from paper: any spaces or line breaks inside it are dropped
if (!existsSync(keyFile)) { console.error(`There's no key file at ${keyFile}: type the key from the recovery sheet into key.txt in the download folder, and give its whole path after --key.`); process.exit(1); }
const typed = readFileSync(keyFile, 'utf8').replace(/\s+/g, '').toUpperCase();
const identity = /AGE-SECRET-KEY-(?:PQ-)?1[02-9AC-HJ-NP-Z]+/.exec(typed)?.[0];
if (!identity) { console.error(`${keyFile} has no key in it: it should start AGE-SECRET-KEY-PQ-1, as on the recovery sheet.`); process.exit(1); }
const decrypter = () => { const d = new Decrypter(); d.addIdentity(identity); return d; };
const open = async (bytes) => Buffer.from(await decrypter().decrypt(new Uint8Array(bytes)));
// One KV part: opened and unzipped into "<part> ready.json" beside it, for `wrangler kv bulk put`, without any key
// whose expiry has passed or is under a minute away (it would be gone anyway, and Cloudflare takes no expiry less
// than 60 seconds ahead). wrangler takes metadata only as a JSON object; a key whose metadata is a string, number,
// true/false or a list goes into "<part> for the API.json" instead, which Cloudflare's own API takes (the command
// to send it is printed)
if (what === 'kv') {
  const from = resolve(dir);
  const items = JSON.parse(gunzipSync(await open(readFileSync(from))).toString('utf8'));
  if (!Array.isArray(items)) { console.error(`${dir} isn’t a KV part (it should hold a list of keys).`); process.exit(1); }
  const soon = Math.floor(Date.now() / 1000) + 60;
  const live = items.filter((x) => !(x.expiration && x.expiration < soon));
  const wranglerTakes = (x) => x.metadata === undefined || (x.metadata !== null && typeof x.metadata === 'object' && !Array.isArray(x.metadata));
  const ready = live.filter(wranglerTakes);
  const api = live.filter((x) => !wranglerTakes(x));
  const base = from.replace(/\.json\.gz\.age$/, '');
  // One file for each request Cloudflare takes: at most 1,000 keys and well under its 100 MB a request
  const files = [];
  let chunk = [];
  let bytes = 0;
  for (const x of ready) {
    const size = Buffer.byteLength(JSON.stringify(x)) + 1;
    if (chunk.length && (chunk.length >= 1000 || bytes + size > 90_000_000)) { files.push(chunk); chunk = []; bytes = 0; }
    chunk.push(x);
    bytes += size;
  }
  files.push(chunk);
  files.forEach((c, i) => {
    const name = `${base} ready${files.length > 1 ? ` ${i + 1}` : ''}.json`;
    writeFileSync(name, JSON.stringify(c));
    console.log(`Wrote ${c.length} key${c.length === 1 ? '' : 's'} into ${name}${i === 0 && items.length > live.length ? ` (${items.length - live.length} left out: expired)` : ''}.`);
    console.log(`  then: npx wrangler kv bulk put "${name}" --namespace-id <the new namespace's id> --remote`);
  });
  if (api.length) {
    writeFileSync(`${base} for the API.json`, JSON.stringify(api));
    console.log(`Wrote ${api.length} key${api.length === 1 ? '' : 's'} whose metadata isn’t a JSON object (wrangler won’t take ${api.length === 1 ? 'it' : 'them'}) into ${base} for the API.json. Send ${api.length === 1 ? 'it' : 'them'} with a Cloudflare key that can write KV:`);
    console.log(`  curl -X PUT "https://api.cloudflare.com/client/v4/accounts/<the account id>/storage/kv/namespaces/<the new namespace's id>/bulk" -H "Authorization: Bearer <the key>" -H "Content-Type: application/json" --data-binary @"${base} for the API.json"`);
  }
  process.exit(0);
}
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
