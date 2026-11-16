/**
 * Every copy is made once: encrypted with age (https://age-encryption.org, the tool's own author's JavaScript
 * version) for SOARD's backup key, and kept in the backup's own R2 bucket (STAGING) until it's safely in both
 * homes. Shipping then only moves those fixed bytes, so Google Drive and Backblaze hold the very same file, and an
 * upload cut off part way carries on where it stopped.
 *
 * The key is a post-quantum hybrid age key (ML-KEM-768 + X25519): what's encrypted today stays private even
 * against a future quantum computer. Only its public half (the recipient) is used here; the private half is
 * printed on the recovery sheet and kept in the backup's own storage for the weekly restore drill.
 */
import { Encrypter, Decrypter, generateHybridIdentity, identityToRecipient } from 'age-encryption';
import { createHash } from 'node:crypto';

export const PART = 16 * 1024 * 1024; // R2 parts, Drive pieces and Backblaze parts alike (a multiple of 256 KiB, over 5 MB)

export async function newIdentity() {
  const identity = await generateHybridIdentity();
  const recipient = await identityToRecipient(identity);
  return { identity, recipient, fingerprint: await fingerprint(recipient) };
}

/** A short, readable check of which key a backup is for: printed on the recovery sheet and in the READ ME */
export async function fingerprint(recipient) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(recipient)));
  const h = [...d.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return h.match(/.{4}/g).join('-');
}

export async function encrypt(recipient, input) {
  const e = new Encrypter();
  e.addRecipient(recipient);
  return e.encrypt(input);
}

export async function decrypt(identity, input) {
  const d = new Decrypter();
  d.addIdentity(identity);
  return d.decrypt(input);
}

/** MD5 (Google), SHA-1 (Backblaze) and SHA-256 (the manifest) of bytes as they go by */
export function hasher() {
  const md5 = createHash('md5');
  const sha1 = createHash('sha1');
  const sha256 = createHash('sha256');
  let size = 0;
  return {
    update(b) { md5.update(b); sha1.update(b); sha256.update(b); size += b.length; },
    result() { return { size, md5: md5.digest('hex'), sha1: sha1.digest('hex'), sha256: sha256.digest('hex') }; },
  };
}

/** A stream that hashes what passes through it; `done()` gives the hashes once it has ended */
export function hashing() {
  const h = hasher();
  let result = null;
  const ts = new TransformStream({
    transform(chunk, c) { h.update(chunk); c.enqueue(chunk); },
    flush() { result = h.result(); },
  });
  return { stream: ts, done: () => result };
}

const toStream = (bytes) => new Response(bytes).body;

/**
 * Encrypts `input` (bytes or a stream) and keeps the result in STAGING at `key`. `gzip` squeezes it first
 * (the database SQL; photos and videos are already compressed). Returns the plain and stored hashes and size.
 */
export async function stageEncrypted(env, key, input, { recipient, gzip = false }) {
  let plain = input instanceof Uint8Array ? toStream(input) : input;
  const inner = hashing();
  plain = plain.pipeThrough(gzip ? new CompressionStream('gzip') : new TransformStream()).pipeThrough(inner.stream);
  const cipher = await encrypt(recipient, plain);
  const outer = hashing();
  await putStream(env.STAGING, key, cipher.pipeThrough(outer.stream));
  const stored = outer.done();
  const head = await env.STAGING.head(key);
  if (!head || head.size !== stored.size) throw new Error(`The staged copy ${key} is ${head?.size ?? 'missing'} bytes, not ${stored.size}`);
  return { plain: inner.done(), stored };
}

/** A stream into R2: one put when it's small, otherwise a multipart upload of equal parts (R2's rule) */
export async function putStream(bucket, key, stream) {
  const reader = stream.getReader();
  let buf = new Uint8Array(PART);
  let fill = 0;
  let upload = null;
  const parts = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      let at = 0;
      while (at < value.length) {
        const n = Math.min(PART - fill, value.length - at);
        buf.set(value.subarray(at, at + n), fill);
        fill += n;
        at += n;
        if (fill === PART) {
          upload ||= await bucket.createMultipartUpload(key);
          parts.push(await upload.uploadPart(parts.length + 1, buf));
          buf = new Uint8Array(PART);
          fill = 0;
        }
      }
    }
    if (!upload) { await bucket.put(key, buf.slice(0, fill)); return; }
    if (fill) parts.push(await upload.uploadPart(parts.length + 1, buf.slice(0, fill)));
    await upload.complete(parts);
  } catch (e) {
    if (upload) await upload.abort().catch(() => {});
    reader.cancel().catch(() => {});
    throw e;
  }
}

/** Bytes [start, start + length) of a staged copy */
export async function stagedRange(env, key, start, length) {
  const obj = await env.STAGING.get(key, { range: { offset: start, length } });
  if (!obj) throw new Error(`The staged copy ${key} is gone`);
  const bytes = new Uint8Array(await obj.arrayBuffer());
  if (bytes.length !== length) throw new Error(`Read ${bytes.length} of ${length} bytes of ${key}`);
  return bytes;
}
