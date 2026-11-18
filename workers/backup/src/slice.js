/**
 * A copy of any size proved to open, a slice at a time (the restore drill, ./jobs.js). Read whole, the website's
 * first full code copy (1.36 GB, Nov 17, 2026) ran a Worker out of its 128 MB of memory three times over; a slice
 * is a step of its own, so no step holds more than a slice however large the copy.
 *
 * It's the age format (age-encryption.org/v1), as the age tool and ./stage.js write it: a header whose MAC only the
 * backup key can check, a 16-byte nonce, then the payload in chunks of 64 KiB of plaintext and a 16-byte tag each,
 * ChaCha20-Poly1305 with an 11-byte counter and a last-chunk flag for its nonce. Every chunk's tag is checked, so a
 * byte changed anywhere, a chunk swapped or moved, a copy cut short or with anything added fails; what opens is
 * exactly what was encrypted (whose bytes were hashed as they were copied, and a code bundle's own checksum checked).
 */
import { Decrypter } from 'age-encryption';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { bytesToHex } from '@noble/hashes/utils.js';

export const CHUNK = 64 * 1024 + 16;
// 32 MB a slice by default: a slice's bytes, held whole, still fit a Worker's memory twice over. Fixed in the drill's
// plan (`per`), so a deploy part way through can't change what a slice covers
export const chunksPerSlice = (env = {}) => Math.max(1, Math.floor(Number(env.DRILL_SLICE_BYTES || 32 * 1024 * 1024) / CHUNK));
/** How many slices a copy of `size` bytes takes (never fewer than it needs: its header can only make it fewer) */
export const slicesFor = (per, size) => Math.max(1, Math.ceil(Math.ceil(size / CHUNK) / per));

/** A copy that doesn't open as it should (not a home that couldn't be reached, which is tried again) */
export class OpenError extends Error {
  constructor(message) { super(message); this.name = 'OpenError'; }
}

const HEAD = 64 * 1024;
// The byte after the header's last line ("--- " and its MAC)
function headerEnd(b) {
  for (let i = 0; i + 4 < b.length; i++) {
    if (b[i] === 0x0a && b[i + 1] === 0x2d && b[i + 2] === 0x2d && b[i + 3] === 0x2d && b[i + 4] === 0x20) {
      const nl = b.indexOf(0x0a, i + 1);
      if (nl > 0) return nl + 1;
      break;
    }
  }
  throw new OpenError('its header never ends');
}
const nonceFor = (i, last) => {
  const n = new Uint8Array(12);
  for (let j = 10, x = i; j >= 0 && x > 0; j--, x = Math.floor(x / 256)) n[j] = x % 256;
  n[11] = last ? 1 : 0;
  return n;
};

/**
 * Slice `slice` (of `per` chunks each) of a copy of `size` bytes: `read(start, end)` gives those bytes (end
 * included) as a Response. `starts` (bytes), if given, is what the copy must open to first. Returns { from, to,
 * count, head }: the chunks it checked (to < from when the slice is past the copy's end) out of the copy's count,
 * and the SHA-256 of the header it read; the slices together must cover every chunk, 0 to count - 1, all under the
 * same header (a file replaced part way through a check is another file). Throws OpenError for a copy that doesn't open; anything
 * else (a home not answering) is for trying again.
 */
export async function checkSlice({ identity, size, read, slice, per, starts = null }) {
  if (!(per >= 1)) throw new Error('a slice’s size is needed');
  if (!(size > 0)) throw new OpenError('it’s empty');
  const head = new Uint8Array(await (await read(0, Math.min(size, HEAD) - 1)).arrayBuffer());
  const end = headerEnd(head);
  const d = new Decrypter();
  d.addIdentity(identity);
  let fileKey;
  try { fileKey = await d.decryptHeader(head.subarray(0, end)); } catch (e) { throw new OpenError(`the backup key doesn’t open it (${String(e?.message || e).slice(0, 80)})`); }
  const nonce = head.subarray(end, end + 16);
  if (nonce.length !== 16) throw new OpenError('it ends inside its header');
  const streamKey = hkdf(sha256, fileKey, nonce, new TextEncoder().encode('payload'), 32);
  const at = end + 16;
  const length = size - at;
  if (length < 16) throw new OpenError('it has no payload');
  const count = Math.ceil(length / CHUNK);
  const first = slice * per;
  const headHash = bytesToHex(sha256(head.subarray(0, at)));
  if (first >= count) return { from: first, to: first - 1, count, head: headHash };
  const lastIdx = Math.min(count, first + per) - 1;
  // (the slice with the final chunk asks for a byte past the copy's end: a copy that grew has one to give)
  const res = await read(at + first * CHUNK, lastIdx === count - 1 ? size : at + (lastIdx + 1) * CHUNK - 1);
  const reader = res.body.getReader();
  const buf = new Uint8Array(CHUNK);
  let rest = new Uint8Array(0);
  for (let i = first; i <= lastIdx; i++) {
    const final = i === count - 1;
    const want = final ? length - (count - 1) * CHUNK : CHUNK;
    let fill = 0;
    while (fill < want) {
      if (!rest.length) {
        const { value, done } = await reader.read();
        if (done) throw new OpenError(`it ends part way (chunk ${i + 1} of ${count})`);
        rest = value;
      }
      const n = Math.min(want - fill, rest.length);
      buf.set(rest.subarray(0, n), fill);
      fill += n;
      rest = rest.subarray(n);
    }
    let plain;
    try { plain = chacha20poly1305(streamKey, nonceFor(i, final)).decrypt(buf.subarray(0, want)); } catch { throw new OpenError(`chunk ${i + 1} of ${count} doesn’t open (changed, moved, or not the copy’s last)`); }
    // Only a copy of nothing may end in an empty chunk (the age format's rule)
    if (final && count > 1 && plain.length === 0) throw new OpenError('it ends in an empty chunk');
    if (i === 0 && starts && !starts.every((b, j) => plain[j] === b)) throw new OpenError('it doesn’t open to what it should start with');
  }
  // Nothing past what this slice should hold
  for (;;) {
    if (rest.length) throw new OpenError('it’s longer than its chunks');
    const { value, done } = await reader.read();
    if (done) break;
    rest = value;
  }
  return { from: first, to: lastIdx, count, head: headHash };
}
