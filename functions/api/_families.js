/**
 * Families: every makeover family's contacts, and the link that lets them keep them current
 * ===========================================================================
 * Peter, Nov 25 2026: "I want to create a update contact form/site that allows
 * our makeover families to update their contact information and add other
 * contacts like the spouse and others for future communication ... a
 * prefilled site shows what we have on file for them and they can either
 * confirm or update, add new contact people", and "a consolidated place in
 * admin to keep the makeover family information". Changes go straight into
 * JobTread, and are logged (his answer, the same day).
 *
 * JobTread stays the record. A family is a JobTread customer with a makeover:
 * a kid page linked to one of its jobs (./_kid-status.js linkJobs, the way kid
 * statuses follow JobTread), or an applicant marked Approved. Community
 * projects (organizations) are not families. Their contacts (name, relationship
 * in JobTread's Title, Email, Phone) are the account's contacts, the same ones
 * every family message from SOARD goes to, so a spouse added here hears from
 * SOARD from then on.
 *
 *   families         a mirror of each family for Admin → Families: the account,
 *                    its kid pages, contacts and home address, and an address
 *                    the family gave us (`mailing`) when it isn't the one in
 *                    JobTread. Read again from JobTread every 10 minutes the
 *                    page is open, by "Check JobTread now", and after each change.
 *   family_links     the private links: only a SHA-256 of each token is kept, one
 *                    live link per family (a new one replaces the last), LINK_DAYS
 *                    long, usable again until then (they can come back and fix
 *                    something). When it was emailed, to whom, opened, answered.
 *   family_updates   every confirm and change, the family's or staff's: what each
 *                    contact was and became, who was added, who they asked to
 *                    take off, the address, a note, and anything JobTread refused.
 *   family_removals  someone a family asked us to take off: never deleted from
 *                    JobTread until a person at SOARD says so (Admin → Families).
 *
 * What a family sends is read against JobTread as it is right then (planUpdate),
 * never against what the page showed, so two people in a family answering at
 * once can't undo each other, and sending twice adds nobody twice.
 *
 * The address: shown from JobTread's home location when it has one; a new one
 * from the family is kept here (`mailing`) and shown to staff, and isn't written
 * to JobTread: the location is where the makeover happened, and its job stays
 * there.
 */

import { pave, SOARD_ORG_ID } from './_reveals.js';
import { linkJobs, loadAllKids } from './_kid-status.js';
import { FIELD_CONTACT_EMAIL, FIELD_CONTACT_PHONE, greetingNames } from './_applicant-comms.js';
import { toE164 } from './_application-form.js';
import { COMMUNITY_PROJECT_TYPE } from './_application-constants.js';
import { sendEmails, emailConfigured, SITE_ORIGIN } from './_broadcast-notify.js';
import { emailShell, button, paragraphs, esc, MUTED, SANS } from './_email-shell.js';

export const LINK_DAYS = 60;
export const PAGE_PATH = '/family-update/';
export const LIMITS = { contacts: 20, adds: 8, name: 80, title: 40, email: 200, phone: 40, note: 1000, line: 120, city: 60, state: 30, zip: 12, submissions: 30 };
/** What the page offers for the relationship box (anything else can be typed) */
export const RELATIONSHIPS = ['Mother', 'Father', 'Stepmother', 'Stepfather', 'Grandmother', 'Grandfather', 'Guardian', 'Aunt', 'Uncle', 'Sibling', 'Caregiver', 'Family friend'];
export const SYNC_EVERY_MS = 10 * 60 * 1000;

const FIELD_STATUS = '22P46wDp3NLd';     // customer: Status (Applied, In Review, Approved, Denied)
const FIELD_YEAR = '22P52xmCz3cx';       // customer: *Makeover Year
const FIELD_TYPES = '22P5KVgrLeXK';      // customer: *Makeover Type
const FIELD_LANGUAGE = '22P46u8a49hk';   // customer: Primary Language
const PAGE = 20;
const JOB_PAGES = 10;

const iso = (t = Date.now()) => new Date(t).toISOString();
const parse = (s, d = null) => { try { return s == null ? d : JSON.parse(s) ?? d; } catch { return d; } };
export const isAccountId = (s) => /^[A-Za-z0-9]{6,32}$/.test(String(s || ''));
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || ''));
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const digits10 = (s) => String(s || '').replace(/\D/g, '').slice(-10);
const bad = (message, field = null) => Object.assign(new Error(message), { status: 400, field });

// ─── D1 ─────────────────────────────────────────────────────────────

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS families (
    account_id TEXT PRIMARY KEY, name TEXT NOT NULL, kids TEXT, year TEXT, status TEXT, language TEXT,
    contacts TEXT, primary_contact_id TEXT, location_id TEXT, address TEXT, mailing TEXT,
    synced_at TEXT NOT NULL, gone_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS family_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT, token_hash TEXT NOT NULL UNIQUE, account_id TEXT NOT NULL,
    created_by TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
    sent_to TEXT, sent_at TEXT, sent_by TEXT, opened_at TEXT, answered_at TEXT, submissions INTEGER NOT NULL DEFAULT 0)`,
  'CREATE INDEX IF NOT EXISTS family_links_account ON family_links (account_id, id)',
  `CREATE TABLE IF NOT EXISTS family_updates (
    id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, link_id INTEGER, at TEXT NOT NULL,
    by TEXT NOT NULL, kind TEXT NOT NULL, changes TEXT, address TEXT, note TEXT, problems TEXT)`,
  'CREATE INDEX IF NOT EXISTS family_updates_account ON family_updates (account_id, id)',
  `CREATE TABLE IF NOT EXISTS family_removals (
    id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, contact_id TEXT NOT NULL, name TEXT,
    asked_at TEXT NOT NULL, asked_by TEXT, decided_at TEXT, decided_by TEXT, decision TEXT)`,
  'CREATE INDEX IF NOT EXISTS family_removals_account ON family_removals (account_id, decided_at)',
  'CREATE TABLE IF NOT EXISTS family_state (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)',
];
const _ready = new WeakSet();
export async function ensureFamilySchema(DB) {
  if (_ready.has(DB)) return;
  await DB.batch(SCHEMA.map((sql) => DB.prepare(sql)));
  _ready.add(DB);
}
async function getState(DB, key) {
  const r = await DB.prepare('SELECT value FROM family_state WHERE key = ?').bind(key).first();
  return r?.value ?? null;
}
async function setState(DB, key, value, now = Date.now()) {
  await DB.prepare('INSERT INTO family_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(key, value == null ? null : String(value), iso(now)).run();
}

// ─── Links ──────────────────────────────────────────────────────────

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export const hashToken = async (token) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(token))));
function newToken() {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export const linkUrl = (token) => `${SITE_ORIGIN}${PAGE_PATH}#t=${token}`;

/** A new link for this family (their earlier one stops working) → { id, token, url, expiresAt } */
export async function createFamilyLink(DB, accountId, { by = null, now = Date.now() } = {}) {
  await ensureFamilySchema(DB);
  if (!isAccountId(accountId)) throw bad('Which family?');
  const token = newToken();
  const expiresAt = iso(now + LINK_DAYS * 864e5);
  await DB.batch([
    DB.prepare("UPDATE family_links SET status = 'replaced' WHERE account_id = ? AND status = 'open'").bind(accountId),
    DB.prepare('INSERT INTO family_links (token_hash, account_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind(await hashToken(token), accountId, by, iso(now), expiresAt),
  ]);
  const row = await DB.prepare('SELECT id FROM family_links WHERE token_hash = ?').bind(await hashToken(token)).first();
  return { id: row?.id ?? null, token, url: linkUrl(token), expiresAt };
}

/** The link behind a token → { link, problem: null | 'unknown' | 'expired' | 'closed' } */
export async function findFamilyLink(DB, token, now = Date.now()) {
  await ensureFamilySchema(DB);
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(String(token || ''))) return { link: null, problem: 'unknown' };
  const link = await DB.prepare('SELECT * FROM family_links WHERE token_hash = ?').bind(await hashToken(token)).first();
  if (!link) return { link: null, problem: 'unknown' };
  if (link.status !== 'open') return { link, problem: 'closed' };
  if (Date.parse(link.expires_at) < now) return { link, problem: 'expired' };
  return { link, problem: null };
}

export async function markOpened(DB, linkId, now = Date.now()) {
  await DB.prepare('UPDATE family_links SET opened_at = COALESCE(opened_at, ?) WHERE id = ?').bind(iso(now), linkId).run();
}

// ─── JobTread ───────────────────────────────────────────────────────

// JobTread refuses (413) a query whose worst case (page size × every nested size) is too big: small, explicit sizes
const CONTACT = {
  id: {}, name: {}, title: {},
  customFieldValues: { $: { size: 2, where: [['customField', 'id'], 'in', [FIELD_CONTACT_EMAIL, FIELD_CONTACT_PHONE]] }, nodes: { value: {}, customField: { id: {} } } },
};
const ACCOUNT = {
  id: {}, name: {}, type: {}, archivedAt: {},
  primaryContact: { id: {} },
  contacts: { $: { size: LIMITS.contacts }, nodes: CONTACT },
  primaryLocation: { id: {}, address: {}, street: {}, city: {}, state: {}, postalCode: {} },
  customFieldValues: { $: { size: 6, where: [['customField', 'id'], 'in', [FIELD_STATUS, FIELD_YEAR, FIELD_TYPES, FIELD_LANGUAGE]] }, nodes: { value: {}, customField: { id: {} } } },
};

function values(node) {
  const out = {};
  for (const v of node?.customFieldValues?.nodes || []) {
    const id = v.customField?.id;
    if (!id) continue;
    out[id] = id in out ? [].concat(out[id], v.value) : v.value;
  }
  return out;
}
/** One JobTread contact, as the page and the admin read it */
export function contactOf(c) {
  const v = values(c);
  return { id: c.id, name: c.name || '', title: c.title || '', email: String(v[FIELD_CONTACT_EMAIL] || ''), phone: String(v[FIELD_CONTACT_PHONE] || '') };
}
/**
 * The home on file, or null. Only a location JobTread holds an address for: a past makeover's customer has a location
 * with none (and JobTread's map then guesses a place from the word "null"), which is no address at all
 */
export function homeOf(loc) {
  if (!loc?.id || !clean(loc.address, 300)) return null;
  const line1 = clean(loc.street, LIMITS.line) || clean(String(loc.address).split(',')[0], LIMITS.line);
  return { line1, line2: '', city: clean(loc.city, LIMITS.city), state: clean(loc.state, LIMITS.state), zip: clean(loc.postalCode, LIMITS.zip), text: clean(loc.address, 300) };
}
export const addressText = (a) => (!a ? '' : [a.line1, a.line2, [a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', '));

/** A JobTread customer as the site keeps it: { id, name, archived, primaryContactId, contacts, home, status, year, types, language } */
export function familyOfAccount(a) {
  const v = values(a);
  const types = [].concat(v[FIELD_TYPES] || []).map(String);
  return {
    id: a.id, name: a.name || '(no name)', archived: !!a.archivedAt, primaryContactId: a.primaryContact?.id || null,
    contacts: (a.contacts?.nodes || []).map(contactOf), home: homeOf(a.primaryLocation), locationId: a.primaryLocation?.id || null,
    status: v[FIELD_STATUS] || null, year: v[FIELD_YEAR] ? String(v[FIELD_YEAR]) : null, types, language: v[FIELD_LANGUAGE] || null,
  };
}

/** One family, fresh from JobTread, or null when it isn't one of SOARD's customers */
export async function readFamily(env, accountId, { fetchImpl = fetch } = {}) {
  if (!isAccountId(accountId)) return null;
  const body = await pave(env.JOBTREAD_GRANT_KEY, { account: { $: { id: accountId }, ...ACCOUNT, organization: { id: {} } } }, fetchImpl);
  const a = body?.account;
  if (!a || a.type !== 'customer' || a.organization?.id !== SOARD_ORG_ID) return null;
  return familyOfAccount(a);
}

async function readAccounts(env, ids, fetchImpl) {
  const out = [];
  for (let i = 0; i < ids.length; i += PAGE) {
    const chunk = ids.slice(i, i + PAGE);
    const data = await pave(env.JOBTREAD_GRANT_KEY, {
      organization: { $: { id: SOARD_ORG_ID }, accounts: { $: { size: PAGE, where: ['id', 'in', chunk] }, nodes: ACCOUNT } },
    }, fetchImpl);
    out.push(...(data?.organization?.accounts?.nodes || []).filter((a) => a.type === 'customer'));
  }
  return out;
}

/** Every SOARD job with the customer it's for */
async function readJobs(env, fetchImpl) {
  const jobs = [];
  let page = null;
  for (let i = 0; i < JOB_PAGES; i++) {
    const body = await pave(env.JOBTREAD_GRANT_KEY, {
      organization: { $: { id: SOARD_ORG_ID }, jobs: { $: { size: 100, ...(page ? { page } : {}) }, nextPage: {}, nodes: { id: {}, name: {}, closedOn: {}, location: { account: { id: {}, type: {} } } } } },
    }, fetchImpl);
    const conn = body?.organization?.jobs;
    if (!conn) throw new Error('JobTread sent no jobs');
    jobs.push(...(conn.nodes || []));
    page = conn.nextPage || null;
    if (!page) break;
  }
  return jobs;
}

/**
 * Which customers are makeover families → Map(accountId → [{ slug, name, year }]): each kid page's job's customer, and
 * each applicant marked Approved (not a community project, not a test) with the kid page it has, if any
 */
export function familyAccounts(jobs, kids, approved = []) {
  const out = new Map();
  const add = (id, kid) => {
    if (!isAccountId(id)) return;
    const list = out.get(id) || [];
    if (kid && !list.some((k) => k.slug === kid.slug)) list.push(kid);
    out.set(id, list);
  };
  const links = linkJobs(jobs, kids);
  const bySlug = new Map(kids.map((k) => [k.slug, k]));
  for (const [slug, job] of links) {
    const acct = job?.location?.account;
    if (acct?.type !== 'customer') continue;
    const k = bySlug.get(slug);
    if (k) add(acct.id, { slug: k.slug, name: k.name, year: k.year != null ? String(k.year) : null });
  }
  for (const a of approved) add(a.account_id, null);
  return out;
}

async function approvedApplicants(DB) {
  try {
    const { results } = await DB.prepare("SELECT account_id, types FROM applicants WHERE status = 'Approved' AND archived_at IS NULL").all();
    const tests = new Set(((await DB.prepare('SELECT jt_account_id FROM applications WHERE is_test = 1 AND jt_account_id IS NOT NULL').all().catch(() => ({ results: [] }))).results || []).map((r) => r.jt_account_id));
    return (results || []).filter((r) => !tests.has(r.account_id) && !parse(r.types, []).includes(COMMUNITY_PROJECT_TYPE));
  } catch (e) {
    if (/no such table/i.test(e?.message || '')) return [];
    throw e;
  }
}

function rowOf(f, kids, now) {
  const years = [...new Set([...(kids || []).map((k) => k.year).filter(Boolean), f.year].filter(Boolean))].sort();
  return {
    account_id: f.id, name: f.name, kids: JSON.stringify(kids || []), year: years.at(-1) || null, status: f.status, language: f.language,
    contacts: JSON.stringify(f.contacts), primary_contact_id: f.primaryContactId, location_id: f.locationId,
    address: f.home ? JSON.stringify(f.home) : null, synced_at: iso(now),
  };
}
const COLS = ['account_id', 'name', 'kids', 'year', 'status', 'language', 'contacts', 'primary_contact_id', 'location_id', 'address', 'synced_at'];
const upsert = (DB, r) => DB.prepare(`INSERT INTO families (${COLS.join(', ')}, gone_at) VALUES (${COLS.map(() => '?').join(', ')}, NULL)
  ON CONFLICT(account_id) DO UPDATE SET ${COLS.filter((c) => c !== 'account_id').map((c) => `${c} = excluded.${c}`).join(', ')}, gone_at = NULL`)
  .bind(...COLS.map((c) => r[c] ?? null));

/** Read every family again from JobTread → { families, kidsWithoutFamily } */
export async function syncFamilies(env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const { DB } = env;
  await ensureFamilySchema(DB);
  const [jobs, kids, approved] = await Promise.all([readJobs(env, fetchImpl), loadAllKids(DB), approvedApplicants(DB)]);
  const map = familyAccounts(jobs, kids, approved);
  const accounts = await readAccounts(env, [...map.keys()], fetchImpl);
  const seen = new Set();
  const stmts = [];
  for (const a of accounts) {
    if (a.archivedAt) continue;
    seen.add(a.id);
    stmts.push(upsert(DB, rowOf(familyOfAccount(a), map.get(a.id), now)));
  }
  const { results: had } = await DB.prepare('SELECT account_id FROM families WHERE gone_at IS NULL').all();
  for (const r of had || []) if (!seen.has(r.account_id)) stmts.push(DB.prepare('UPDATE families SET gone_at = ? WHERE account_id = ?').bind(iso(now), r.account_id));
  for (let i = 0; i < stmts.length; i += 50) await DB.batch(stmts.slice(i, i + 50));
  const linked = new Set([...map.values()].flat().map((k) => k.slug));
  const kidsWithoutFamily = kids.filter((k) => !linked.has(k.slug)).map((k) => ({ slug: k.slug, name: k.name, year: k.year ?? null }));
  await setState(DB, 'synced_at', iso(now), now);
  await setState(DB, 'kids_without_family', JSON.stringify(kidsWithoutFamily), now);
  return { families: seen.size, kidsWithoutFamily: kidsWithoutFamily.length };
}

/** syncFamilies when the last one is older than SYNC_EVERY_MS (or never ran), else nothing */
export async function maybeSyncFamilies(env, { fetchImpl = fetch, now = Date.now(), force = false } = {}) {
  await ensureFamilySchema(env.DB);
  const last = Date.parse(await getState(env.DB, 'synced_at') || '') || 0;
  if (!force && now - last < SYNC_EVERY_MS) return null;
  return syncFamilies(env, { fetchImpl, now });
}

/** One family's mirror row again from JobTread (after a change), keeping its kid pages */
export async function refreshFamily(env, accountId, { fetchImpl = fetch, now = Date.now(), fresh = null } = {}) {
  const { DB } = env;
  await ensureFamilySchema(DB);
  const f = fresh || await readFamily(env, accountId, { fetchImpl });
  if (!f) return null;
  const had = await DB.prepare('SELECT kids FROM families WHERE account_id = ?').bind(accountId).first();
  await upsert(DB, rowOf(f, parse(had?.kids, []), now)).run();
  return f;
}

// ─── What a family (or staff) sends ─────────────────────────────────

const sameEmail = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const samePhone = (a, b) => digits10(a) === digits10(b);
const nameKey = (s) => clean(s, 200).toLowerCase().replace(/[^a-z\u00c0-\u024f ]/g, '');

/** A US-style phone for people to read: (404) 555-0100; anything else as it is */
export function phoneText(s) {
  const d = String(s || '').replace(/\D/g, '');
  const ten = d.length === 11 && d[0] === '1' ? d.slice(1) : d;
  return ten.length === 10 ? `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}` : String(s || '').trim();
}

/**
 * One contact as sent, checked: { id?, name, title, email, phone, remove } or an error naming the box. `before`: the
 * same person as JobTread has them, whose email or phone left as it was is never questioned (one typed into JobTread
 * by hand years ago may not be in a shape the page would take, and confirming it shouldn't fail)
 */
export function cleanContact(c, i = 0, before = null) {
  const where = (k) => `contacts.${i}.${k}`;
  const name = clean(c?.name, LIMITS.name);
  const title = clean(c?.title, LIMITS.title);
  const email = clean(c?.email, LIMITS.email).toLowerCase();
  const rawPhone = clean(c?.phone, LIMITS.phone);
  const id = isAccountId(c?.id) ? String(c.id) : null;
  const remove = c?.remove === true;
  if (remove) return { id, name, title, email, phone: rawPhone, remove };
  if (!name) throw bad('Add a name for each person.', where('name'));
  const keptEmail = before && email && sameEmail(email, before.email);
  if (email && !keptEmail && !isEmail(email)) throw bad(`That email for ${name} doesn’t look right.`, where('email'));
  const keptPhone = before && rawPhone && before.phone && samePhone(rawPhone, before.phone) && digits10(rawPhone).length >= 7;
  const phone = !rawPhone ? '' : keptPhone ? before.phone : toE164(rawPhone);
  if (rawPhone && !phone) throw bad(`That phone number for ${name} doesn’t look right. Use 10 digits, like (404) 555-0100.`, where('phone'));
  if (!id && !email && !phone) throw bad(`Add an email or a phone number for ${name}, so we can reach them.`, where('email'));
  return { id, name, title, email, phone, remove: false };
}

const sameAddress = (a, b) => !!a && !!b && ['line1', 'line2', 'city', 'state', 'zip'].every((k) => clean(a[k], 200).toLowerCase() === clean(b[k], 200).toLowerCase());

/**
 * An address as sent: null for "the same" (or the one on file, `onFile`, sent back as it was: never questioned, as a
 * JobTread address with no ZIP shouldn't stop a family changing a phone number), or { line1, line2, city, state, zip }
 */
export function cleanAddress(a, onFile = null) {
  if (!a || a.same === true) return null;
  const out = { line1: clean(a.line1, LIMITS.line), line2: clean(a.line2, LIMITS.line), city: clean(a.city, LIMITS.city), state: clean(a.state, LIMITS.state).toUpperCase(), zip: clean(a.zip, LIMITS.zip) };
  if (!out.line1 && !out.city && !out.zip) return null;
  if (sameAddress(out, onFile)) return null;
  if (!out.line1) throw bad('Add the street address.', 'address.line1');
  if (!out.city) throw bad('Add the city.', 'address.city');
  if (!out.state) throw bad('Add the state.', 'address.state');
  if (!/^\d{5}(-\d{4})?$/.test(out.zip)) throw bad('Add the 5-digit ZIP code.', 'address.zip');
  return out;
}

/**
 * What a send changes, read against the family as JobTread has them right now → { edits, adds, removes, unknown }
 *   edits    [{ id, name, fields: { name|title|email|phone: [before, after] } }]  only what differs
 *   adds     [{ name, title, email, phone }]  a "new" person already on the account (same email, or same name and
 *            phone, or same name and nothing else) is an edit of them instead, so a send made twice adds nobody twice
 *   removes  [{ id, name }]  people asked to be taken off
 *   unknown  ids sent that aren't on the account any more (taken off in JobTread meanwhile): left alone
 */
export function planUpdate(current, sent) {
  const have = new Map((current || []).map((c) => [c.id, c]));
  const edits = [];
  const adds = [];
  const removes = [];
  const unknown = [];
  const touched = new Set();
  const diff = (before, c) => {
    const fields = {};
    if (c.name !== clean(before.name, LIMITS.name)) fields.name = [before.name, c.name];
    if (c.title !== clean(before.title, LIMITS.title)) fields.title = [before.title, c.title];
    if (!sameEmail(c.email, before.email)) fields.email = [before.email, c.email];
    if (!samePhone(c.phone, before.phone) || (!c.phone) !== (!before.phone)) fields.phone = [before.phone, c.phone];
    return fields;
  };
  for (const c of sent || []) {
    if (c.id) {
      const before = have.get(c.id);
      if (!before) { unknown.push(c.id); continue; }
      touched.add(c.id);
      if (c.remove) { removes.push({ id: c.id, name: before.name }); continue; }
      const fields = diff(before, c);
      if (Object.keys(fields).length) edits.push({ id: c.id, name: c.name, fields });
      continue;
    }
    if (c.remove) continue;
    const twin = (current || []).find((x) => !touched.has(x.id) && (
      (c.email && sameEmail(c.email, x.email))
      || (nameKey(c.name) === nameKey(x.name) && ((c.phone && samePhone(c.phone, x.phone)) || (!x.email && !x.phone)))));
    if (twin) {
      touched.add(twin.id);
      // Only fills in: a twin's own email or phone is never blanked by a new row that lacks it
      const fields = diff(twin, { ...c, title: c.title || twin.title, email: c.email || twin.email, phone: c.phone || twin.phone });
      if (Object.keys(fields).length) edits.push({ id: twin.id, name: c.name, fields });
      continue;
    }
    if (adds.some((a) => (c.email && sameEmail(a.email, c.email)) || (nameKey(a.name) === nameKey(c.name) && samePhone(a.phone, c.phone)))) continue;
    adds.push({ name: c.name, title: c.title, email: c.email, phone: c.phone });
  }
  return { edits, adds, removes, unknown };
}

const fieldsFor = (p) => ({ [FIELD_CONTACT_EMAIL]: p.email || null, [FIELD_CONTACT_PHONE]: p.phone || null });

async function writeEdit(env, e, after, fetchImpl) {
  const $ = { id: e.id };
  if (e.fields.name) $.name = after.name;
  if (e.fields.title) $.title = after.title || null;
  const cf = {};
  if (e.fields.email) cf[FIELD_CONTACT_EMAIL] = after.email || null;
  if (e.fields.phone) cf[FIELD_CONTACT_PHONE] = after.phone || null;
  if (Object.keys(cf).length) $.customFieldValues = cf;
  await pave(env.JOBTREAD_GRANT_KEY, { updateContact: { $ } }, fetchImpl);
}
async function writeAdd(env, accountId, p, fetchImpl) {
  const $ = { accountId, name: p.name, ...(p.title ? { title: p.title } : {}) };
  const cf = Object.fromEntries(Object.entries(fieldsFor(p)).filter(([, v]) => v));
  const body = await pave(env.JOBTREAD_GRANT_KEY, { createContact: { $: { ...$, ...(Object.keys(cf).length ? { customFieldValues: cf } : {}) }, createdContact: { id: {} } } }, fetchImpl);
  const id = body?.createContact?.createdContact?.id;
  if (!id) throw new Error('JobTread didn’t say it added them');
  return id;
}

/**
 * A family's confirm or changes, written to JobTread and logged.
 *   input  { contacts: [{ id?, name, title, email, phone, remove? }], address: { same } | { line1, … }, note, confirm }
 *   by     'family' (from their link: removals wait for staff) or a staff email (removals happen at once)
 * → { kind: 'confirmed' | 'updated', edits, adds, removes, address, problems, family }
 */
export async function applyUpdate(env, accountId, input, { by = 'family', linkId = null, fetchImpl = fetch, now = Date.now() } = {}) {
  const { DB } = env;
  await ensureFamilySchema(DB);
  const staff = by !== 'family';
  const sent = Array.isArray(input?.contacts) ? input.contacts : [];
  if (sent.length > LIMITS.contacts + LIMITS.adds) throw bad('That’s more people than we can take at once.');
  const note = clean(input?.note, LIMITS.note);

  const fresh = await readFamily(env, accountId, { fetchImpl });
  if (!fresh) throw Object.assign(new Error('We couldn’t find this family in JobTread.'), { status: 404 });
  const mirror = await DB.prepare('SELECT mailing FROM families WHERE account_id = ?').bind(accountId).first();
  const onFile = parse(mirror?.mailing, null) || fresh.home;
  const address = cleanAddress(input?.address, onFile);
  const had = new Map(fresh.contacts.map((c) => [c.id, c]));
  const contacts = sent.map((c, i) => cleanContact(c, i, had.get(c?.id) || null));
  if (contacts.filter((c) => !c.id && !c.remove).length > LIMITS.adds) throw bad(`Add up to ${LIMITS.adds} people at a time.`);
  const plan = planUpdate(fresh.contacts, contacts);
  const main = staff && plan.removes.find((r) => r.id === fresh.primaryContactId);
  if (main) throw bad(`${main.name} is the main contact in JobTread. Make someone else the main contact there first.`);
  const after = new Map(contacts.filter((c) => c.id).map((c) => [c.id, c]));
  const problems = [];
  const done = { edits: [], adds: [], removes: [] };

  for (const e of plan.edits) {
    const want = after.get(e.id) || { ...fresh.contacts.find((x) => x.id === e.id), ...Object.fromEntries(Object.entries(e.fields).map(([k, [, v]]) => [k, v])) };
    try { await writeEdit(env, e, want, fetchImpl); done.edits.push(e); } catch (err) { problems.push(`Couldn’t change ${e.name} in JobTread: ${err.message}`); }
  }
  for (const a of plan.adds) {
    try { done.adds.push({ ...a, id: await writeAdd(env, accountId, a, fetchImpl) }); } catch (err) { problems.push(`Couldn’t add ${a.name} in JobTread: ${err.message}`); }
  }
  for (const r of plan.removes) {
    if (staff) {
      try { await pave(env.JOBTREAD_GRANT_KEY, { deleteContact: { $: { id: r.id } } }, fetchImpl); done.removes.push(r); } catch (err) { problems.push(`Couldn’t take ${r.name} off in JobTread: ${err.message}`); }
    } else {
      const open = await DB.prepare('SELECT id FROM family_removals WHERE account_id = ? AND contact_id = ? AND decided_at IS NULL').bind(accountId, r.id).first();
      // (asked already and still waiting: not asked again)
      if (open) continue;
      await DB.prepare('INSERT INTO family_removals (account_id, contact_id, name, asked_at, asked_by) VALUES (?, ?, ?, ?, ?)').bind(accountId, r.id, r.name, iso(now), by).run();
      done.removes.push(r);
    }
  }
  // Nothing went through and something should have: JobTread is down, so nothing is logged as saved
  const wanted = plan.edits.length + plan.adds.length + (staff ? plan.removes.length : 0);
  const wrote = done.edits.length + done.adds.length + (staff ? done.removes.length : 0);
  if (wanted && !wrote && problems.length) throw Object.assign(new Error('We couldn’t save that just now. Please try again in a few minutes.'), { status: 503, problems });

  const moved = address && !sameAddress(address, onFile) ? { before: onFile ? addressText(onFile) : '', after: address } : null;

  const changes = [
    ...done.edits.map((e) => ({ type: 'edit', id: e.id, name: e.name, fields: e.fields })),
    ...done.adds.map((a) => ({ type: 'add', id: a.id, name: a.name, title: a.title, email: a.email, phone: a.phone })),
    ...done.removes.map((r) => ({ type: staff ? 'remove' : 'remove-ask', id: r.id, name: r.name })),
  ];
  const kind = changes.length || moved || note ? 'updated' : 'confirmed';
  await DB.prepare('INSERT INTO family_updates (account_id, link_id, at, by, kind, changes, address, note, problems) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(accountId, linkId, iso(now), by, kind, changes.length ? JSON.stringify(changes) : null, moved ? JSON.stringify(moved) : null, note || null, problems.length ? JSON.stringify(problems) : null).run();
  if (linkId) await DB.prepare('UPDATE family_links SET answered_at = ?, submissions = submissions + 1 WHERE id = ?').bind(iso(now), linkId).run();

  // The mirror, from JobTread as it is now (a re-read; what was just written shows at once)
  let family = fresh;
  if (wrote) { try { family = await readFamily(env, accountId, { fetchImpl }) || fresh; } catch { /* the last read stands */ } }
  await refreshFamily(env, accountId, { fetchImpl, now, fresh: family });
  if (moved) await DB.prepare('UPDATE families SET mailing = ? WHERE account_id = ?').bind(JSON.stringify({ ...address, at: iso(now), by }), accountId).run();
  return { kind, ...done, address: moved, note, problems, family };
}

/** Staff decide a removal a family asked for: 'remove' takes them off in JobTread, 'keep' leaves them */
export async function decideRemoval(env, id, decision, { by, fetchImpl = fetch, now = Date.now() } = {}) {
  const { DB } = env;
  await ensureFamilySchema(DB);
  const row = await DB.prepare('SELECT * FROM family_removals WHERE id = ?').bind(Number(id) || 0).first();
  if (!row) throw Object.assign(new Error('That request isn’t there any more.'), { status: 404 });
  if (row.decided_at) return { already: true, decision: row.decision };
  if (decision === 'remove') {
    const fresh = await readFamily(env, row.account_id, { fetchImpl });
    const there = fresh?.contacts.some((c) => c.id === row.contact_id);
    if (there) {
      if (row.contact_id === fresh.primaryContactId) throw bad(`${row.name} is the main contact in JobTread. Make someone else the main contact there first.`);
      await pave(env.JOBTREAD_GRANT_KEY, { deleteContact: { $: { id: row.contact_id } } }, fetchImpl);
    }
    await DB.prepare('INSERT INTO family_updates (account_id, at, by, kind, changes) VALUES (?, ?, ?, ?, ?)')
      .bind(row.account_id, iso(now), by, 'updated', JSON.stringify([{ type: 'remove', id: row.contact_id, name: row.name, asked: true }])).run();
    await refreshFamily(env, row.account_id, { fetchImpl, now });
  } else if (decision !== 'keep') throw bad('Remove or keep?');
  await DB.prepare('UPDATE family_removals SET decided_at = ?, decided_by = ?, decision = ? WHERE id = ?').bind(iso(now), by, decision, row.id).run();
  return { decision };
}

/** Staff clear the address a family gave once it's dealt with (copied into JobTread, or wrong) */
export async function clearMailing(DB, accountId) {
  await ensureFamilySchema(DB);
  await DB.prepare('UPDATE families SET mailing = NULL WHERE account_id = ?').bind(accountId).run();
}

// ─── What the family's page shows ───────────────────────────────────

/** The child (or children) the family is known for here: their kid pages, else the account's name less "(2012)" */
export function childOf(kids, accountName) {
  const names = [...new Set((kids || []).map((k) => clean(k.name, 80)).filter(Boolean))];
  if (names.length) return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return clean(String(accountName || '').replace(/\(\d{4}\)/g, ''), 80) || '';
}

/** What the page gets: the family as JobTread has them now, the address on file, and the boxes' choices */
export function publicView(fresh, mirror, link) {
  const kids = parse(mirror?.kids, []);
  const mailing = parse(mirror?.mailing, null);
  const home = mailing || fresh.home;
  return {
    child: childOf(kids, fresh.name),
    greeting: greetingNames(fresh.contacts, { fallback: '' }),
    contacts: fresh.contacts.map((c) => ({ id: c.id, name: c.name, title: c.title, email: c.email, phone: phoneText(c.phone), main: c.id === fresh.primaryContactId })),
    address: home ? { line1: home.line1 || '', line2: home.line2 || '', city: home.city || '', state: home.state || '', zip: home.zip || '' } : null,
    relationships: RELATIONSHIPS,
    answered: !!link?.answered_at,
    expiresAt: link?.expires_at || null,
  };
}

// ─── The email ──────────────────────────────────────────────────────

const longDay = (isoDate) => new Date(isoDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });

/** The email that asks a family to check what we have → { subject, html, text } */
export function familyEmail({ greeting = '', child = '', url, expiresAt }) {
  const hi = greeting ? `Hi ${greeting},` : 'Hello,';
  const subject = 'Is this still the best way to reach you?';
  const heading = 'Let’s stay in touch';
  const lines = [
    `We love staying connected with the families we’ve built rooms for. Could you take a minute to check the contact information we have for ${child ? `${child}’s family` : 'your family'}?`,
    'You can confirm it’s right, fix anything that has changed, and add anyone else we should be able to reach, like a spouse, a grandparent or another caregiver.',
  ];
  const until = expiresAt ? longDay(expiresAt) : '';
  const small = `This link is just for your family${until ? ` and works until ${until}` : ''}. If you have any questions, reply to this email.`;
  const bodyHtml = `${paragraphs(hi)}${paragraphs(lines.join('\n\n'))}<div style="margin:6px 0 18px;">${button('Check your contact info', url, 'primary', { big: true })}</div>`
    + `${paragraphs('With gratitude,\nThe Sunshine on a Ranney Day team')}`;
  const footerHtml = `<span class="muted" style="font-family:${SANS};color:${MUTED};">${esc(small)}</span>`;
  const html = emailShell({ preheader: 'Take a minute to check the contacts we have for your family, and add anyone we should reach.', eyebrow: 'Sunshine on a Ranney Day', heading, bodyHtml, footerHtml });
  const text = [hi, '', ...lines.flatMap((l) => [l, '']), `Check your contact info: ${url}`, '', 'With gratitude,', 'The Sunshine on a Ranney Day team', '', small].join('\n');
  return { subject, html, text };
}

/** Everyone on the family with an email address, once each */
export function recipientsOf(contacts) {
  const seen = new Set();
  const out = [];
  for (const c of contacts || []) {
    const e = String(c.email || '').trim().toLowerCase();
    if (!isEmail(e) || seen.has(e)) continue;
    seen.add(e);
    out.push({ name: c.name, email: e });
  }
  return out;
}

/**
 * Email a family their link: a new one (the last stops working), to everyone on their account with an email address,
 * read fresh from JobTread → { sent, to, url, expiresAt } or an error when there's nobody to send to
 */
export async function sendFamilyLink(env, accountId, { by, fetchImpl = fetch, now = Date.now() } = {}) {
  const { DB } = env;
  await ensureFamilySchema(DB);
  if (!emailConfigured(env)) throw Object.assign(new Error('Email isn’t set up on the site (RESEND_API_KEY).'), { status: 503 });
  const fresh = await readFamily(env, accountId, { fetchImpl });
  if (!fresh) throw Object.assign(new Error('We couldn’t find this family in JobTread.'), { status: 404 });
  const to = recipientsOf(fresh.contacts);
  if (!to.length) throw bad('Nobody in this family has an email address yet. Add one first.');
  const mirror = await DB.prepare('SELECT kids FROM families WHERE account_id = ?').bind(accountId).first();
  const link = await createFamilyLink(DB, accountId, { by, now });
  const msg = familyEmail({ greeting: greetingNames(fresh.contacts.filter((c) => recipientsOf([c]).length), { fallback: '' }), child: childOf(parse(mirror?.kids, []), fresh.name), url: link.url, expiresAt: link.expiresAt });
  const r = await sendEmails(env, { to: to.map((t) => t.email), ...msg, tags: [{ name: 'type', value: 'family-update' }] });
  if (!r.sent) {
    await DB.prepare("UPDATE family_links SET status = 'replaced' WHERE id = ?").bind(link.id).run();
    throw Object.assign(new Error(r.errors?.[0] ? `The email didn’t go: ${r.errors[0]}` : 'The email didn’t go.'), { status: 502 });
  }
  await DB.prepare('UPDATE family_links SET sent_to = ?, sent_at = ?, sent_by = ? WHERE id = ?').bind(JSON.stringify(to.map((t) => t.email)), iso(now), by, link.id).run();
  await refreshFamily(env, accountId, { fetchImpl, now, fresh });
  return { sent: r.sent, to: to.map((t) => t.email), url: link.url, expiresAt: link.expiresAt };
}

// ─── Admin reads ────────────────────────────────────────────────────

/** Where a family's link stands: 'none' | 'made' | 'sent' | 'opened' | 'answered' | 'expired' */
export function linkState(l, now = Date.now()) {
  if (!l) return 'none';
  if (l.answered_at) return 'answered';
  if (Date.parse(l.expires_at) < now) return 'expired';
  if (l.opened_at) return 'opened';
  if (l.sent_at) return 'sent';
  return 'made';
}

const linkOut = (l, now) => (!l ? null : {
  id: l.id, state: linkState(l, now), createdAt: l.created_at, createdBy: l.created_by, expiresAt: l.expires_at, live: l.status === 'open' && Date.parse(l.expires_at) >= now,
  sentAt: l.sent_at, sentBy: l.sent_by, sentTo: parse(l.sent_to, []), openedAt: l.opened_at, answeredAt: l.answered_at, submissions: l.submissions,
});
const familyOut = (r) => ({
  id: r.account_id, name: r.name, kids: parse(r.kids, []), year: r.year, status: r.status, language: r.language,
  contacts: parse(r.contacts, []).map((c) => ({ ...c, main: c.id === r.primary_contact_id })), home: parse(r.address, null), mailing: parse(r.mailing, null),
  syncedAt: r.synced_at,
});

/** Admin → Families: every family with its latest link, last answer and anything waiting on staff */
export async function listFamilies(DB, now = Date.now()) {
  await ensureFamilySchema(DB);
  const [fams, links, last, removals] = await Promise.all([
    DB.prepare('SELECT * FROM families WHERE gone_at IS NULL ORDER BY year DESC, name').all(),
    DB.prepare('SELECT l.* FROM family_links l JOIN (SELECT account_id, max(id) AS id FROM family_links GROUP BY account_id) m ON m.id = l.id').all(),
    DB.prepare("SELECT u.account_id, u.at, u.kind, u.by FROM family_updates u JOIN (SELECT account_id, max(id) AS id FROM family_updates GROUP BY account_id) m ON m.id = u.id").all(),
    DB.prepare('SELECT account_id, count(*) AS n FROM family_removals WHERE decided_at IS NULL GROUP BY account_id').all(),
  ]);
  const linkBy = new Map((links.results || []).map((l) => [l.account_id, l]));
  const lastBy = new Map((last.results || []).map((u) => [u.account_id, u]));
  const remBy = new Map((removals.results || []).map((r) => [r.account_id, r.n]));
  const families = (fams.results || []).map((r) => {
    const u = lastBy.get(r.account_id);
    return { ...familyOut(r), link: linkOut(linkBy.get(r.account_id), now), last: u ? { at: u.at, kind: u.kind, by: u.by } : null, removals: remBy.get(r.account_id) || 0 };
  });
  return {
    families,
    syncedAt: await getState(DB, 'synced_at'),
    kidsWithoutFamily: parse(await getState(DB, 'kids_without_family'), []),
  };
}

/** One family for the admin: the mirror, every link, every update and the removals waiting */
export async function familyDetail(DB, accountId, now = Date.now()) {
  await ensureFamilySchema(DB);
  const r = await DB.prepare('SELECT * FROM families WHERE account_id = ?').bind(accountId).first();
  if (!r) return null;
  const [links, updates, removals] = await Promise.all([
    DB.prepare('SELECT * FROM family_links WHERE account_id = ? ORDER BY id DESC LIMIT 20').bind(accountId).all(),
    DB.prepare('SELECT * FROM family_updates WHERE account_id = ? ORDER BY id DESC LIMIT 100').bind(accountId).all(),
    DB.prepare('SELECT * FROM family_removals WHERE account_id = ? AND decided_at IS NULL ORDER BY id').bind(accountId).all(),
  ]);
  return {
    ...familyOut(r), gone: !!r.gone_at,
    links: (links.results || []).map((l) => linkOut(l, now)),
    updates: (updates.results || []).map((u) => ({ id: u.id, at: u.at, by: u.by, kind: u.kind, changes: parse(u.changes, []), address: parse(u.address, null), note: u.note, problems: parse(u.problems, []) })),
    removals: (removals.results || []).map((x) => ({ id: x.id, contactId: x.contact_id, name: x.name, askedAt: x.asked_at })),
  };
}
