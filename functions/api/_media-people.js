/**
 * Who signs in for Photos & Videos only
 * ===========================================================================
 * Peter, Nov 26 2026: "the login for this should only ahve access to this in
 * the admin too for specific users like our social media person".
 *
 * Staff add a person on Admin → Photos & Videos → Who can sign in: their email
 * (any address: a soardcharity.com one or their own) and name. They sign in
 * the way staff do (an emailed code), at /admin/media/, and reach Photos &
 * Videos and nothing else: every other admin page and API turns them away
 * (the middleware, MEDIA_ROUTES). A soardcharity.com address on the list is
 * held to the same: the list is how staff say "this person gets only this".
 *
 * Cloudflare Access has to know an outside address before its sign-in works:
 * the site's Access group (./_board-access.js, everyoneSignIns) holds them
 * with the board and the Advisory Board, synced the moment someone is added
 * or removed, and on every heartbeat after.
 *
 * What they see is narrower than staff's (./_media-search.js VISIBLE_SQL):
 * public albums only, and the archive's and JobTread's Before photos only
 * once the address check has passed them.
 */

import { isEmail } from './_broadcast-notify.js';

export const MEDIA_PAGE = '/admin/media/';
export const MEDIA_ROUTES = Object.freeze(['/api/media-admin', '/api/media-download', '/api/media-thumb']);
const SCHEMA = 'CREATE TABLE IF NOT EXISTS media_people (email TEXT PRIMARY KEY, name TEXT, added_by TEXT, added_at TEXT NOT NULL, last_seen TEXT)';
const _ready = new WeakSet();
async function ensure(DB) {
  if (_ready.has(DB)) return;
  await DB.prepare(SCHEMA).run();
  _ready.add(DB);
}
const normEmail = (e) => String(e || '').trim().toLowerCase();

export async function listPeople(DB) {
  await ensure(DB);
  return ((await DB.prepare('SELECT email, name, added_by, added_at, last_seen FROM media_people ORDER BY name, email').all()).results || [])
    .map((r) => ({ email: r.email, name: r.name || '', addedBy: r.added_by || null, addedAt: r.added_at, lastSeen: r.last_seen || null }));
}

const noTable = (e) => /no such table/i.test(String(e?.message || e));
/**
 * The people's sign-in emails, for the Access group: a read, never a write (no table yet is nobody yet). Any other
 * failure throws: never an empty list that would lock them out
 */
export async function peopleEmails(DB) {
  try {
    return ((await DB.prepare('SELECT email FROM media_people').all()).results || []).map((r) => r.email).filter(isEmail);
  } catch (e) {
    if (noTable(e)) return [];
    throw e;
  }
}

const cache = new Map(); // email → { at, person }
const CACHE_MS = 60 * 1000;
export const forgetPeople = () => cache.clear();

/** Is this sign-in one of them? → their row, or null. Read for a minute per isolate (every admin request asks) */
export async function mediaPersonFor(DB, email) {
  const e = normEmail(email);
  if (!isEmail(e) || !DB) return null;
  const hit = cache.get(e);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.person;
  let person = null;
  try { person = await DB.prepare('SELECT email, name FROM media_people WHERE email = ?').bind(e).first(); } catch (err) { if (!noTable(err)) throw err; }
  cache.set(e, { at: Date.now(), person: person || null });
  return person || null;
}

export async function addPerson(DB, { email, name = '', by = null, now = Date.now() }) {
  const e = normEmail(email);
  if (!isEmail(e)) throw Object.assign(new Error('That isn’t a whole email address'), { status: 400 });
  await ensure(DB);
  await DB.prepare('INSERT INTO media_people (email, name, added_by, added_at) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET name = excluded.name')
    .bind(e, String(name || '').trim().slice(0, 80), by, new Date(now).toISOString()).run();
  forgetPeople();
  return e;
}

export async function removePerson(DB, email) {
  await ensure(DB);
  const r = await DB.prepare('DELETE FROM media_people WHERE email = ?').bind(normEmail(email)).run();
  forgetPeople();
  return !!r?.meta?.changes;
}

/** Their last visit, at most once an hour per person (each page load asks) */
export async function sawPerson(DB, email, now = Date.now()) {
  await ensure(DB);
  const cut = new Date(now - 3600e3).toISOString();
  await DB.prepare('UPDATE media_people SET last_seen = ? WHERE email = ? AND (last_seen IS NULL OR last_seen < ?)').bind(new Date(now).toISOString(), normEmail(email), cut).run();
}
