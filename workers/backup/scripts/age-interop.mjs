#!/usr/bin/env node
/**
 * The backup's encryption against the real age tool (age-encryption.org, v1.3 or newer, on PATH), both ways:
 * a key the backup makes is one age reads (age-keygen -y gives back the same recipient), every copy the backup
 * makes opens with `age -d -i key.txt`, and a file age encrypts for the backup's key opens with the backup's own
 * code (the restore tool). Sizes on and around age's 64 KiB chunks, and a big one.
 *   node scripts/age-interop.mjs <an empty folder to work in>
 */
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { newIdentity, encrypt, decrypt } from '../src/stage.js';

const dir = process.argv[2];
if (!dir) { console.error('Usage: node scripts/age-interop.mjs <empty folder>'); process.exit(2); }
mkdirSync(dir, { recursive: true });
const sha = (b) => createHash('sha256').update(b).digest('hex');
const bytesOf = async (stream) => Buffer.from(await new Response(stream).arrayBuffer());
const streamOf = (b) => new Response(b).body;

console.log(execFileSync('age', ['--version'], { encoding: 'utf8' }).trim(), '(the real age tool)');
const key = await newIdentity();
const keyFile = join(dir, 'key.txt');
writeFileSync(keyFile, `# the recovery sheet's key\n${key.identity}\n`);
const fromAge = execFileSync('age-keygen', ['-y', keyFile], { encoding: 'utf8' }).trim();
if (fromAge !== key.recipient) throw new Error(`age-keygen -y gives ${fromAge.slice(0, 20)}…, not the backup's recipient`);
console.log(`the key: age reads it, and gives back the very recipient the backup encrypts for (${key.recipient.slice(0, 12)}…, ${key.recipient.length} characters)`);

const K = 64 * 1024;
const sizes = [0, 1, K - 1, K, K + 1, 2 * K, 3 * K + 17, 20 * 1024 * 1024 + 5];
let n = 0;
for (const size of sizes) {
  const plain = randomBytes(size);
  // The backup encrypts; the real age opens
  const sealed = await bytesOf(await encrypt(key.recipient, streamOf(plain)));
  writeFileSync(join(dir, `b${size}.age`), sealed);
  const opened = execFileSync('age', ['-d', '-i', keyFile, join(dir, `b${size}.age`)], { maxBuffer: 64 * 1024 * 1024 });
  if (sha(opened) !== sha(plain)) throw new Error(`${size} bytes: age opened something else`);
  // The real age encrypts for the backup's key; the backup's code opens
  writeFileSync(join(dir, `p${size}`), plain);
  execFileSync('age', ['-e', '-r', key.recipient, '-o', join(dir, `a${size}.age`), join(dir, `p${size}`)]);
  const back = await bytesOf(await decrypt(key.identity, streamOf(readFileSync(join(dir, `a${size}.age`)))));
  if (sha(back) !== sha(plain)) throw new Error(`${size} bytes: the backup's code opened something else`);
  n++;
}
console.log(`${n} sizes (${sizes.join(', ')} bytes): every one the backup sealed opens with age, and every one age sealed opens with the backup’s code, byte for byte`);
// A damaged copy is refused, not opened wrong
const bad = readFileSync(join(dir, `b${K + 1}.age`));
bad[bad.length - 5] ^= 1;
writeFileSync(join(dir, 'damaged.age'), bad);
let refused = false;
try { execFileSync('age', ['-d', '-i', keyFile, join(dir, 'damaged.age')], { stdio: ['ignore', 'ignore', 'ignore'] }); } catch { refused = true; }
if (!refused) throw new Error('age opened a damaged copy');
console.log('a damaged copy: age refuses it');
