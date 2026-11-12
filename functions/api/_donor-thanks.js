/**
 * Thank-yous: the gifts SOARD thanks itself (Admin → Donors & Partners → To thank; ./_donor-crm.js shows them)
 * ===========================================================================
 * Zeffy emails a receipt and a thank-you to everyone who gives online. Nobody else hears from it, so these are "To
 * thank" for a person on the team:
 *   - every gift Zeffy didn't take online: a check, a donor-advised fund, a gift in kind, anything entered by hand;
 *   - every gift of $1,000 or more, however it came (the Slack "Major gift" line), as one gift however Zeffy split
 *     the charge (./_board-gifts.js joinCharges); a monthly gift only its first time.
 * Online gifts under $1,000 need nothing. Tickets and purchases are never asked about. Gifts imported into Zeffy (a
 * gala's, from its auction platform) are asked about like any other: Zeffy sends their givers nothing either.
 *
 * Only gifts that are new to the site count: dated after thank-yous began here, or first seen by the site after it
 * had read all of Zeffy's history (a check typed in late with its own date, a donor-advised fund marked paid weeks
 * on). An import is new only by its date: one of old history read later was thanked long ago. Everything before is
 * taken as thanked already. A monthly gift waits for that whole read, so its first time is known for sure.
 *
 * Once a gift is To thank it stays so until a person says Thanked or Not needed. It closes by itself only when Zeffy
 * shows it refunded in full, or answers twice, hours apart, that it has no such payment: never because a read of
 * Zeffy didn't list it. Each gift is one row of donor_thanks, holding enough of it (the amount, the name, the
 * campaign as the donor list shows it) to show even if the list loses it.
 */
import { ensureDonors, readDonorState, giftsFrom, howOf, noteDonorPayment, READ_COLS } from './_donors.js';
import { kidNames } from './_board-gifts.js';
import { zeffyGet, givenName, MAJOR_GIFT_CENTS } from './_zeffy.js';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
// One gift however Zeffy split it, a gift at the moment thank-yous began included
export const THANK_CENTS = MAJOR_GIFT_CENTS;
// Payment kinds Zeffy didn't take online (it sends these givers nothing)
const OFFLINE = new Set(['cheque', 'check', 'cash', 'daf', 'in_kind', 'manual', 'transfer', 'wire', 'other']);
// Gifts dated this far back are looked at on each run (anything older that's new to the site is found by first_seen)
const RECENT_MS = 45 * DAY;
const NEW_MS = 7 * DAY;
// A gift the donor list no longer has: Zeffy asked about it at most this often, and this many a run
const GONE_ASK_MS = 6 * HOUR;
const GONE_PER_RUN = 3;
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const iso = (ms) => new Date(ms).toISOString();

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS donor_thanks (
    id TEXT PRIMARY KEY, ids TEXT NOT NULL, state TEXT NOT NULL, why TEXT, at INTEGER NOT NULL, cents INTEGER NOT NULL,
    in_kind INTEGER NOT NULL DEFAULT 0, name TEXT, company TEXT, campaign TEXT, how TEXT, contact TEXT,
    created_at TEXT NOT NULL, done_by TEXT, done_at TEXT, gone TEXT, missing_at TEXT, asked_at TEXT)`,
  'CREATE INDEX IF NOT EXISTS donor_thanks_state ON donor_thanks(state)',
];
const ready = new WeakSet();
export async function ensureThanks(DB) {
  if (ready.has(DB)) return;
  await ensureDonors(DB);
  for (const sql of SCHEMA) await DB.prepare(sql).run();
  ready.add(DB);
}
async function readState(DB) {
  const row = await DB.prepare("SELECT value FROM donor_state WHERE key = 'thanks'").first();
  try { return JSON.parse(row?.value || '{}'); } catch { return {}; }
}
const writeState = (DB, s) => DB.prepare("INSERT INTO donor_state (key, value) VALUES ('thanks', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify(s)).run();

// ─── The rule ───────────────────────────────────────────────────────

/** Zeffy took it online (and sent its own thank-you) */
export const online = (r) => r.type !== 'manual' && !OFFLINE.has(String(r.method || '').toLowerCase());

/** How one charge was taken, if Zeffy sent its giver nothing: 'kind' | 'check' | 'daf' | 'hand' | null */
function offlineWhy(r) {
  const m = String(r?.method || '').toLowerCase();
  if (r?.inKind || Number(r?.in_kind) > 0 || m === 'in_kind') return 'kind';
  if (m === 'cheque' || m === 'check') return 'check';
  if (m === 'daf') return 'daf';
  return online(r || {}) ? null : 'hand';
}
/**
 * Why SOARD thanks a gift itself, or null. `gift`: one gift as giftsFrom joins it (its whole amount); `charges`: the
 * donor list's rows of its charges, each looked at as it was taken (a check joined to a card charge, one guest at one
 * gala, is still a check; without them, the gift's own method); `first`: false for a monthly gift's later times.
 * → 'kind' | 'check' | 'daf' | 'hand' | 'major'
 */
export function thankWhy(gift, { first = true, charges = null } = {}) {
  if (!gift || !(Number(gift.cents) > 0)) return null;
  if (gift.every && !first) return null;
  const whys = (charges?.length ? charges : [gift]).map(offlineWhy);
  const why = ['kind', 'check', 'daf', 'hand'].find((w) => whys.includes(w));
  if (why) return why;
  return gift.cents >= THANK_CENTS ? 'major' : null;
}
export const WHY = {
  check: 'A check: Zeffy sends checks no thank-you',
  daf: 'From a donor-advised fund: Zeffy sends no thank-you',
  kind: 'A gift in kind: Zeffy sends no thank-you',
  hand: 'Entered by hand: Zeffy sends no thank-you',
  major: '$1,000 or more',
};

// ─── Keeping the list ───────────────────────────────────────────────

const chargesOf = (row) => String(row.ids || row.id).split(' ').filter(Boolean);

/**
 * Bring donor_thanks up to date with the donor list: new gifts that need a thank-you become To thank, a split gift's
 * later charges join it, and a To thank closes when Zeffy shows every charge of it refunded in full, or answers twice
 * that it has no such payment. One run at a time (the webhook's and the 15-minute read's could otherwise both add one
 * gift): a run that finds another going leaves it to that one, and the next read picks up anything it missed.
 * `ask`: false skips asking Zeffy (the gift webhook, which has no time to spare). Never throws
 */
export async function syncThanks(env, { now = Date.now(), fetchImpl = fetch, ask = true } = {}) {
  const { DB } = env;
  if (!DB) return null;
  let turn = null;
  try {
    await ensureThanks(DB);
    turn = await takeTurn(DB, now);
    if (!turn) return { busy: true };
    return await syncOnce(env, { now, fetchImpl, ask });
  } catch (e) {
    console.error('[donors] thanks', e.message);
    return null;
  } finally {
    if (turn) await DB.prepare("UPDATE donor_state SET value = '0' WHERE key = 'thanks-turn' AND value = ?").bind(turn).run().catch(() => {});
  }
}
// A run that died lets go of its turn after this long
const TURN_MS = 3 * MIN;
async function takeTurn(DB, now) {
  const at = iso(now);
  const r = await DB.prepare("INSERT INTO donor_state (key, value) VALUES ('thanks-turn', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE donor_state.value < ?")
    .bind(at, iso(now - TURN_MS)).run();
  return r.meta?.changes ? at : null;
}

/** Is each of these monthly gifts its giver's first? One question for all that have Zeffy's plan id → Set of first ones */
async function firstTimes(DB, gifts) {
  const first = new Set();
  const bySub = new Map();
  for (const { g, r0 } of gifts) if (r0.sub) bySub.set(r0.sub, [...(bySub.get(r0.sub) || []), { g, r0 }]);
  const subs = [...bySub.keys()];
  for (let i = 0; i < subs.length; i += 80) {
    const part = subs.slice(i, i + 80);
    const r = (await DB.prepare(`SELECT sub, MIN(at) AS at FROM donor_payments WHERE sub IN (${part.map(() => '?').join(', ')}) GROUP BY sub`).bind(...part).all()).results || [];
    const minOf = new Map(r.map((x) => [x.sub, Number(x.at)]));
    for (const sub of part) for (const { g, r0 } of bySub.get(sub)) if (!(minOf.get(sub) < Number(r0.at))) first.add(g);
  }
  // No plan id (rare): the same giver (their contact, else email, else name) giving the same every-so-often to the same
  // campaign before. Known by nothing at all: never taken as a first time, so it can't come back every month
  for (const { g, r0 } of gifts) {
    if (r0.sub) continue;
    const name = clean(`${clean(r0.first)} ${clean(r0.last)}`).toLowerCase();
    const who = r0.contact ? ['contact = ?', r0.contact] : r0.email ? ['email = ?', r0.email] : name ? ["lower(trim(coalesce(first, '') || ' ' || coalesce(last, ''))) = ?", name] : null;
    if (!who) continue;
    const earlier = await DB.prepare(`SELECT 1 FROM donor_payments WHERE ${who[0]} AND every = ? AND campaign IS ? AND at < ? AND id <> ? LIMIT 1`).bind(who[1], r0.every, r0.campaign, r0.at, r0.id).first();
    if (!earlier) first.add(g);
  }
  return first;
}

async function syncOnce(env, { now, fetchImpl, ask }) {
  const { DB } = env;
  const st = await readState(DB);
  let changedState = false;
  if (!st.startedAt) { st.startedAt = iso(now); changedState = true; }
  // The first whole read of Zeffy's history after thank-yous began: from then on, anything new to the site is new
  if (!st.wholeAt) {
    const ds = await readDonorState(DB);
    if (ds.filledAt && ds.filledAt >= st.startedAt) { st.wholeAt = ds.filledAt; changedState = true; }
  }
  if (changedState) await writeState(DB, st);
  const startS = Math.floor(Date.parse(st.startedAt) / 1000);
  const nowS = Math.floor(now / 1000);
  let known = (await DB.prepare('SELECT id, ids, state, cents, asked_at, created_at FROM donor_thanks').all()).results || [];
  // One charge, one thank-you. Two that share a charge (runs that overlapped once) are one: the one already said, else
  // the one with more of the gift, else the first, stays; the other was never said, so it goes
  const extra = new Set();
  const holder = new Map();
  const rank = (t) => [t.state === 'todo' ? 1 : 0, -chargesOf(t).length, t.created_at || '', t.id];
  const before = (a, b) => { const x = rank(a); const y = rank(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i]; return false; };
  for (const t of [...known].sort((a, b) => (before(a, b) ? -1 : before(b, a) ? 1 : 0))) {
    const shared = chargesOf(t).some((c) => holder.has(c));
    if (shared && t.state === 'todo') { extra.add(t.id); continue; }
    for (const c of chargesOf(t)) if (!holder.has(c)) holder.set(c, t);
  }
  if (extra.size) {
    await DB.batch([...extra].map((id) => DB.prepare("DELETE FROM donor_thanks WHERE id = ? AND state = 'todo'").bind(id)));
    known = known.filter((t) => !extra.has(t.id));
  }
  const byCharge = holder;
  const todoIds = known.filter((t) => t.state === 'todo').flatMap(chargesOf);
  // Gifts dated since it began (an hour before, so a gift split across the moment joins whole), gifts first seen
  // lately once the history was whole, and every charge of a gift still To thank
  const parts = ['(at >= ? AND at >= ?)'];
  const vals = [startS - 3600, nowS - Math.floor(RECENT_MS / 1000)];
  // After it, not at it: what the run that finished the read saw, it saw as history
  if (st.wholeAt) { parts.push('first_seen > ?'); vals.push(st.wholeAt > iso(now - NEW_MS) ? st.wholeAt : iso(now - NEW_MS)); }
  let rows = (await DB.prepare(`SELECT ${READ_COLS.join(', ')} FROM donor_payments WHERE ${parts.join(' OR ')}`).bind(...vals).all()).results || [];
  const have = new Set(rows.map((r) => r.id));
  const missingTodo = todoIds.filter((id) => !have.has(id));
  for (let i = 0; i < missingTodo.length; i += 80) {
    const part = missingTodo.slice(i, i + 80);
    rows = rows.concat((await DB.prepare(`SELECT ${READ_COLS.join(', ')} FROM donor_payments WHERE id IN (${part.map(() => '?').join(', ')})`).bind(...part).all()).results || []);
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  const kids = await kidNames(DB);
  // Each gift that gives something, with its charges and the thank-you any of them already has. A charge refunded in
  // full gives nothing: it never starts, changes or closes a thank-you on its own (the rest of its gift carries on)
  const gifts = [];
  for (const g of giftsFrom(rows, kids)) {
    if (!(Number(g.cents) > 0)) continue;
    const charges = g.ids || [g.id];
    const rs = charges.map((id) => byId.get(id)).filter(Boolean);
    if (!rs.length) continue;
    const t = charges.map((c) => byCharge.get(c)).find(Boolean) || null;
    const firstSeen = rs.reduce((m, r) => (r.first_seen < m ? r.first_seen : m), rs[0].first_seen);
    // An import is new by its date only: old history imported now was thanked when it was given
    const isNew = g.at >= startS || (g.type !== 'imported' && !!st.wholeAt && firstSeen > st.wholeAt);
    if (!t && !isNew) continue;
    // A monthly gift: its first time only, known once all the history is read
    if (g.every && !st.wholeAt) continue;
    gifts.push({ g, charges, rs, r0: rs[0], t });
  }
  // Only a gift that has no thank-you yet asks whether it's a first time (its answer never changes after)
  const first = await firstTimes(DB, gifts.filter((x) => x.g.every && !x.t));
  const steps = [];
  let added = 0;
  for (const { g, charges, rs, r0, t } of gifts) {
    const why = thankWhy(g, { first: !g.every || !!t || first.has(g), charges: rs });
    // Named as the donor list names them (./_donor-crm.js): their email when Zeffy has no name
    const name = givenName({ first_name: r0.first, last_name: r0.last }) || clean(r0.company) || clean(r0.email) || 'No name';
    const snap = [charges.join(' '), g.at, g.inKind ? 0 : g.cents, g.inKind ? g.cents : 0, name, r0.company || null, g.campaign || null, howOf(g), r0.contact || null];
    if (!t) {
      if (!why) continue;
      steps.push(DB.prepare(`INSERT OR IGNORE INTO donor_thanks (id, ids, state, why, at, cents, in_kind, name, company, campaign, how, contact, created_at)
        VALUES (?, ?, 'todo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(g.id, snap[0], why, ...snap.slice(1), iso(now)));
      added++;
      continue;
    }
    if (t.state === 'todo') {
      // A To thank keeps up with its gift: a later charge joins it, one refunded in full leaves it. It stays To thank
      // (with the reason it had) until a person says, or every charge of it is refunded (below)
      steps.push(DB.prepare("UPDATE donor_thanks SET ids = ?, why = COALESCE(?, why), at = ?, cents = ?, in_kind = ?, name = ?, company = ?, campaign = ?, how = ?, contact = ?, missing_at = NULL WHERE id = ? AND state = 'todo'")
        .bind(snap[0], why, ...snap.slice(1), t.id));
    } else if (chargesOf(t).join(' ') !== snap[0]) {
      // Said already: a later charge of the gift shows as said too
      steps.push(DB.prepare('UPDATE donor_thanks SET ids = ? WHERE id = ?').bind([...new Set([...chargesOf(t), ...charges])].join(' '), t.id));
    }
  }
  // A To thank whose every charge Zeffy shows refunded in full: nothing was given, so there's no one to thank
  for (const t of known) {
    if (t.state !== 'todo') continue;
    const rs = chargesOf(t).map((c) => byId.get(c));
    if (rs.length && rs.every((r) => r && Number(r.cents) > 0 && !Number(r.net))) {
      steps.push(DB.prepare("UPDATE donor_thanks SET state = 'gone', gone = 'refunded', done_at = ? WHERE id = ? AND state = 'todo'").bind(iso(now), t.id));
    }
  }
  for (let i = 0; i < steps.length; i += 50) await DB.batch(steps.slice(i, i + 50));
  // To thank, but the donor list has none of its charges: ask Zeffy (a few a run, each at most every few hours)
  let closed = 0;
  if (ask && String(env.ZEFFY_API_KEY || '').trim()) {
    const lost = known.filter((t) => t.state === 'todo' && chargesOf(t).every((c) => !byId.has(c)))
      .filter((t) => !t.asked_at || now - Date.parse(t.asked_at) >= GONE_ASK_MS).slice(0, GONE_PER_RUN);
    for (const t of lost) closed += await askZeffy(env, t, { now, fetchImpl });
  }
  return { added, closed };
}

/** A To thank the donor list lost: Zeffy says refunded or gone (twice, hours apart) → closed; there → back in the list */
async function askZeffy(env, t, { now, fetchImpl }) {
  const { DB } = env;
  const id = chargesOf(t)[0];
  const at = iso(now);
  try {
    const p = await zeffyGet(env, `/payments/${encodeURIComponent(id)}`, {}, fetchImpl);
    const status = String(p?.status || '').toLowerCase();
    if (p?.refund_status === 'full' || (status && status !== 'succeeded')) {
      await DB.prepare("UPDATE donor_thanks SET state = 'gone', gone = ?, done_at = ?, asked_at = ? WHERE id = ? AND state = 'todo'").bind(p?.refund_status === 'full' ? 'refunded' : 'failed', at, at, t.id).run();
      return 1;
    }
    // Zeffy has it: back in the list (a read that missed it), and it stays To thank
    await noteDonorPayment(env, p, { now, thanks: false });
    await DB.prepare('UPDATE donor_thanks SET missing_at = NULL, asked_at = ? WHERE id = ?').bind(at, t.id).run();
    return 0;
  } catch (e) {
    if (e.status !== 404) { await DB.prepare('UPDATE donor_thanks SET asked_at = ? WHERE id = ?').bind(at, t.id).run(); return 0; }
    // Gone: only the second answer, hours after the first, closes it
    const row = await DB.prepare('SELECT missing_at FROM donor_thanks WHERE id = ?').bind(t.id).first();
    if (row?.missing_at && now - Date.parse(row.missing_at) >= GONE_ASK_MS) {
      await DB.prepare("UPDATE donor_thanks SET state = 'gone', gone = 'deleted', done_at = ?, asked_at = ? WHERE id = ? AND state = 'todo'").bind(at, at, t.id).run();
      return 1;
    }
    await DB.prepare('UPDATE donor_thanks SET missing_at = COALESCE(missing_at, ?), asked_at = ? WHERE id = ?').bind(at, at, t.id).run();
    return 0;
  }
}

// ─── Reading and saying ─────────────────────────────────────────────

const SHOW = 'id, ids, state, why, at, cents, in_kind, name, company, campaign, how, contact, created_at, done_by, done_at, gone';
/** Every gift still To thank, the one waiting longest first (since it came to the site, not the date on it) */
export async function thanksToDo(DB) {
  await ensureThanks(DB);
  return (await DB.prepare(`SELECT ${SHOW} FROM donor_thanks WHERE state = 'todo' ORDER BY created_at ASC, at ASC`).all()).results || [];
}
/** How many are waiting (the Donors list's count) */
export async function thanksCount(DB) {
  await ensureThanks(DB);
  return Number((await DB.prepare("SELECT COUNT(*) AS n FROM donor_thanks WHERE state = 'todo'").first())?.n) || 0;
}
/** The thank-you of each charge given: Map charge id → { id, state, why, by, at, gone } */
export async function thanksFor(DB, chargeIds) {
  await ensureThanks(DB);
  const out = new Map();
  const want = new Set(chargeIds.map(String));
  if (!want.size) return out;
  // Few rows: read whole (a gift's charges are in one row's ids, which a lookup by id can't find)
  for (const t of (await DB.prepare(`SELECT ${SHOW} FROM donor_thanks`).all()).results || []) {
    for (const c of chargesOf(t)) if (want.has(c)) out.set(c, { id: t.id, state: t.state, why: t.why, by: t.done_by || null, at: t.done_at || null, gone: t.gone || null });
  }
  return out;
}

const SAID = { thanked: 'Thanked', skipped: 'No thank-you needed', todo: 'To thank' };
/**
 * A person says: thanked, not needed, or (Undo) To thank again. `id`: the thank-you's own id, or any charge of its
 * gift. `was`: the state the person saw. Someone else said otherwise since (another tab, a teammate): nothing changes,
 * and they're told who said what (409). → the row as it was
 */
export async function markThanks(DB, { id, state, was = null }, by, { now = Date.now() } = {}) {
  await ensureThanks(DB);
  if (!['thanked', 'skipped', 'todo'].includes(state)) throw Object.assign(new Error('Thanked, not needed, or To thank'), { status: 400 });
  const want = String(id || '');
  const t = (await DB.prepare(`SELECT ${SHOW} FROM donor_thanks WHERE id = ?`).bind(want).first())
    || await DB.prepare(`SELECT ${SHOW} FROM donor_thanks WHERE instr(' ' || ids || ' ', ?) > 0`).bind(` ${want} `).first();
  if (!t) throw Object.assign(new Error('That gift has no thank-you to say. Reload and look again.'), { status: 404 });
  if (t.state === 'gone') throw Object.assign(new Error('That gift was refunded or taken out of Zeffy, so there’s no thank-you to say.'), { status: 409 });
  const changed = (x) => Object.assign(new Error(`${SAID[x.state] || 'Changed'}${x.done_by ? `, said by ${x.done_by.split('@')[0]}` : ''} since you looked. Nothing was changed.`), { status: 409, state: x.state });
  if (was && t.state !== was) throw changed(t);
  if (t.state === state) return t;
  const r = await DB.prepare('UPDATE donor_thanks SET state = ?, done_by = ?, done_at = ? WHERE id = ? AND state = ?')
    .bind(state, state === 'todo' ? null : by || null, state === 'todo' ? null : iso(now), t.id, t.state).run();
  if (!r.meta?.changes) throw changed(await DB.prepare(`SELECT ${SHOW} FROM donor_thanks WHERE id = ?`).bind(t.id).first() || t);
  return t;
}
