/**
 * _member-write.js: a write about a member lands at the address they have at the moment it's written
 * ====================================================================================================
 * Advisory Board QA round 21 (Nov 22 2026): an "I can help" press, the monthly ask going out and the member page's own
 * writes each read the member's web address first and wrote under it after; a People rename in between moved
 * everything, took its note away, and the write landed at the old address, nobody's (or, during a swap of two
 * people's addresses, on the other person), never moved and holding the address for good.
 *
 * How it holds, whatever order things happen in. A rename (./rename-content.js) moves the person's record, their
 * private email and its note (`rename-finish:<old>`, ./_rename-finish.js) in one batch, then moves each kind of record
 * off the old address (each kind in one batch of its own: ./_member-places.js), and takes the note away only once every
 * kind has gone. A write about a member is one statement whose WHERE asks, as it runs, two things: is the People record
 * at this address exactly the one just read for this person (their record holds its own address, so a rename since
 * changes it), and is no rename still moving records off this address (its note). So it lands either before the
 * rename's batch, at the old address, where every move after that batch carries it, or after it, at the new address;
 * never at the old address once its kind has moved. A write that finds things changed reads again and tries again (a
 * rename since: at the new address); one that finds a rename still moving records off their address is refused in
 * words, with nothing written (503), as is one that finds nobody it could be for.
 *
 * Who a write is for is read by what really identifies them: the email they sign in with (it moves with them in the
 * rename's own batch), else their address; a press of the monthly ask's button by its link (./_advisory-mail.js).
 */
import { normalizePerson } from '../../public/admin/team-shared.js';
import { stateReady, readDown, PEOPLE_DOWN } from './_board-roles.js';

const noTable = (e) => { if (/no such table/i.test(e?.message || '')) return null; throw e; };

/** SQL, true while a rename is still moving records off the address in `col` (stuck, or partway) */
export const movingOff = (col) => `EXISTS (SELECT 1 FROM board_state WHERE key = 'rename-finish:' || ${col})`;
/**
 * SQL, true while a rename is moving records off the address in `col`, or onto it: their records are partway between
 * the two, so what's read at either is only part of them
 */
export const movingAt = (col) => `(${movingOff(col)} OR EXISTS (SELECT 1 FROM board_state WHERE key >= 'rename-finish:' AND key < 'rename-finish;' AND json_valid(data) AND json_extract(data, '$.to') = ${col}))`;
/**
 * SQL for a write's WHERE about the People record `alias`: the one at this address, exactly as read (binds: slug,
 * data), with no rename moving records off it, or onto it (`into`, the default: a member's own writes wait for their
 * records to finish moving; the monthly ask's new link doesn't need to). A write selects the address from it
 */
export const stillTheirs = (alias = 't', { into = true } = {}) => `${alias}.slug = ? AND ${alias}.data = ? AND NOT ${into ? movingAt(`${alias}.slug`) : movingOff(`${alias}.slug`)}`;

export const onAdvisoryBoard = (p) => p?.group === 'advisory' && p?.status === 'active';
/**
 * A row a member's own visit writes (a sign-in, a look at the board page, a report's time, their visit), as an INSERT …
 * SELECT's FROM and WHERE (ownRow), its two binds (their address and sign-in email) first: written only while their
 * sign-in email is at that address on People (else, with no email, while someone is) and no rename is moving records off
 * it or onto it. These rows move with a rename like the rest of their records (./_board-rename.js); one written at the
 * old address after its kind had moved would be nobody's, holding the address for good, and during a swap of two
 * people's addresses it would be the other person's. So a row asked for in that moment isn't written: a line of what
 * they looked at missed, never a record left behind (Board QA round 9, Nov 22 2026, from round 21's Advisory Board fixer)
 */
const BY_EMAIL = `FROM (SELECT ? AS s, ? AS em) AS me WHERE (CASE WHEN me.em = '' THEN EXISTS (SELECT 1 FROM team t WHERE t.slug = me.s) ELSE EXISTS (SELECT 1 FROM reveal_board_emails e WHERE e.slug = me.s AND lower(trim(e.email)) = me.em) END) AND NOT ${movingAt('me.s')}`;
const BY_RECORD = `FROM (SELECT ? AS s, ? AS em) AS me WHERE EXISTS (SELECT 1 FROM team t WHERE t.slug = me.s) AND NOT ${movingAt('me.s')}`;
const emailsKept = new WeakMap();
/**
 * → [fromWhere, binds] for a write of a member's own row (above): by their sign-in email where the site keeps them, by
 * their People record in a database that has no table of emails yet. Asked once a database: a read of it that fails
 * throws, as a read of People does (readDown), and is asked again next time, never kept as "no table of emails" (which
 * would write every row after it by the record alone, the guard a swap of two addresses gets past: Advisory Board QA
 * round 24)
 */
export async function ownRow(DB, who) {
  if (!emailsKept.has(DB)) {
    const row = await DB.prepare("SELECT 1 AS y FROM sqlite_master WHERE type = 'table' AND name = 'reveal_board_emails'").first().catch((e) => { throw readDown(PEOPLE_DOWN, e); });
    emailsKept.set(DB, !!row);
  }
  const binds = [String((who && typeof who === 'object' ? who.slug : who) || ''), String((who && typeof who === 'object' && who.email) || '').trim().toLowerCase()];
  return [emailsKept.get(DB) ? BY_EMAIL : BY_RECORD, binds];
}
/** A People record's data as the site reads it (normalizePerson), or null */
export const personOf = (data, slug = '') => {
  try { const p = normalizePerson(JSON.parse(data || '{}')); return slug ? { ...p, slug } : p; } catch { return null; }
};

/** Their words when a rename is moving records off their address right now */
export const MOVING = 'We couldn’t save that just now. Please try again in a few minutes.';
export const MOVING_STAFF = 'This wasn’t saved: this person’s web address on People is changing right now. Try again in a few minutes.';
export const GONE = 'This is for SOARD’s current Advisory Board members, so it wasn’t saved.';
export const GONE_STAFF = 'This person isn’t on the Advisory Board at this address now (renamed or removed on People), so nothing was saved. Reload and try again.';

const err = (message, status, extra = {}) => Object.assign(new Error(message), { status, ...extra });

/**
 * Who a write is about, as things are this moment, in one read: by the email they sign in with when there is one,
 * else by their address (an address alone looks up its email first, so it still finds them once renamed). `fits`:
 * who it may be (an active Advisory Board member). Two records at one email: the one at the address given, else
 * nobody, never a guess. `moving`: a rename is moving their records off this address, or onto it (`into`) → { slug, data,
 * person, moving } or null
 */
export async function memberNow(DB, who, { fits = onAdvisoryBoard, into = true } = {}) {
  await stateReady(DB);
  const slug = typeof who === 'string' ? who : String(who?.slug || '');
  let email = who && typeof who === 'object' ? String(who.email || '').trim().toLowerCase() : '';
  if (!email && slug) email = (await DB.prepare('SELECT lower(trim(email)) AS e FROM reveal_board_emails WHERE slug = ?').bind(slug).first().catch((e) => { if (/no such table/i.test(e?.message || '')) return null; throw readDown(PEOPLE_DOWN, e); }))?.e || '';
  const cols = `t.slug AS slug, t.data AS data, ${into ? movingAt('t.slug') : movingOff('t.slug')} AS moving`;
  // (a read of People that fails is never "nobody" here either: it's said as People not read, 503, the way every read of
  // People says it since Board QA round 10 (./_board-roles.js), never a member refused or a raw error)
  const unread = (e) => { if (/no such table/i.test(e?.message || '')) return { results: [] }; throw readDown(PEOPLE_DOWN, e); };
  const rows = email
    ? (await DB.prepare(`SELECT ${cols} FROM reveal_board_emails e JOIN team t ON t.slug = e.slug WHERE lower(trim(e.email)) = ?`).bind(email).all().catch(unread)).results || []
    : slug ? (await DB.prepare(`SELECT ${cols} FROM team t WHERE t.slug = ?`).bind(slug).all().catch(unread)).results || [] : [];
  const ok = rows.map((r) => ({ slug: r.slug, data: r.data, person: personOf(r.data, r.slug), moving: !!r.moving })).filter((r) => r.person && fits(r.person));
  return ok.find((r) => r.slug === slug) || (ok.length === 1 ? ok[0] : null);
}

const changesOf = (r) => Number((Array.isArray(r) ? r.at(-1) : r)?.meta?.changes) || 0;

/**
 * One write about a member, at their address now. `write(me)` runs it and returns its D1 result (or a batch's, the
 * last statement being the guarded one): a statement that guards itself with stillTheirs, bound to me.slug and
 * me.data. None changed: things moved between the read and the write, so it's read again, up to five times.
 * → { me, result }. Nobody it could be for: 403 (`gone`); a rename moving records off their address: 503 (`moving`)
 */
export async function writeAsMember(DB, who, write, { fits = onAdvisoryBoard, gone = GONE, moving = MOVING } = {}) {
  for (let i = 0; i < 5; i++) {
    const me = await memberNow(DB, who, { fits });
    if (!me) throw err(gone, 403, { gone: true });
    if (me.moving) throw err(moving, 503, { moving: true });
    const result = await write(me);
    if (changesOf(result) > 0) return { me, result };
  }
  throw err(moving, 503, { moving: true });
}
