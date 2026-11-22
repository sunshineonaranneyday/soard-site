/**
 * The backup's encryption against the real age tool, the one the READ ME tells a person to use (scripts/age-interop.mjs
 * says what's checked). Runs when age v1.3 or newer is installed (brew install age); says it's skipped otherwise.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const age = spawnSync('age', ['--version'], { encoding: 'utf8' });
const version = age.status === 0 ? age.stdout.trim() : null;
const recent = version && (([maj, min]) => maj > 1 || (maj === 1 && min >= 3))(version.replace(/^v/, '').split('.').map(Number));

test('the real age tool and the backup open each other’s files, byte for byte', { skip: recent ? false : `the age tool (v1.3 or newer) isn’t installed${version ? ` (this is ${version})` : ''}` }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'soard-age-'));
  try {
    const out = execFileSync('node', [join(dirname(fileURLToPath(import.meta.url)), '../scripts/age-interop.mjs'), dir], { encoding: 'utf8' });
    assert.match(out, /gives back the very recipient/);
    assert.match(out, /every one the backup sealed opens with age, and every one age sealed opens with the backup’s code/);
    assert.match(out, /a damaged copy: age refuses it/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
