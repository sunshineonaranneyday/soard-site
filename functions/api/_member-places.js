/**
 * _member-places.js: everywhere a person's web address is kept, as one list, and how each place is counted and moved
 * ===================================================================================================================
 * Advisory Board QA round 20 and Board QA round 8 (Nov 21 2026): the rule for whether an address is free
 * (./_people-address.js addressTaken), what People's note and the Needs attention post say is still at an old address
 * (./_rename-finish.js leftAt) and what a rename or a Move moves (./_board-rename.js moveBoardSlug, ./_advisory.js
 * moveSlug) each kept a list of their own, and each missed something another had: the monthly ask's email links and the
 * Advisory Board meetings were moved (a failure skipped) but never counted or held; most of Board's tables were moved
 * and counted but never held, so an address with a line note still on it was given to someone new. Now Board's places
 * (./_board-rename.js BOARD_PLACES, built from what it moves) and the Advisory Board's (./_advisory.js ADVISORY_PLACES)
 * are the only lists: all three read them, and each module's move goes through its own, so a place added to one is
 * counted, held and moved at once.
 *
 * A place: { kind, owner: 'board' | 'advisory', tally(DB, slug) → [{ kind, n, words }], move?(DB, from, to, { by }) →
 * [{ kind, words, moved, folded }] }. words: [one, many] in plain words for staff, or null for Board's "other" records.
 * A read that fails throws; a table not made yet keeps nothing.
 *
 * Clashes (the same person with records at both addresses: a stuck rename's Move, a rename back, a swap; Peter's rule
 * for round 20): the record already at the new address was made later, so it wins (where a row says when it was made,
 * the newer by that); the older is folded in, written to the audit log as data in the same write that removes it, so
 * nothing is left behind at the old address or lost silently. A term keeps the earlier started_on (when they first
 * joined), everything else from the newer row.
 */
import { auditStatement } from './_audit.js';
import { stateReady } from './_board-roles.js';

const notYet = (e) => { if (/no such table/i.test(e?.message || '')) return null; throw e; };
export const noTable = notYet;
export const counted = (n, [one, many]) => `${n} ${n === 1 ? one : many}`;

/**
 * Rows keyed by a person's address in one column. same: the other columns of the table's unique key with it (null when
 * the address is in no unique key, so two never clash); newer: the column saying when a row was made or last changed
 * (none: the one at the new address is the newer); earliest: a column whose earlier value is kept (a term's started_on).
 * prefix: the column holds the address after it (a correction to the roll targets `r:<address>`), so `kind` names the
 * place apart from the table's other column
 */
export function rowsPlace({ owner, table, col = 'slug', same = null, newer = null, earliest = null, words = null, prefix = '', kind = table }) {
  return {
    kind, owner, words,
    async tally(DB, slug) {
      const r = await DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`).bind(`${prefix}${slug}`).first().catch(notYet);
      return [{ kind, n: Number(r?.n) || 0, words }];
    },
    move: async (DB, from, to, ctx) => (await moveRows(DB, { table, col, same, newer, earliest, words }, `${prefix}${from}`, `${prefix}${to}`, ctx)).map((e) => ({ ...e, kind })),
  };
}

/**
 * Whether an address kept on a record (the Advisory Board's lead in its settings, a to-do's owner, who presents an item,
 * whose signed copy a file is) is the signed-in member's own, at the moment of their own rename too: the same person when
 * both, followed through People's renames (one still finishing included: its note), come to the same address now
 * (./_board.js addressesNow). Board QA round 9: a member was refused their own Advisory Board page and their own to-do
 * while a rename was moving their records, the sign-in already at the new address and the record still at the old one,
 * or the other way round. A read that fails throws (a 503 in words), never "not yours". Shared by Board and the Advisory
 * Board, so neither checks it its own way
 */
export async function sameMember(DB, stored, mine) {
  const a = String(stored || '');
  const b = String(mine || '');
  if (!a || !b) return false;
  if (a === b) return true;
  const { addressesNow } = await import('./_board.js');
  const now = await addressesNow(DB, [a, b]);
  return (now[a] || a) === (now[b] || b);
}

const RENAMED_BY = 'A change of web address on People';
const one = (words, table) => (words ? words[0] : `record in ${table}`);

// (a statement that stops its batch unless these rows are still exactly as read: board_state's data can't be NULL)
const CHANGED = 'a record changed while it was moving';
const asRead = (DB, table, rows) => {
  const one = (r) => `EXISTS (SELECT 1 FROM ${table} WHERE rowid = ?${Object.keys(r.row).map((c) => ` AND "${c}" IS ?`).join('')})`;
  return DB.prepare(`INSERT INTO board_state (key, data) SELECT ?, NULL WHERE NOT (${rows.map(one).join(' AND ')})`)
    .bind(CHANGED, ...rows.flatMap((r) => [r.id, ...Object.values(r.row)]));
};

/**
 * One table's rows moved from → to, clashes folded in (the newer kept, the older in the audit log), all in one batch:
 * a write at either address lands before it (and is moved or folded with the rest) or after it, never between a fold
 * and the move (Advisory Board QA round 21). A row changed after it was read, or a clash made since, stops the batch,
 * and it's read again and made again over the rows as they are. → [{ kind, words, moved, folded }]
 */
async function moveRows(DB, p, from, to, { by = '' } = {}) {
  const { table, col, same } = p;
  // (never OR IGNORE: one that clashes since is a failure, said, and the move is finished later, never left behind)
  const rest = () => DB.prepare(`UPDATE ${table} SET ${col} = ? WHERE ${col} = ?`).bind(to, from);
  if (!same) {
    const r = await rest().run().catch(notYet);
    return [{ kind: table, words: p.words, moved: Number(r?.meta?.changes) || 0, folded: 0 }];
  }
  const on = same.map((c) => ` AND n.${c} = o.${c}`).join('');
  for (let attempt = 0; ; attempt++) {
    let pairs;
    try {
      pairs = (await DB.prepare(`SELECT o.rowid AS a, n.rowid AS b FROM ${table} o JOIN ${table} n ON n.${col} = ?${on} WHERE o.${col} = ?`).bind(to, from).all()).results || [];
    } catch (e) { notYet(e); return [{ kind: table, words: p.words, moved: 0, folded: 0 }]; }
    if (pairs.length) await stateReady(DB);
    const stmts = [];
    const drops = [];
    for (const { a, b } of pairs) {
      const [old, cur] = await Promise.all([a, b].map((id) => DB.prepare(`SELECT * FROM ${table} WHERE rowid = ?`).bind(id).first()));
      // (moved or gone meanwhile: the batch below takes what's there, or stops at a clash and reads again)
      if (!old || !cur) continue;
      const oldNewer = !!p.newer && String(old[p.newer] ?? '') > String(cur[p.newer] ?? '');
      const [keep, drop] = oldNewer ? [a, b] : [b, a];
      const gone = oldNewer ? cur : old;
      stmts.push(asRead(DB, table, [{ id: a, row: old }, { id: b, row: cur }]), auditStatement(DB, {
        userEmail: by || 'the site', action: 'updated', entityType: 'team', entitySlug: to,
        entityName: `The older of two: ${one(p.words, table)}, folded in when “${from}” moved to “${to}”`,
        changes: [{ field: table, from: JSON.stringify(gone), to: `the newer one kept at “${to}”` }],
      }));
      drops.push(stmts.length);
      stmts.push(DB.prepare(`DELETE FROM ${table} WHERE rowid = ?`).bind(drop));
      if (oldNewer) stmts.push(DB.prepare(`UPDATE ${table} SET ${col} = ? WHERE rowid = ?`).bind(to, keep));
      if (p.earliest) {
        const first = [old[p.earliest], cur[p.earliest]].filter(Boolean).sort()[0] || null;
        stmts.push(DB.prepare(`UPDATE ${table} SET ${p.earliest} = ? WHERE rowid = ?`).bind(first, keep));
      }
    }
    stmts.push(rest());
    try {
      const res = await DB.batch(stmts);
      return [{ kind: table, words: p.words, moved: Number(res.at(-1)?.meta?.changes) || 0, folded: drops.filter((i) => Number(res[i]?.meta?.changes) > 0).length }];
    } catch (e) {
      // (changed since it was read: read again, a few times, then said as the failure it is, the note kept for later)
      if (attempt >= 4 || !/UNIQUE constraint failed|NOT NULL constraint failed: board_state/i.test(String(e?.message || e))) throw e;
    }
  }
}

// ─── A record read as data (a meeting): the keys and list entries that are the address ───────────────

/** Whether a record read as data names `slug`: a key, or a value (in a list or a field) */
export function namesIn(v, slug) {
  if (v === slug) return true;
  if (Array.isArray(v)) return v.some((x) => namesIn(x, slug));
  if (v && typeof v === 'object') return Object.entries(v).some(([k, x]) => k === slug || namesIn(x, slug));
  return false;
}
/** An answer that isn't one: invited and nothing said yet */
const noAnswer = (v) => v == null || v === '' || v === 'invited';
/**
 * `from` moved to `to` in a record read as data (Peter's rule, round 20: never by replacing text in the stored JSON):
 * every key and every list entry or value that is the address. Where the same thing is under both (an answer to the
 * invite under each), the newer, `to`'s, is kept, unless it has no answer and the older has; a list never names them
 * twice. → { value, changed, clashes }
 */
export function moveInData(value, from, to) {
  let changed = false;
  let clashes = 0;
  const walk = (v) => {
    if (v === from) { changed = true; return to; }
    if (Array.isArray(v)) {
      const had = v.includes(to);
      const out = v.map(walk);
      return out.includes(to) && (had || out.filter((x) => x === to).length > 1) ? out.filter((x, i) => x !== to || out.indexOf(to) === i) : out;
    }
    if (v && typeof v === 'object') {
      const out = {};
      for (const [k, x] of Object.entries(v)) {
        const key = k === from ? to : k;
        if (k === from) changed = true;
        const val = walk(x);
        if (Object.hasOwn(out, key)) {
          clashes += 1;
          const [newer, older] = k === from ? [out[key], val] : [val, out[key]];
          out[key] = noAnswer(newer) && !noAnswer(older) ? older : newer;
        } else out[key] = val;
      }
      return out;
    }
    return v;
  };
  const next = walk(value);
  return { value: next, changed, clashes };
}

/**
 * A table of records kept as JSON, moved one at a time as data (moveInData), each written only over the record as read,
 * and with when it changed (`stamp`: its own updatedAt, so an editor open on it is told, never undoes the move). An
 * older answer replaced is in the audit log, written with the change. → { moved, folded }
 */
export async function moveJsonRows(DB, { table, words, stamp = true }, from, to, { by = '' } = {}) {
  const quoted = JSON.stringify(from);
  const rows = (await DB.prepare(`SELECT id FROM ${table} WHERE instr(data, ?) > 0`).bind(quoted).all().catch(notYet))?.results || [];
  let moved = 0;
  let folded = 0;
  for (const { id } of rows) {
    for (let i = 0; ; i++) {
      const cur = await DB.prepare(`SELECT data FROM ${table} WHERE id = ?`).bind(id).first();
      if (!cur) break;
      let data;
      try { data = JSON.parse(cur.data); } catch { throw new Error(`${table} ${id} can’t be read, so it wasn’t moved`); }
      const { value, changed, clashes } = moveInData(data, from, to);
      if (!changed) break;
      const at = new Date().toISOString();
      // (a record that keeps when it last changed says so: an editor open on it is told, and never saves the old address back)
      const stamped = stamp && value && typeof value === 'object' && !Array.isArray(value) && 'updatedAt' in value;
      const next = stamped ? { ...value, updatedAt: at, updatedBy: RENAMED_BY } : value;
      const stmts = [];
      if (clashes) {
        stmts.push(auditStatement(DB, {
          userEmail: by || 'the site', action: 'updated', entityType: 'team', entitySlug: to,
          entityName: `The older of two: ${words[0]}, folded in when “${from}” moved to “${to}”`,
          changes: [{ field: `${table} ${id}`, from: cur.data, to: `the newer kept at “${to}”` }],
        }, [`EXISTS (SELECT 1 FROM ${table} WHERE id = ? AND data = ?)`, id, cur.data]));
      }
      stmts.push(stamped
        ? DB.prepare(`UPDATE ${table} SET data = ?, updated_at = ?, updated_by = ? WHERE id = ? AND data = ?`).bind(JSON.stringify(next), at, RENAMED_BY, id, cur.data)
        : DB.prepare(`UPDATE ${table} SET data = ? WHERE id = ? AND data = ?`).bind(JSON.stringify(next), id, cur.data));
      const res = await DB.batch(stmts);
      if (Number(res.at(-1)?.meta?.changes) > 0) { if (clashes) folded += 1; else moved += 1; break; }
      if (i >= 4) throw new Error(`${table} ${id} kept changing, so it wasn’t moved`);
    }
  }
  return { moved, folded };
}
/** How many records of a JSON table name `slug` (one that can't be read, with the address in it, counts) */
export async function tallyJsonRows(DB, table, slug) {
  const rows = (await DB.prepare(`SELECT data FROM ${table} WHERE instr(data, ?) > 0`).bind(JSON.stringify(slug)).all().catch(notYet))?.results || [];
  return rows.filter((r) => { try { return namesIn(JSON.parse(r.data), slug); } catch { return true; } }).length;
}

// ─── The one list ─────────────────────────────────────────────────────────────

/** Every place, Board's then the Advisory Board's */
export async function memberPlaces() {
  const [{ BOARD_PLACES }, { ADVISORY_PLACES }] = await Promise.all([import('./_board-rename.js'), import('./_advisory.js')]);
  return [...BOARD_PLACES, ...ADVISORY_PLACES];
}
/** Each kind's place in the list (a report of what moved is said in the order People's note lists what's left) */
export async function kindOrder() {
  return (await memberPlaces()).flatMap((p) => p.kinds || [p.kind]);
}
/** What's kept under `slug`, place by place → [{ kind, owner, n, words }] with n > 0. A read that fails throws */
export async function keptAt(DB, slug, { owners = null } = {}) {
  const out = [];
  for (const p of await memberPlaces()) {
    if (owners && !owners.includes(p.owner)) continue;
    for (const t of await p.tally(DB, slug)) if (t.n > 0) out.push({ ...t, owner: p.owner });
  }
  return out;
}
/** The first owner with anything kept under `slug` ('board' | 'advisory'), or null. A read that fails throws */
export async function keptBy(DB, slug, { owners = ['board', 'advisory'] } = {}) {
  for (const p of await memberPlaces()) {
    if (!owners.includes(p.owner)) continue;
    for (const t of await p.tally(DB, slug)) if (t.n > 0) return p.owner;
  }
  return null;
}
