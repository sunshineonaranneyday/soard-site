/**
 * SQL that D1 itself can run, written from values known exactly.
 *
 * Every value is read as a short "form" (./db.js reads them; the restore drill reads them back the same way):
 *   n            NULL
 *   i<digits>    an integer, as SQLite writes it (never through a JavaScript number, which rounds past 2^53)
 *   r<quote()>   a real, as SQLite's quote() writes it: exact, and valid SQL (9.0e+999 for infinity)
 *   t<HEX>       text, as its bytes: a NUL, a carriage return or bytes that aren't UTF-8 all survive
 *   b<HEX>       a blob, as its bytes
 * A row's forms joined with | are what its digest is made of, so the copy and a restore of it can be compared
 * exactly, byte for byte, without either side's code being involved in the other's check.
 *
 * Writing: rows grouped into INSERTs under STATEMENT_MAX (D1 refuses a statement over 100 KB), text with a
 * NUL or carriage return or bytes that aren't UTF-8 written as CAST(X'…' AS TEXT) (the sqlite3 tool drops a
 * carriage return before a line break; SQLite stops a quoted string at NUL), and a row too big for one
 * statement built up in a holding table a piece at a time, then copied into its table whole, so CHECK rules
 * only ever see the whole value.
 */

export const STATEMENT_MAX = 90_000; // D1's limit is 100 KB a statement
const PIECE = 32_000; // a long value's piece, in bytes (64 KB once written as hex)
export const HOLD = '_restore_big';

const enc = new TextEncoder();
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export class SqlError extends Error {
  constructor(message) { super(message); this.name = 'SqlError'; }
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0').toUpperCase());
export function hex(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += HEX[bytes[i]];
  return s;
}
export function unhex(s) {
  if (s.length % 2) throw new SqlError('odd hex');
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    const v = parseInt(s.substr(i * 2, 2), 16);
    if (Number.isNaN(v)) throw new SqlError('not hex');
    out[i] = v;
  }
  return out;
}

export const qi = (s) => `"${String(s).replace(/"/g, '""')}"`;

/** The SELECT expression that reads one column as its form */
export const formOf = (c) => `CASE typeof(${c}) WHEN 'integer' THEN 'i' || CAST(${c} AS TEXT) WHEN 'real' THEN 'r' || quote(${c}) WHEN 'text' THEN 't' || hex(CAST(${c} AS BLOB)) WHEN 'blob' THEN 'b' || hex(${c}) ELSE 'n' END`;

const INTEGER = /^-?\d{1,19}$/;
const REAL = /^-?(?:\d+\.\d+(?:e[-+]\d+)?|\d+(?:e[-+]\d+))$/i;

/** A form as SQL that D1 reads back as exactly the same value, as bytes */
export function literal(form) {
  const k = form[0];
  const s = form.slice(1);
  if (k === 'n') { if (s) throw new SqlError(`bad form ${form.slice(0, 20)}`); return NULL; }
  if (k === 'i') { if (!INTEGER.test(s)) throw new SqlError(`bad integer ${s.slice(0, 30)}`); return enc.encode(s); }
  if (k === 'r') { if (!REAL.test(s)) throw new SqlError(`bad real ${s.slice(0, 30)}`); return enc.encode(s); }
  if (k === 'b') { if (s.length % 2 || /[^0-9A-F]/.test(s)) throw new SqlError('bad blob'); return enc.encode(`X'${s}'`); }
  if (k === 't') {
    const b = unhex(s);
    if (b.includes(0) || b.includes(0x0d) || !isUtf8(b)) return enc.encode(`CAST(X'${s}' AS TEXT)`);
    let quotes = 0;
    for (const c of b) if (c === 0x27) quotes++;
    const out = new Uint8Array(b.length + quotes + 2);
    let at = 0;
    out[at++] = 0x27;
    for (const c of b) { out[at++] = c; if (c === 0x27) out[at++] = 0x27; }
    out[at++] = 0x27;
    return out;
  }
  throw new SqlError(`unknown form ${form.slice(0, 20)}`);
}
const NULL = enc.encode('NULL');
function isUtf8(b) {
  try { utf8.decode(b); return true; } catch { return false; }
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
const COMMA = enc.encode(',');
const OPEN = enc.encode('(');
const CLOSE = enc.encode(')');
const END = enc.encode(';\n');

/**
 * Writes one table's rows as statements, a row at a time: add(forms) then end(). `write(bytes)` gets each
 * statement (with its ; and a newline), in order. With `rowid` (rowid, oid or _rowid_), each row's first form is
 * its rowid and goes back under that name, so the row keeps its rowid.
 */
export function tableWriter(table, cols, write, { rowid = null } = {}) {
  const names = [...(rowid ? [rowid] : []), ...cols.map(qi)];
  const head = enc.encode(`INSERT INTO ${qi(table)} (${names.join(',')}) VALUES`);
  let rows = [];
  let size = head.length + 2;
  const flush = async () => {
    if (!rows.length) return;
    const parts = [head];
    rows.forEach((r, i) => { if (i) parts.push(COMMA); parts.push(r); });
    parts.push(END);
    rows = [];
    size = head.length + 2;
    await write(concat(parts));
  };
  return {
    async add(forms) {
      if (forms.length !== names.length) throw new SqlError(`${table}: a row with ${forms.length} values for ${names.length} columns`);
      const lits = forms.map(literal);
      const rowSize = lits.reduce((s, l) => s + l.length + 1, 1);
      if (head.length + rowSize + 2 > STATEMENT_MAX) {
        await flush();
        for (const s of bigRow(table, names, forms, lits)) await write(typeof s === 'string' ? enc.encode(s) : s);
        return;
      }
      if (size + rowSize + 1 > STATEMENT_MAX) await flush();
      const parts = [OPEN];
      lits.forEach((l, i) => { if (i) parts.push(COMMA); parts.push(l); });
      parts.push(CLOSE);
      rows.push(concat(parts));
      size += rowSize + 1;
    },
    end: flush,
  };
}

// A row too big for one statement: its longest values built up a piece at a time in a holding table first
// (`names` are the columns as written: quoted, and the rowid's bare name first when kept)
function bigRow(table, names, forms, lits) {
  const head = `INSERT INTO ${qi(table)} (${names.join(',')})`;
  const order = forms.map((_, i) => i).sort((a, b) => lits[b].length - lits[a].length);
  const held = new Set();
  let rest = head.length + 200 + lits.reduce((s, l) => s + l.length + 12, 0);
  for (const i of order) {
    if (rest <= STATEMENT_MAX - 2000) break;
    if (forms[i][0] !== 't' && forms[i][0] !== 'b') throw new SqlError(`a row in ${table} is too long and isn’t text`);
    held.add(i);
    rest -= lits[i].length;
  }
  if (rest > STATEMENT_MAX - 2000) throw new SqlError(`a row in ${table} has too many long values`);
  const keep = [...held];
  const out = [`DROP TABLE IF EXISTS ${HOLD};\n`, `CREATE TABLE ${HOLD} (${keep.map((i) => `v${i}`).join(', ')});\n`,
    `INSERT INTO ${HOLD} VALUES (${keep.map(() => "X''").join(', ')});\n`];
  for (const i of keep) {
    const h = forms[i].slice(1);
    for (let at = 0; at < h.length; at += PIECE * 2) out.push(`UPDATE ${HOLD} SET v${i} = v${i} || X'${h.slice(at, at + PIECE * 2)}';\n`);
  }
  // || joins the bytes as they are; the cast says which kind the value is. The rest go in as written.
  const select = [];
  forms.forEach((f, i) => {
    if (i) select.push(enc.encode(', '));
    select.push(held.has(i) ? enc.encode(`CAST(v${i} AS ${f[0] === 'b' ? 'BLOB' : 'TEXT'})`) : lits[i]);
  });
  out.push(concat([enc.encode(`${head} SELECT `), ...select, enc.encode(` FROM ${HOLD};\n`)]), `DROP TABLE ${HOLD};\n`);
  return out;
}

// A table's digest: its row count and the sum of every row's SHA-256, so row order doesn't matter but every
// byte of every value does
const MASK = (1n << 256n) - 1n;

/**
 * A form as the digest sees it. Reals are written the one way JavaScript writes a double (its shortest exact
 * spelling), because SQLite's quote() spells the same double differently from version to version (one writes
 * 4.94065645841247e-324, a newer one 4.9406564584124654e-324: both exact, same bits). Without this, a restore
 * into a newer SQLite would look different when it isn't. Everything else is already one spelling: integers in
 * decimal, text and blobs as their bytes in upper-case hex.
 */
export function canonical(form) {
  if (form[0] !== 'r') return form;
  const n = Number(form.slice(1));
  if (Number.isNaN(n)) throw new SqlError(`bad real ${form.slice(1, 30)}`);
  return `r${Object.is(n, -0) ? '-0' : String(n)}`;
}

export function digester() {
  let rows = 0;
  let sum = 0n;
  return {
    async add(forms) {
      const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(forms.map(canonical).join('|'))));
      let n = 0n;
      for (const x of d) n = (n << 8n) | BigInt(x);
      sum = (sum + n) & MASK;
      rows++;
    },
    get value() { return `${rows}:${sum.toString(16).padStart(64, '0')}`; },
  };
}

const isWord = (c) => (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x5f || c === 0x24 || c >= 0x80;
const isSpace = (c) => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x0c;

/**
 * Splits SQL text (bytes, in chunks of any size) into statements, the way SQLite would: a ; inside '…', "…",
 * `…`, […], a comment, or a trigger's BEGIN … END doesn't end one. push(chunk) and end() give the statements
 * finished so far, as bytes ending with their ;. Used by the restore drill to replay a copy into D1.
 */
export function createSplitter() {
  let buf = new Uint8Array(1 << 16);
  let len = 0;
  let start = 0;
  let at = 0;
  let state = 0; // 0 plain, 1 '…', 2 "…", 3 `…`, 4 […], 5 -- comment, 6 /* */; 11-13 just after a closing quote
  let word = '';
  let words = [];
  // The last two things seen outside quotes and comments: a trigger's body ends at "; END ;" (SQLite's own rule),
  // so a CASE … END inside it doesn't end the statement
  let last = '';
  let beforeLast = '';
  const trigger = () => words[0] === 'CREATE' && (words[1] === 'TRIGGER' || ((words[1] === 'TEMP' || words[1] === 'TEMPORARY') && words[2] === 'TRIGGER'));
  const see = (t) => { beforeLast = last; last = t; };
  const endWord = () => { if (!word) return; const w = word.toUpperCase(); if (words.length < 3) words.push(w); see(w); word = ''; };
  const scan = (final) => {
    const out = [];
    while (at < len) {
      const c = buf[at];
      if (state >= 11) { const q = state === 11 ? 0x27 : state === 12 ? 0x22 : 0x60; if (c === q) { state -= 10; at++; continue; } state = 0; continue; }
      if (state >= 1 && state <= 3) { if (c === (state === 1 ? 0x27 : state === 2 ? 0x22 : 0x60)) state += 10; at++; continue; }
      if (state === 4) { if (c === 0x5d) state = 0; at++; continue; }
      if (state === 5) { if (c === 0x0a) state = 0; at++; continue; }
      if (state === 6) {
        if (c === 0x2a) { if (at + 1 >= len && !final) break; if (buf[at + 1] === 0x2f) { state = 0; at += 2; continue; } }
        at++;
        continue;
      }
      if (isWord(c)) { word += String.fromCharCode(c < 0x80 ? c : 0x5f); at++; continue; }
      endWord();
      if (c === 0x27) { state = 1; see('quoted'); }
      else if (c === 0x22) { state = 2; see('quoted'); }
      else if (c === 0x60) { state = 3; see('quoted'); }
      else if (c === 0x5b) { state = 4; see('quoted'); }
      else if (c === 0x2d || c === 0x2f) {
        if (at + 1 >= len && !final) break;
        if (c === 0x2d && buf[at + 1] === 0x2d) { state = 5; at += 2; continue; }
        if (c === 0x2f && buf[at + 1] === 0x2a) { state = 6; at += 2; continue; }
        see(String.fromCharCode(c));
      } else if (c === 0x3b) {
        if (!trigger() || (last === 'END' && beforeLast === ';')) {
          const s = buf.slice(start, at + 1);
          at++;
          start = at;
          words = [];
          last = '';
          beforeLast = '';
          if (!blank(s)) out.push(s);
          continue;
        }
        see(';');
      } else if (!isSpace(c)) see(String.fromCharCode(c));
      at++;
    }
    return out;
  };
  return {
    push(chunk) {
      if (len + chunk.length > buf.length) {
        const keep = len - start;
        if (keep + chunk.length <= buf.length) buf.copyWithin(0, start, len);
        else { const next = new Uint8Array(Math.max(buf.length * 2, (keep + chunk.length) * 2)); next.set(buf.subarray(start, len)); buf = next; }
        at -= start;
        len = keep;
        start = 0;
      }
      buf.set(chunk, len);
      len += chunk.length;
      return scan(false);
    },
    end() {
      const out = scan(true);
      if (state !== 0 && state !== 5) throw new SqlError('the SQL ends inside a quote or comment: it was cut short');
      if (!blank(buf.subarray(start, len))) throw new SqlError('the SQL ends with an unfinished statement');
      return out;
    },
  };
}

// Only spaces, comments and ;
function blank(s) {
  let i = 0;
  while (i < s.length) {
    if (isSpace(s[i]) || s[i] === 0x3b) { i++; continue; }
    if (s[i] === 0x2d && s[i + 1] === 0x2d) { while (i < s.length && s[i] !== 0x0a) i++; continue; }
    if (s[i] === 0x2f && s[i + 1] === 0x2a) { let j = i + 2; while (j < s.length - 1 && !(s[j] === 0x2a && s[j + 1] === 0x2f)) j++; i = j + 2; continue; }
    return false;
  }
  return true;
}
