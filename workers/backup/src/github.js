/**
 * The code, with all its history: each repo as a git bundle, the file git itself makes with `git bundle` and
 * restores with `git clone <file>`. It's fetched the way `git clone` fetches, over GitHub's smart HTTP with a
 * read-only key (GITHUB_BACKUP_TOKEN: Contents read on SOARD's repos), so no copy of git is needed here.
 *
 * The first copy of the month holds everything; on other nights a repo that changed gets a bundle of only what's
 * new since the last copy (its earlier tips are the bundle's prerequisites, as `git bundle create … ^old` writes).
 * A restore clones the month's full bundle and fetches the nights after it in order (the READ ME says how).
 *
 * The pack's own SHA-1 trailer is checked as it streams by, so a cut-off or damaged download is never kept.
 */
import { createHash } from 'node:crypto';

export class GitError extends Error {
  constructor(message) { super(message); this.name = 'GitError'; }
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const pkt = (s) => { const b = enc.encode(s); return `${(b.length + 4).toString(16).padStart(4, '0')}${s}`; };
const auth = (token) => `Basic ${btoa(`x-access-token:${token}`)}`;

/** The repo's refs: { head, refs: { 'refs/heads/main': sha, … } } (branches and tags) */
export async function listRefs(env, repo, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`https://github.com/${repo}.git/info/refs?service=git-upload-pack`, { headers: { Authorization: auth(env.GITHUB_BACKUP_TOKEN), 'User-Agent': 'soard-backup' } });
  if (!res.ok) throw new GitError(`GitHub ${res.status} listing ${repo}${res.status === 401 || res.status === 404 ? ' (the key can’t read it)' : ''}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const refs = {};
  let head = null;
  for (const line of pktLines(bytes)) {
    if (line === null) continue;
    const text = dec.decode(line).replace(/\n$/, '');
    if (text.startsWith('#')) continue;
    const [refPart] = text.split('\0');
    const m = /^([0-9a-f]{40}) (\S+)$/.exec(refPart);
    if (!m) continue;
    if (m[2] === 'HEAD') head = m[1];
    else if (/^refs\/(heads|tags)\//.test(m[2]) && !m[2].endsWith('^{}')) refs[m[2]] = m[1];
  }
  return { head, refs };
}

// pkt-lines of a whole buffer (null for a flush)
function* pktLines(b) {
  let i = 0;
  while (i + 4 <= b.length) {
    const n = parseInt(dec.decode(b.subarray(i, i + 4)), 16);
    if (Number.isNaN(n)) throw new GitError('GitHub sent something that isn’t git');
    if (n === 0) { yield null; i += 4; continue; }
    yield b.subarray(i + 4, i + n);
    i += n;
  }
}

/**
 * A bundle of `repo` as a stream: everything reachable from its refs, minus what's reachable from `have` (earlier
 * tips, which become the bundle's prerequisites). Returns { stream, done } where done() resolves to the pack's
 * object count once the stream has been read through and its checksum has matched.
 */
export async function bundleStream(env, repo, { refs, head, have = [], fetchImpl = fetch }) {
  const wants = [...new Set(Object.values(refs))];
  if (!wants.length) throw new GitError(`${repo} has no branches`);
  const haves = [...new Set(have)].filter((h) => /^[0-9a-f]{40}$/.test(h));
  let body = pkt(`want ${wants[0]} side-band-64k ofs-delta no-progress agent=soard-backup/1\n`);
  for (const w of wants.slice(1)) body += pkt(`want ${w}\n`);
  body += '0000';
  for (const h of haves) body += pkt(`have ${h}\n`);
  body += pkt('done\n');
  const res = await fetchImpl(`https://github.com/${repo}.git/git-upload-pack`, {
    method: 'POST',
    headers: { Authorization: auth(env.GITHUB_BACKUP_TOKEN), 'Content-Type': 'application/x-git-upload-pack-request', Accept: 'application/x-git-upload-pack-result', 'User-Agent': 'soard-backup' },
    body,
  });
  if (!res.ok) throw new GitError(`GitHub ${res.status} fetching ${repo}`);

  // The bundle's header: prerequisites first, then the refs it brings (HEAD so a clone checks out main)
  let header = '# v2 git bundle\n';
  for (const h of haves) header += `-${h} earlier copy\n`;
  if (head) header += `${head} HEAD\n`;
  for (const [name, sha] of Object.entries(refs)) header += `${sha} ${name}\n`;
  header += '\n';

  let objects = null;
  let finished;
  const done = new Promise((ok, no) => { finished = { ok, no }; });
  const sha1 = createHash('sha1');
  let tail = new Uint8Array(0); // the last 20 bytes seen, which may be the checksum
  let packBytes = 0;
  let pending = new Uint8Array(0); // pkt-line bytes not yet complete
  let started = false;
  const reader = res.body.getReader();
  const stream = new ReadableStream({
    async start(c) { c.enqueue(enc.encode(header)); },
    async pull(c) {
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) {
          if (pending.length) return fail(c, 'GitHub’s answer ended part way through');
          if (!started || packBytes < 32) return fail(c, `GitHub sent no pack for ${repo}`);
          const want = sha1.digest('hex');
          const got = [...tail].map((x) => x.toString(16).padStart(2, '0')).join('');
          if (want !== got) return fail(c, `the pack for ${repo} doesn’t match its own checksum`);
          c.close();
          finished.ok({ objects, bytes: packBytes });
          return;
        }
        const buf = new Uint8Array(pending.length + value.length);
        buf.set(pending);
        buf.set(value, pending.length);
        let i = 0;
        const out = [];
        while (i + 4 <= buf.length) {
          const n = parseInt(dec.decode(buf.subarray(i, i + 4)), 16);
          if (Number.isNaN(n)) return fail(c, 'GitHub sent something that isn’t git');
          if (n === 0) { i += 4; continue; }
          if (i + n > buf.length) break;
          const line = buf.subarray(i + 4, i + n);
          i += n;
          if (!started) {
            const text = dec.decode(line);
            if (text.startsWith('NAK') || text.startsWith('ACK')) { started = true; continue; }
            if (text.startsWith('ERR')) return fail(c, `GitHub: ${text.slice(4).trim()}`);
            if (line[0] !== 1 && line[0] !== 2 && line[0] !== 3) continue;
            started = true;
          }
          const band = line[0];
          if (band === 1) out.push(line.slice(1));
          else if (band === 3) return fail(c, `GitHub: ${dec.decode(line.subarray(1)).trim()}`);
        }
        pending = buf.slice(i);
        for (const chunk of out) {
          if (packBytes === 0 && chunk.length >= 12) {
            if (dec.decode(chunk.subarray(0, 4)) !== 'PACK') return fail(c, 'GitHub’s pack doesn’t start like one');
            objects = new DataView(chunk.buffer, chunk.byteOffset).getUint32(8);
          }
          // Everything but the last 20 bytes goes into the checksum
          const joined = new Uint8Array(tail.length + chunk.length);
          joined.set(tail);
          joined.set(chunk, tail.length);
          const keep = Math.max(0, joined.length - 20);
          sha1.update(joined.subarray(0, keep));
          tail = joined.slice(keep);
          packBytes += chunk.length;
          c.enqueue(chunk);
        }
        if (out.length) return;
      }
    },
    cancel() { reader.cancel().catch(() => {}); },
  });
  function fail(c, message) {
    const e = new GitError(message);
    c.error(e);
    finished.no(e);
    reader.cancel().catch(() => {});
  }
  done.catch(() => {});
  return { stream, done: () => done };
}
