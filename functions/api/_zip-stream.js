/**
 * A ZIP written as it downloads (Admin → Photos & Videos, ./media-download.js)
 * ===========================================================================
 * Photos are already compressed, so each file is stored as it is (no
 * deflate). Files are added one at a time and only one is held in memory, so
 * an album of 250 full-size photos never has to fit in a Worker at once. No
 * ZIP64: the caller keeps a ZIP well under 4 GB (ZIP_MAX photos).
 *
 *   const zip = zipStream();
 *   (async () => { await zip.add('a.jpg', bytes); …; await zip.close(); })();
 *   return new Response(zip.readable, { headers: { 'Content-Type': 'application/zip' } });
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes, start = 0) {
  let crc = (start ^ 0xFFFFFFFF) >>> 0;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/** DOS date and time (local fields of the date given) */
function dos(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const year = Math.min(Math.max(d.getFullYear(), 1980), 2107);
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const FLAG_UTF8 = 0x0800; // file names are UTF-8
const FLAG_LATER = 0x0008; // the CRC and sizes follow the file (a data descriptor): it's written as it arrives

function localHeader(name, crc, size, when, flags = FLAG_UTF8) {
  const h = new Uint8Array(30 + name.length);
  const v = new DataView(h.buffer);
  v.setUint32(0, 0x04034B50, true);
  v.setUint16(4, 20, true);
  v.setUint16(6, flags, true);
  v.setUint16(8, 0, true); // stored
  v.setUint16(10, when.time, true);
  v.setUint16(12, when.date, true);
  v.setUint32(14, crc, true);
  v.setUint32(18, size, true);
  v.setUint32(22, size, true);
  v.setUint16(26, name.length, true);
  v.setUint16(28, 0, true);
  h.set(name, 30);
  return h;
}

function centralEntry(name, crc, size, offset, when, flags = FLAG_UTF8) {
  const e = new Uint8Array(46 + name.length);
  const v = new DataView(e.buffer);
  v.setUint32(0, 0x02014B50, true);
  v.setUint16(4, 20, true);
  v.setUint16(6, 20, true);
  v.setUint16(8, flags, true);
  v.setUint16(10, 0, true);
  v.setUint16(12, when.time, true);
  v.setUint16(14, when.date, true);
  v.setUint32(16, crc, true);
  v.setUint32(20, size, true);
  v.setUint32(24, size, true);
  v.setUint16(28, name.length, true);
  v.setUint16(30, 0, true);
  v.setUint16(32, 0, true);
  v.setUint16(34, 0, true);
  v.setUint16(36, 0, true);
  v.setUint32(38, 0, true);
  v.setUint32(42, offset, true);
  e.set(name, 46);
  return e;
}

function endRecord(count, dirSize, dirOffset) {
  const r = new Uint8Array(22);
  const v = new DataView(r.buffer);
  v.setUint32(0, 0x06054B50, true);
  v.setUint16(8, count, true);
  v.setUint16(10, count, true);
  v.setUint32(12, dirSize, true);
  v.setUint32(16, dirOffset, true);
  return r;
}

/**
 * { readable, add(name, bytes, date?), close(), abort(err) }. add and close wait for the reader (backpressure), so a
 * slow download never piles files up in memory. A name used twice gets " (2)" before its extension.
 */
export function zipStream({ now = new Date() } = {}) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const dir = [];
  const used = new Set();
  let offset = 0;
  const write = async (chunk) => { await writer.ready; await writer.write(chunk); offset += chunk.length; };
  const unique = (name) => {
    // (a folder in the name stays one: each part cleaned, never an empty part or a step up)
    let n = String(name || 'file').split('/').map((p) => p.replace(/[\\:*?"<>|\u0000-\u001f]+/g, '-').trim()).filter((p) => p && p !== '.' && p !== '..').join('/') || 'file';
    if (!used.has(n.toLowerCase())) { used.add(n.toLowerCase()); return n; }
    const dot = n.lastIndexOf('.');
    for (let i = 2; ; i++) {
      const m = dot > 0 ? `${n.slice(0, dot)} (${i})${n.slice(dot)}` : `${n} (${i})`;
      if (!used.has(m.toLowerCase())) { used.add(m.toLowerCase()); return m; }
    }
  };
  return {
    readable,
    get count() { return dir.length; },
    async add(name, data, date = now) {
      const bytes = data instanceof Uint8Array ? data : typeof data === 'string' ? enc.encode(data) : new Uint8Array(data);
      const nameBytes = enc.encode(unique(name));
      const when = dos(date);
      const crc = crc32(bytes);
      const at = offset;
      await write(localHeader(nameBytes, crc, bytes.length, when));
      await write(bytes);
      dir.push(centralEntry(nameBytes, crc, bytes.length, at, when));
    },
    /**
     * A file read as it arrives (a ReadableStream: a photo straight from Drive or JobTread), never whole in memory: its
     * CRC and size go in a data descriptor after it. Over `max` bytes it stops and throws (the ZIP is cut short there,
     * so the caller adds no more and closes). → the bytes written
     */
    async addStream(name, readable, date = now, { max = 0xFFFFFFF0 } = {}) {
      const nameBytes = enc.encode(unique(name));
      const when = dos(date);
      const flags = FLAG_UTF8 | FLAG_LATER;
      const at = offset;
      await write(localHeader(nameBytes, 0, 0, when, flags));
      let crc = 0;
      let size = 0;
      const reader = readable.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
        size += chunk.length;
        if (size > max) { await reader.cancel().catch(() => {}); throw new Error('too big for one ZIP'); }
        crc = crc32(chunk, crc);
        await write(chunk);
      }
      const d = new Uint8Array(16);
      const v = new DataView(d.buffer);
      v.setUint32(0, 0x08074B50, true);
      v.setUint32(4, crc, true);
      v.setUint32(8, size, true);
      v.setUint32(12, size, true);
      await write(d);
      dir.push(centralEntry(nameBytes, crc, size, at, when, flags));
      return size;
    },
    /** Bytes written so far */
    get written() { return offset; },
    async close() {
      const start = offset;
      for (const e of dir) await write(e);
      await write(endRecord(dir.length, offset - start, start));
      await writer.close();
    },
    async abort(err) { try { await writer.abort(err); } catch { /* already closed */ } },
  };
}
