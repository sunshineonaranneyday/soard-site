/**
 * A D1 database read exactly, all at one moment, and written out as SQL that D1 can run into an empty database.
 *
 * Exact: every value is read as its form (./sql.js): integers and reals as SQLite writes them, text and blobs as
 * their bytes. Nothing goes through a JavaScript number or a JSON string on the way.
 *
 * One moment: D1 has no read transaction that spans many queries, but every write moves the database's
 * time-travel bookmark at once, and reads never do (tested Nov 13, 2026). So the bookmark is read before and
 * after: when they're the same, nothing was written in between, and the copy is the database exactly as it was
 * at that bookmark. When they differ, the copy is thrown away (Moved) and read again in a quiet moment.
 * Cloudflare's own export was tried first and isn't exact (it rounds integers past 2^53, writes whole reals as
 * integers and infinity as `Infinity`, replaces bytes that aren't UTF-8, and writes NUL raw).
 *
 * What it writes, in order:
 *   PRAGMA defer_foreign_keys = true;  the tables (parents before the tables whose rows point at them); their rows;
 *   sqlite_sequence; then indexes, triggers (after the rows, so none fire on a restore) and views.
 * The same reader, given no `write`, reads a restored copy back into digests for the restore drill.
 */
import { qi, formOf, tableWriter, digester, SqlError } from './sql.js';

export class Moved extends Error {
  constructor(before, after) { super('the database was written to while it was being read'); this.name = 'Moved'; this.before = before; this.after = after; }
}

const API = 'https://api.cloudflare.com/client/v4';
const PASSING = new Set([429, 500, 502, 503, 504]);

/** A database through D1's HTTP API with a read-only key: { bookmark(), batch([{ sql, params }]) → [rows[]] } */
export function d1Http({ accountId, databaseId, token, fetchImpl = fetch, wait = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const base = `${API}/accounts/${accountId}/d1/database/${databaseId}`;
  const ask = async (path, init) => {
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetchImpl(`${base}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
      } catch (e) {
        if (attempt < 3) { await wait(1000 * (attempt + 1)); continue; }
        throw e;
      }
      const body = await res.json().catch(() => null);
      if (res.ok && body?.success !== false) return body.result;
      if (attempt < 3 && PASSING.has(res.status)) { await wait(1000 * (attempt + 1)); continue; }
      throw new SqlError(`D1 ${res.status}: ${body?.errors?.map((e) => e.message).join('; ') || res.statusText}`.slice(0, 400));
    }
  };
  return {
    async bookmark() { return (await ask('/time_travel/bookmark', { method: 'GET' })).bookmark; },
    async batch(stmts) {
      const result = await ask('/raw', { method: 'POST', body: JSON.stringify({ batch: stmts.map(({ sql, params = [] }) => ({ sql, params })) }) });
      return result.map((r) => r.results?.rows || []);
    },
  };
}

/** A database through a Worker binding (the restore drill's own scratch database) */
export function d1Binding(DB) {
  return {
    async bookmark() { return 'binding'; },
    async batch(stmts) {
      const out = await DB.batch(stmts.map(({ sql, params = [] }) => DB.prepare(sql).bind(...params)));
      return out.map((r) => (r.results || []).map((row) => Object.values(row)));
    },
  };
}

const INTERNAL = (col) => `substr(${col}, 1, 7) <> 'sqlite_' AND substr(${col}, 1, 4) <> '_cf_' AND ${col} <> '_restore_big'`;
const PAGE_BYTES = 3_000_000; // about what one request brings back
const PER_BATCH = 40;
const WINDOW = 4; // requests in flight at once

/** A sum of many terms as a balanced tree, so SQLite's expression depth limit (100) is never reached */
function sumOf(terms) {
  if (!terms.length) return '0';
  if (terms.length === 1) return terms[0];
  const mid = terms.length >> 1;
  return `(${sumOf(terms.slice(0, mid))} + ${sumOf(terms.slice(mid))})`;
}

/**
 * Reads the whole database. `write(bytes)` gets the SQL a statement at a time (leave it out to only read
 * digests). Returns { bookmark, tables: { name: { rows, digest } }, objects, statements } or throws Moved.
 */
export async function readDatabase(db, { write = null, label = 'database', now = new Date() } = {}) {
  const before = await db.bookmark();
  const [list, master, xinfo, fks] = await db.batch([
    { sql: "SELECT name AS a, type AS b, wr AS c FROM pragma_table_list WHERE schema = 'main'" },
    { sql: `SELECT type AS a, name AS b, tbl_name AS c, sql AS d FROM sqlite_master WHERE sql IS NOT NULL AND ${INTERNAL('name')} ORDER BY rowid` },
    { sql: `SELECT m.name AS a, p.name AS b, p.hidden AS c, p.pk AS d FROM sqlite_master m JOIN pragma_table_xinfo(m.name) p WHERE m.type = 'table' AND ${INTERNAL('m.name')} AND m.sql NOT LIKE 'CREATE VIRTUAL%' ORDER BY m.name, p.cid` },
    { sql: `SELECT m.name AS a, f."table" AS b FROM sqlite_master m JOIN pragma_foreign_key_list(m.name) f WHERE m.type = 'table' AND ${INTERNAL('m.name')} AND m.sql NOT LIKE 'CREATE VIRTUAL%'` },
  ]);
  const kinds = new Map(list.map(([name, type, wr]) => [name, { type, wr: Number(wr) === 1 }]));
  const hasSequence = kinds.has('sqlite_sequence');
  const virtual = master.filter(([type, , , sql]) => type === 'table' && /^CREATE\s+VIRTUAL/i.test(sql));
  if (virtual.length) throw new SqlError(`${label} has a search table (${virtual.map((v) => v[1]).join(', ')}): the backup has to be taught to copy those before it can`);
  const tables = master.filter(([type, name]) => type === 'table' && kinds.get(name)?.type !== 'shadow').map(([, name, , sql]) => ({ name, sql, cols: [], pk: [], wr: !!kinds.get(name)?.wr, parents: new Set() }));
  const byName = new Map(tables.map((t) => [t.name, t]));
  for (const [t, col, hidden, pk] of xinfo) {
    const table = byName.get(t);
    if (!table || Number(hidden) !== 0) continue; // generated columns are worked out again on their own
    table.cols.push(col);
    if (Number(pk) > 0) table.pk[Number(pk) - 1] = col;
  }
  // A table with rowids keeps them: its rows go back under the very rowids they had (a gap left by a deleted
  // row would otherwise close up, and the site uses some rowids, a receipt's code for one). SQLite reaches the
  // rowid as rowid, oid or _rowid_, whichever isn't also a column's name; giving it beside an INTEGER PRIMARY KEY
  // (which is the rowid) is allowed. The rowid is part of each row's fingerprint, so the drill would see a shift.
  const rowidsNotKept = [];
  for (const t of tables) {
    if (t.wr) continue;
    const taken = new Set(t.cols.map((c) => c.toLowerCase()));
    t.rowid = ['rowid', 'oid', '_rowid_'].find((n) => !taken.has(n)) || null;
    if (!t.rowid) rowidsNotKept.push(t.name);
  }
  for (const [t, parent] of fks) if (byName.has(parent) && parent !== t) byName.get(t).parents.add(parent);
  const ordered = parentsFirst(tables);

  // How big each table is, to group the small ones and page the big ones
  const stats = [];
  for (let i = 0; i < ordered.length; i += PER_BATCH) {
    const group = ordered.slice(i, i + PER_BATCH);
    const got = await db.batch(group.map((t) => ({ sql: `SELECT COUNT(*) AS a, CAST(COALESCE(SUM(${sumOf(t.cols.map((c) => `COALESCE(length(CAST(${qi(c)} AS BLOB)), 0)`))}), 0) AS TEXT) AS b FROM ${qi(t.name)}` })));
    got.forEach((rows, j) => stats.push({ t: group[j], rows: Number(rows[0][0]), bytes: Number(rows[0][1]) }));
  }

  // The reads, in table order: whole small tables many to a request, big ones a page at a time. A row is read as
  // its forms, the rowid's first when the table keeps rowids.
  const select = (t) => [...(t.rowid ? [`${formOf(t.rowid)} AS r0`] : []), ...t.cols.map((c, i) => `${formOf(qi(c))} AS c${i}`)].join(', ');
  const order = (t) => (t.wr ? (t.pk.filter(Boolean).length ? t.pk.filter(Boolean).map(qi).join(', ') : t.cols.map(qi).join(', ')) : t.rowid || 'rowid');
  const est = (s) => s.bytes * 2 + s.rows * (s.t.cols.length * 3 + 30); // hex doubles the bytes
  const jobs = [];
  let group = [];
  let groupBytes = 0;
  const flushGroup = () => { if (group.length) jobs.push({ kind: 'whole', stats: group }); group = []; groupBytes = 0; };
  for (const s of stats) {
    if (est(s) > PAGE_BYTES) { flushGroup(); jobs.push({ kind: 'paged', stats: [s] }); continue; }
    if (group.length >= PER_BATCH || groupBytes + est(s) > PAGE_BYTES) flushGroup();
    group.push(s);
    groupBytes += est(s);
  }
  flushGroup();

  const run = (job) => {
    if (job.kind === 'whole') {
      const p = db.batch(job.stats.map((s) => ({ sql: `SELECT ${select(s.t)} FROM ${qi(s.t.name)} ORDER BY ${order(s.t)}` })));
      p.catch(() => {}); // read in order below
      return { job, pages: (async function* () { const got = await p; for (let i = 0; i < got.length; i++) yield { t: job.stats[i].t, rows: got[i], last: true }; })() };
    }
    const s = job.stats[0];
    const per = Math.max(1, Math.floor(s.rows * PAGE_BYTES / Math.max(1, est(s))));
    // Each page is asked for as soon as the one before it is in, so a big table streams instead of waiting
    const page = (after) => {
      const p = s.t.wr
        ? db.batch([{ sql: `SELECT ${select(s.t)} FROM ${qi(s.t.name)} ORDER BY ${order(s.t)} LIMIT ${per} OFFSET ${after}` }])
        : db.batch([{ sql: `SELECT ${select(s.t)} FROM ${qi(s.t.name)} WHERE ${after == null ? '1' : `${s.t.rowid} > CAST(? AS INTEGER)`} ORDER BY ${s.t.rowid} LIMIT ${per}`, params: after == null ? [] : [after] }]);
      p.catch(() => {});
      return p;
    };
    if (!s.t.wr && !s.t.rowid) throw new SqlError(`${label}: ${s.t.name} is too big for one read and has no way to reach its rowid`);
    let next = page(s.t.wr ? 0 : null);
    return {
      job,
      pages: (async function* () {
        for (let off = 0; ; off += per) {
          const [rows] = await next;
          const more = rows.length === per;
          if (more) next = page(s.t.wr ? off + per : rows[rows.length - 1][0].slice(1));
          yield { t: s.t, rows, last: !more };
          if (!more) return;
        }
      })(),
    };
  };

  const enc = new TextEncoder();
  let statements = 0;
  const out = write ? async (b) => { statements++; await write(typeof b === 'string' ? enc.encode(b) : b); } : null;
  if (out) {
    await out(`-- ${label}, read exactly at D1 bookmark ${before} (${now.toISOString()}).\n-- Restore into a new, EMPTY D1 database:  npx wrangler d1 execute <its name> --remote --file <this file>\n`);
    await out('PRAGMA defer_foreign_keys = true;\n');
    for (const t of ordered) await out(`${t.sql};\n`);
  }
  const tablesOut = {};
  // A few requests ahead of the one being written, never more
  const queue = jobs.map((job) => ({ job, started: null }));
  const start = (k) => { if (k < queue.length && !queue[k].started) queue[k].started = run(queue[k].job); };
  for (let k = 0; k < Math.min(WINDOW, queue.length); k++) start(k);
  for (let k = 0; k < queue.length; k++) {
    start(k);
    const { pages } = queue[k].started;
    let current = null;
    for await (const page of pages) {
      if (!current || current.t !== page.t) current = { t: page.t, writer: out ? tableWriter(page.t.name, page.t.cols, out, { rowid: page.t.rowid }) : null, digest: digester() };
      for (const row of page.rows) {
        await current.digest.add(row);
        if (current.writer) await current.writer.add(row);
      }
      if (page.last) {
        if (current.writer) await current.writer.end();
        tablesOut[page.t.name] = { rows: Number(current.digest.value.split(':')[0]), digest: current.digest.value };
        current = null;
      }
    }
    queue[k].started = { pages: null };
    start(k + WINDOW);
  }
  // Every table read, and with the rows it said it had (if not, and nothing was written, the reader is wrong)
  const short = stats.filter((s) => tablesOut[s.t.name]?.rows !== s.rows);
  if (short.length) {
    const after = await db.bookmark();
    if (after !== before) throw new Moved(before, after);
    const s = short[0];
    throw new SqlError(`${label}: ${s.t.name} had ${s.rows} rows when counted and ${tablesOut[s.t.name]?.rows ?? 'none'} when read`);
  }
  // AUTOINCREMENT's counters. An empty sqlite_sequence says nothing (SQLite makes one with the first such table,
  // and an emptied one can't be dropped), so only one with rows is part of the copy and its fingerprints.
  let sequence = [];
  if (hasSequence) {
    [sequence] = await db.batch([{ sql: `SELECT ${formOf('name')} AS c0, ${formOf('seq')} AS c1 FROM sqlite_sequence ORDER BY name` }]);
    if (sequence.length) {
      const d = digester();
      for (const r of sequence) await d.add(r);
      tablesOut.sqlite_sequence = { rows: sequence.length, digest: d.value };
    }
  }
  const later = master.filter(([type]) => type === 'index' || type === 'trigger' || type === 'view');
  if (out) {
    if (sequence.length) {
      await out('DELETE FROM sqlite_sequence;\n');
      const w = tableWriter('sqlite_sequence', ['name', 'seq'], out);
      for (const r of sequence) await w.add(r);
      await w.end();
    }
    // Indexes, then views (in the order they were made, as one view can use another), then triggers last: an
    // INSTEAD OF trigger needs its view, and no trigger fires while the rows go in
    for (const kind of ['index', 'view', 'trigger']) for (const [type, , , sql] of later) if (type === kind) await out(`${sql};\n`);
  }
  const after = await db.bookmark();
  if (after !== before) throw new Moved(before, after);
  const objects = { tables: ordered.length, indexes: later.filter((o) => o[0] === 'index').length, triggers: later.filter((o) => o[0] === 'trigger').length, views: later.filter((o) => o[0] === 'view').length };
  return { bookmark: before, tables: tablesOut, objects, statements, ...(rowidsNotKept.length ? { rowidsNotKept } : {}) };
}

// Tables ordered so a table comes after every table its foreign keys point to (a loop keeps the original order)
function parentsFirst(tables) {
  const done = new Set();
  const out = [];
  const visit = (t, path) => {
    if (done.has(t.name) || path.has(t.name)) return;
    path.add(t.name);
    for (const p of t.parents) { const parent = tables.find((x) => x.name === p); if (parent) visit(parent, path); }
    path.delete(t.name);
    if (!done.has(t.name)) { done.add(t.name); out.push(t); }
  };
  for (const t of tables) visit(t, new Set());
  return out;
}
