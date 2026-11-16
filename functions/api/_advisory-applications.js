/**
 * Advisory Board applications (Oct 2026)
 * ===========================================================================
 * Peter, Oct 22 2026: "we need to convert the jotform for advisory too". The
 * site's own application (/advisory-board/apply/, ./advisory-apply.js)
 * replaced the Jotform one. Each application is kept here (D1
 * advisory_applications). The applicant gets a copy of what they sent, and
 * staff hear about it by email (the list in the admin) and in Slack.
 *
 * Admin → People → Applications works through them
 * (./advisory-applications-admin.js): where each one stands, notes, and Add
 * to Advisory Board (on People → Advisory with their private email and their
 * headshot as their photo, hidden from the public site until staff show them;
 * they can sign in at once). The applications sent to Jotform come in once,
 * from the Jotform backfill's copy (./_jotform-backfill.js); anyone who's
 * already on People → Advisory is marked Joined.
 *
 * The headshot (Peter, Nov 16 2026: "headshot required") goes to Cloudflare
 * Images when the application is stored, under an address nobody can guess,
 * as a board member's own photo from /profile-update/ does: nothing links to
 * it until staff use it. Add to Advisory Board makes that same picture their
 * People photo. Deleting the application deletes it, unless People uses it.
 *
 * A name starting with TEST is a test, as on the makeover form: the staff
 * email goes only to the address on the application (the tester), Slack
 * marks it 🧪, the admin tags it, and it never counts as New.
 */

import { ADVISORY_FIELDS, checkAnswers, answerSections, JOTFORM_FIELDS, OVERVIEW_PDF, EMAIL_RE, greetName, PHOTO_FIELDS, PHOTO_ADDED, headshotProblem, HEADSHOT_MAX_BYTES, HEADSHOT_CUT } from './_advisory-form.js';
import { uploadImage, publicUrl, deleteImage, CF_HASH } from './_cf-images.js';
import { cfId as imageIdOf } from '../../public/admin/team-shared.js';
import { checkImage, imageSize, imageWhole } from './_image-types.js';
import { SLUG_RE } from './_content-history.js';
import { personStatus } from './_team.js';
import { sendEmails, SITE_ORIGIN, slackPost } from './_broadcast-notify.js';
import { slackCard } from './_slack-cards.js';
import * as mail from './_email-shell.js';

export const STATUSES = [
  { id: 'new', label: 'New' },
  { id: 'talking', label: 'In conversation' },
  { id: 'joined', label: 'Joined' },
  { id: 'not-now', label: 'Not now' },
];
const STATUS_IDS = new Set(STATUSES.map((s) => s.id));
export const DEFAULT_STAFF_EMAILS = ['info@soardcharity.com'];
export const adminUrl = (id) => `${SITE_ORIGIN}/admin/#advisory-applications${id ? `/${id}` : ''}`;
const iso = (t = Date.now()) => new Date(t).toISOString();
const parse = (s, d = null) => { try { return s == null ? d : JSON.parse(s); } catch { return d; } };
export const isApplicationId = (s) => /^adv-[0-9a-z-]{8,40}$/.test(String(s || ''));
const newId = () => `adv-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
/** A test application: the full name starts with TEST, like the makeover form's test families */
export const isTestApplication = (nameOrAnswers) => /^\s*test\b/i.test(typeof nameOrAnswers === 'string' ? nameOrAnswers : nameOrAnswers?.fullName || '');
const TEST_LABEL = 'Test application · not a real applicant';
const firstName = greetName;
const normalizeName = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// ─── D1 ─────────────────────────────────────────────────────────────

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS advisory_applications (
    id TEXT PRIMARY KEY, source TEXT NOT NULL DEFAULT 'site', source_id TEXT,
    name TEXT NOT NULL, email TEXT, phone TEXT, company TEXT, job_title TEXT,
    answers TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', status_at TEXT, status_by TEXT,
    notes TEXT, person_slug TEXT, ip_hash TEXT, notified TEXT, headshot TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_advisory_source ON advisory_applications(source, source_id)',
  'CREATE INDEX IF NOT EXISTS idx_advisory_created ON advisory_applications(created_at)',
  'CREATE TABLE IF NOT EXISTS advisory_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT NOT NULL, updated_by TEXT)',
];
const _ready = new WeakSet();
export async function ensureAdvisorySchema(DB) {
  if (_ready.has(DB)) return;
  await DB.batch(SCHEMA.map((s) => DB.prepare(s)));
  // The headshot (Nov 2026): { id, url, width, height, bytes, at } of its picture on Cloudflare Images
  try { await DB.prepare('ALTER TABLE advisory_applications ADD COLUMN headshot TEXT').run(); } catch { /* already there */ }
  // The page's id for this application (the same on every send of it): two sends at once are one application
  try { await DB.prepare('ALTER TABLE advisory_applications ADD COLUMN send_id TEXT').run(); } catch { /* already there */ }
  await DB.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_advisory_send ON advisory_applications(send_id)').run();
  // Their email and answers, and the 30 days they fall in: the same application sent twice at once (with no page id
  // to say so) is one application too
  try { await DB.prepare('ALTER TABLE advisory_applications ADD COLUMN same_key TEXT').run(); } catch { /* already there */ }
  await DB.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_advisory_same ON advisory_applications(same_key)').run();
  _ready.add(DB);
}

function fromRow(r, { full = false } = {}) {
  if (!r) return null;
  const answers = parse(r.answers, {});
  const hs = parse(r.headshot, null);
  const out = {
    id: r.id, source: r.source, name: r.name, email: r.email, phone: r.phone, company: r.company, jobTitle: r.job_title,
    status: STATUS_IDS.has(r.status) ? r.status : 'new', statusAt: r.status_at, statusBy: r.status_by,
    personSlug: r.person_slug, createdAt: r.created_at, updatedAt: r.updated_at,
    link: answers.link || null, preferredName: answers.preferredName || null,
    notes: parse(r.notes, []).length,
    isTest: isTestApplication(r.name),
    // One line for the list: why they want to serve
    why: String(answers.why || '').replace(/\s+/g, ' ').slice(0, 220),
    headshot: hs?.url ? { url: hs.url, width: Number(hs.width) || null, height: Number(hs.height) || null } : null,
  };
  if (full) {
    out.answers = answers;
    out.sections = answerSections(answers);
    out.notes = parse(r.notes, []);
    out.notified = parse(r.notified, null);
  }
  return out;
}

// ─── Settings: who hears about a new application ─────────────────────
// Peter, Oct 22 2026: "holly, linzi and the board member in charge of that
// committee". The emails are a list saved here (from the admin, never the
// code); the committee member is whoever People → Board says is on it, read
// when each email goes, so a new chair needs no change here.

export const DEFAULT_COMMITTEE = 'Advisory Board';
const COMMITTEE_MAX = 60;
const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/** Active board members on a committee, with their private email (People → Board) */
export async function committeeMembers(DB, committee) {
  if (!String(committee || '').trim()) return [];
  let rows = [];
  try { rows = (await DB.prepare('SELECT slug, data FROM team').all()).results || []; } catch { return []; }
  let emails = {};
  try { emails = Object.fromEntries(((await DB.prepare('SELECT slug, email FROM reveal_board_emails').all()).results || []).map((r) => [r.slug, r.email])); } catch { /* no emails saved yet */ }
  return rows.map((r) => ({ slug: r.slug, d: parse(r.data, {}) || {} }))
    .filter(({ d }) => d.group === 'board' && (d.status || 'active') === 'active' && !/^in memoriam\b/i.test(d.name || '')
      && Array.isArray(d.committees) && d.committees.some((c) => sameName(c, committee)))
    .map(({ slug, d }) => ({ slug, name: d.name || slug, email: emails[slug] || null }));
}

/** Every committee name the board uses, for the admin's pick (the saved list, the names on records, and this one) */
async function committeeNames(DB) {
  const names = new Map();
  const add = (n) => { const t = String(n || '').trim(); if (t && !names.has(t.toLowerCase())) names.set(t.toLowerCase(), t); };
  add(DEFAULT_COMMITTEE);
  try {
    const doc = await DB.prepare("SELECT data FROM site_config WHERE key = 'board-committees'").first();
    for (const n of parse(doc?.data, {})?.committees || []) add(n);
  } catch { /* no site docs (tests) */ }
  try {
    for (const r of (await DB.prepare('SELECT data FROM team').all()).results || []) {
      const d = parse(r.data, {}) || {};
      if (d.group === 'board') for (const c of d.committees || []) add(c);
    }
  } catch { /* no team table (tests) */ }
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

export async function getAdvisorySettings(DB) {
  await ensureAdvisorySchema(DB);
  const { results } = await DB.prepare("SELECT key, value, updated_at, updated_by FROM advisory_settings WHERE key IN ('staffEmails', 'committee')").all();
  const row = Object.fromEntries((results || []).map((r) => [r.key, r]));
  const list = parse(row.staffEmails?.value, null);
  const committee = row.committee ? String(parse(row.committee.value, '') || '') : DEFAULT_COMMITTEE;
  const members = await committeeMembers(DB, committee);
  const latest = [row.staffEmails, row.committee].filter(Boolean).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0];
  return {
    staffEmails: Array.isArray(list) ? list : DEFAULT_STAFF_EMAILS,
    committee,
    committeeMembers: members.map((m) => ({ name: m.name, hasEmail: !!m.email })),
    committees: await committeeNames(DB),
    updatedAt: latest?.updated_at || null, updatedBy: latest?.updated_by || null, isDefault: !Array.isArray(list),
  };
}

/**
 * Everyone a new (real) application emails: the list, and the committee's members who have an email. Never
 * nobody: with neither (the list emptied, the committee's last member gone), info@ hears
 */
export async function staffRecipients(DB) {
  const s = await getAdvisorySettings(DB);
  const members = await committeeMembers(DB, s.committee);
  const to = [...new Set([...s.staffEmails, ...members.map((m) => m.email).filter(Boolean)].map((e) => String(e).toLowerCase()))];
  return to.length ? to : DEFAULT_STAFF_EMAILS;
}

/** Save who hears: { settings } or { problems }. `committee` '' means no committee. */
export async function saveAdvisorySettings(DB, { staffEmails, committee }, { by = null, now = Date.now() } = {}) {
  await ensureAdvisorySchema(DB);
  if (committee !== undefined && committee !== null && typeof committee !== 'string') return { problems: { committee: 'Pick a committee from the list.' } };
  // (only the committee sent: the list stays as it is)
  if (staffEmails === undefined) staffEmails = (await getAdvisorySettings(DB)).staffEmails;
  const list = [...new Set((Array.isArray(staffEmails) ? staffEmails : String(staffEmails || '').split(/[\s,;]+/)).map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
  const bad = list.filter((e) => !EMAIL_RE.test(e));
  if (bad.length) return { problems: { staffEmails: `${bad.join(', ')} ${bad.length === 1 ? 'isn’t an email address' : 'aren’t email addresses'}.` } };
  if (list.length > 20) return { problems: { staffEmails: 'That’s more than 20 people. Use a group address instead.' } };
  const c = committee === undefined ? undefined : String(committee || '').replace(/\s+/g, ' ').trim().slice(0, COMMITTEE_MAX);
  const keepCommittee = c === undefined ? (await getAdvisorySettings(DB)).committee : c;
  if (!list.length && !keepCommittee) return { problems: { staffEmails: 'Add at least one email or pick a committee, or nobody hears about new applications.' } };
  // A committee with nobody on it who has an email reaches nobody either
  if (!list.length && !(await committeeMembers(DB, keepCommittee)).some((m) => m.email)) {
    return { problems: { staffEmails: `Nobody on the ${keepCommittee} committee has an email on People → Board yet, so nobody would hear about new applications. Add an email here too.` } };
  }
  const put = (key, value) => DB.prepare('INSERT INTO advisory_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by')
    .bind(key, JSON.stringify(value), iso(now), by);
  await DB.batch([put('staffEmails', list), ...(c === undefined ? [] : [put('committee', c)])]);
  return { settings: await getAdvisorySettings(DB) };
}

// ─── A new application ──────────────────────────────────────────────

const PHOTO_KINDS = { jpeg: 'jpg', png: 'png', webp: 'webp' };
const randomHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * The headshot as the form sent it (a File) → { headshot: { bytes, type, kind, width, height } }, or { problem }
 * in words for the applicant. Its own bytes decide what it is (a JPEG, PNG or WebP; the page always sends a
 * JPEG it drew), never the label it came with; its header its size; and a file cut off partway is no photo.
 */
export async function readHeadshot(file) {
  if (!file || typeof file === 'string' || !file.size) return { problem: 'Please add a headshot.' };
  if (file.size > HEADSHOT_MAX_BYTES) return { problem: 'That photo is too large to send. Please choose a smaller one.' };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const checked = checkImage(bytes, '');
  // A picture of a kind not taken here (an iPhone photo, an AVIF or a GIF sent straight here, not through the page,
  // which draws every photo as a JPEG first)
  const isoMedia = bytes.length >= 12 && String.fromCharCode(...bytes.subarray(4, 8)) === 'ftyp';
  if ((checked.ok && !PHOTO_KINDS[checked.kind]) || (!checked.ok && isoMedia)) return { problem: 'Please send the photo as a JPEG, PNG or WebP.' };
  // (what this server takes, said as such: the page itself takes any photo and sends a JPEG it drew)
  if (!checked.ok || !PHOTO_KINDS[checked.kind]) return { problem: 'That file isn’t a photo we can use. Please send a JPEG, PNG or WebP photo.' };
  if (!imageWhole(bytes)) return { problem: HEADSHOT_CUT };
  const size = imageSize(bytes);
  const problem = headshotProblem(size);
  if (problem) return { problem };
  // What Cloudflare Images takes: 12,000 px a side, 100 megapixels (the page draws within these)
  if (Math.max(size.width, size.height) > 12_000 || size.width * size.height > 100_000_000) return { problem: 'That photo is too large to use. Please choose a smaller one.' };
  return { headshot: { bytes, type: checked.type, kind: checked.kind, width: size.width, height: size.height } };
}

const sha256 = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Up to Cloudflare Images (where it was taken taken out on the way), under an id nobody can guess → what's kept of it */
async function storeHeadshot(env, appId, h, { fetchImpl = fetch, now = Date.now(), pickedAt = 0, seq = 0 } = {}) {
  const busy = Object.assign(new Error('We couldn’t save your headshot just now. Please press Send again in a minute. Your answers are still here.'), { status: 503 });
  if (!env.CF_ACCOUNT_ID || !env.CF_IMAGES_TOKEN) { console.error('[advisory] headshot: Cloudflare Images isn’t set up (CF_ACCOUNT_ID, CF_IMAGES_TOKEN)'); throw busy; }
  let r = null;
  const id = `advisory-applications/${appId}/${randomHex(12)}`;
  // Written down before it goes up: a request cut off before its application is stored leaves nothing behind (the
  // heartbeat takes off any picture still written down a while later that nothing points at)
  await trackUpload(env.DB, id, now);
  try {
    r = await uploadImage(env, { bytes: h.bytes, type: h.type, filename: `headshot.${PHOTO_KINDS[h.kind] || 'jpg'}`, id }, fetchImpl);
  } catch (e) { console.error('[advisory] headshot upload', e?.message || e); }
  if (!r?.success || !r.result?.id) {
    if (r) console.error('[advisory] headshot upload refused', r.status, JSON.stringify(r.errors || []));
    // Cloudflare refusing the picture itself (a 4xx that isn't about our own key): a photo to choose again, not a wait
    if (r && r.status >= 400 && r.status < 500 && ![401, 403, 429].includes(r.status)) {
      // (the page drew it from a photo they chose: said as "we couldn't use it", never "that isn't a photo")
      throw Object.assign(new Error(r.status === 413 ? 'That photo is too large to send. Please choose a smaller one.' : 'We couldn’t use that photo. Please choose a different one.'), { status: 422, field: 'headshot' });
    }
    throw busy;
  }
  return { id: r.result.id, url: publicUrl(r.result), width: h.width, height: h.height, bytes: h.bytes.length, sha: await sha256(h.bytes), at: iso(now), ...(pickedAt ? { pickedAt } : {}), ...(seq ? { seq } : {}) };
}

// ─── Pictures on Cloudflare nothing points at: never left behind ───
/*
 * advisory_image_cleanup: a picture written down when it goes up (at: then) until its application is stored, and one
 * Cloudflare didn't let go of when asked (at: 0). The heartbeat takes off each one written down more than a few
 * minutes ago that no application and no People record (now, or a version History keeps) points at.
 */
const CLEANUP = 'CREATE TABLE IF NOT EXISTS advisory_image_cleanup (id TEXT PRIMARY KEY, at INTEGER NOT NULL)';
const UPLOAD_GRACE_MS = 10 * 60 * 1000; // an upload still on its way is never taken off
async function trackUpload(DB, id, now) {
  await DB.prepare(CLEANUP).run();
  await DB.prepare('INSERT OR REPLACE INTO advisory_image_cleanup (id, at) VALUES (?, ?)').bind(id, now).run();
}
/** Its application has it now: crossed off */
async function untrack(DB, id) {
  await DB.prepare(CLEANUP).run();
  await DB.prepare('DELETE FROM advisory_image_cleanup WHERE id = ?').bind(id).run();
}
/** Take a picture off Cloudflare; one that won't go now is kept for the heartbeat */
export async function forgetImage(env, id, fetchImpl = fetch) {
  if (!id) return true;
  const gone = await deleteImage(env, id, fetchImpl).catch(() => false);
  await env.DB.prepare(CLEANUP).run();
  if (gone) await untrack(env.DB, id);
  else await env.DB.prepare('INSERT OR REPLACE INTO advisory_image_cleanup (id, at) VALUES (?, 0)').bind(id).run();
  return gone;
}
/** Is this picture an application's headshot (the one shown, or an older one kept)? A read that fails says so (thrown) */
async function photoOnApplication(DB, imageId) {
  try {
    return !!(await DB.prepare('SELECT 1 FROM advisory_applications WHERE instr(headshot, ?) > 0 LIMIT 1').bind(imageId).first());
  } catch (e) {
    if (/no such table/i.test(e?.message || '')) return false;
    throw e;
  }
}
/**
 * The heartbeat: each picture written down a while ago, taken off unless an application or People points at it
 * (then just crossed off). One that couldn't be checked or deleted just now stays for next time.
 */
export async function retryForgottenImages(env, { fetchImpl = fetch, now = Date.now() } = {}) {
  await env.DB.prepare(CLEANUP).run();
  const due = ((await env.DB.prepare('SELECT id FROM advisory_image_cleanup WHERE at <= ?').bind(now - UPLOAD_GRACE_MS).all()).results || []).map((r) => r.id);
  let gone = 0;
  for (const id of due) {
    let used;
    try { used = (await photoOnApplication(env.DB, id)) || (await photoOnPeople(env.DB, id)); } catch { continue; } // (D1 busy: next time)
    if (used || await deleteImage(env, id, fetchImpl).catch(() => false)) { await untrack(env.DB, id); gone++; }
  }
  const left = (await env.DB.prepare('SELECT count(*) AS n FROM advisory_image_cleanup').first())?.n || 0;
  return { gone, left: Number(left) };
}

/**
 * Store one from the site's form. The answers are checked here too (the page
 * checks first). A second send of the same answers within a month (a double
 * tap, a flaky connection, a page closed while it sent and sent again later)
 * is the same application.
 * Returns { app } or { problems }.
 */
const SEND_ID = /^[0-9a-z-]{16,64}$/i;
export async function submitApplication(env, raw, { ipHash = null, now = Date.now(), headshot = null, sendId = null, photoAt = 0, photoSeq = 0, fetchImpl = fetch, reserve = null, unreserve = null } = {}) {
  const { DB } = env;
  await ensureAdvisorySchema(DB);
  const send = SEND_ID.test(String(sendId || '')) ? String(sendId).toLowerCase() : null;
  // The same send again (a second tab, a retry while the first was still on its way): the one it made
  const sameSend = async () => (send ? DB.prepare('SELECT * FROM advisory_applications WHERE send_id = ?').bind(send).first() : null);
  // A photo's answer is whether the photo came (readHeadshot's), never what the page said about it
  const { answers, problems } = checkAnswers({ ...raw, ...Object.fromEntries(PHOTO_FIELDS.map((f) => [f.id, headshot ? PHOTO_ADDED : ''])) });
  if (Object.keys(problems).length) return { problems };
  for (const f of PHOTO_FIELDS) delete answers[f.id]; // the picture is kept on its own, never as an answer
  const json = JSON.stringify(answers);
  const again = await DB.prepare("SELECT * FROM advisory_applications WHERE source = 'site' AND email = ? AND answers = ? AND created_at > ?")
    .bind(answers.email, json, iso(now - 30 * 24 * 3600 * 1000)).first();
  // Their answers again, with another photo (changed after a send whose answer never came): the newest photo is the
  // one shown, until staff have added them (then People has theirs, and it stays). Newer: a higher number in the
  // page's own count of picks on that device (never its clock), else picked later by its clock (a page from before).
  // photo: one this request already put up (it met the stored one while storing its own): used, or taken back off
  const pickedAt = Number(photoAt) || 0;
  const seq = Number(photoSeq) || 0;
  const sha = headshot ? await sha256(headshot.bytes) : null;
  const newerThan = (was) => (seq && was?.seq ? seq > was.seq : !was?.pickedAt || !pickedAt || pickedAt > was.pickedAt);
  const sameAs = (was) => !!was && (was.sha ? was.sha === sha
    : was.bytes === headshot.bytes.length && was.width === headshot.width && was.height === headshot.height);
  async function keepNewest(found, photo = null) {
    let row = found;
    // (another new photo for it saved meanwhile: looked at again, so the newest wins whichever request ends first)
    for (let tries = 0; tries < 4 && row; tries++) {
      const was = parse(row.headshot, null);
      if (!headshot || sameAs(was) || !newerThan(was) || row.status === 'joined' || row.person_slug) {
        if (photo) await forgetImage(env, photo.id, fetchImpl);
        return { app: fromRow(row, { full: true }), repeat: true };
      }
      if (!photo) photo = await storeHeadshot(env, found.id, headshot, { fetchImpl, now, pickedAt, seq });
      // The first photo stays while this application does (the emails already sent show it); one shown in between
      // is shown nowhere now, and goes
      const first = was?.older?.[0] || was?.id || null;
      const swapped = await DB.prepare("UPDATE advisory_applications SET headshot = ?, updated_at = ? WHERE id = ? AND headshot IS ? AND person_slug IS NULL AND status != 'joined'")
        .bind(JSON.stringify({ ...photo, older: first ? [first] : [] }), iso(now), found.id, row.headshot).run();
      if (swapped?.meta?.changes) {
        await untrack(DB, photo.id);
        for (const old of [was?.id, ...(was?.older || []).slice(1)]) if (old && old !== first) await forgetImage(env, old, fetchImpl);
        return { app: fromRow(await DB.prepare('SELECT * FROM advisory_applications WHERE id = ?').bind(found.id).first(), { full: true }), repeat: true, newPhoto: true };
      }
      row = await DB.prepare('SELECT * FROM advisory_applications WHERE id = ?').bind(found.id).first();
    }
    if (photo) await forgetImage(env, photo.id, fetchImpl);
    return { app: fromRow(row || found, { full: true }), repeat: true };
  }
  if (again) return keepNewest(again);
  const before = await sameSend();
  if (before) return { app: fromRow(before, { full: true }), repeat: true };
  const sameKey = `${await sha256(new TextEncoder().encode(`${answers.email}|${json}`))}:${Math.floor(now / (30 * 24 * 3600 * 1000))}`;
  // The same send, or the same answers sent at the same moment: the one stored
  const twinOf = async () => DB.prepare('SELECT * FROM advisory_applications WHERE (send_id IS NOT NULL AND send_id = ?) OR same_key = ?').bind(send, sameKey).first();
  // A new application: the caller's daily limit, taken now (a repeat above never counts), and given back if it isn't stored.
  // At the limit: the same application sent twice at once (a second tab, a retry) may be on its way in from the other
  // request right now, so it's waited for a few seconds, and answered as itself if it comes
  if (reserve && !(await reserve())) {
    for (let waited = 0; waited < 8000; waited += 250) {
      const twin = await twinOf();
      if (twin) return keepNewest(twin);
      await new Promise((r) => setTimeout(r, 250));
    }
    return { limited: true };
  }
  const giveBack = async () => { if (unreserve) await unreserve().catch(() => {}); };
  const id = newId();
  // The picture first: an application is never stored without the headshot it was sent with
  let photo = null;
  try {
    photo = headshot ? await storeHeadshot(env, id, headshot, { fetchImpl, now, pickedAt: Number(photoAt) || 0, seq: Number(photoSeq) || 0 }) : null;
  } catch (e) { await giveBack(); throw e; }
  try {
    await DB.prepare(`INSERT INTO advisory_applications (id, source, name, email, phone, company, job_title, answers, status, ip_hash, headshot, send_id, same_key, created_at, updated_at)
      VALUES (?, 'site', ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?)`)
      .bind(id, answers.fullName, answers.email, answers.phone || null, answers.company || null, answers.jobTitle || null, json, ipHash, photo ? JSON.stringify(photo) : null, send, sameKey, iso(now), iso(now)).run();
  } catch (e) {
    await giveBack();
    // The same send (or the same answers), stored a moment ago by the other request: that one, with whichever photo
    // is newer (this one's, already up, is used or taken back off)
    const twin = /UNIQUE/i.test(String(e?.message || e)) ? await twinOf() : null;
    if (twin) return keepNewest(twin, photo);
    if (photo) await forgetImage(env, photo.id, fetchImpl); // not left behind with nothing pointing to it
    throw e;
  }
  if (photo) await untrack(DB, photo.id).catch(() => {}); // (left written down, the heartbeat sees the application has it)
  return { app: fromRow(await DB.prepare('SELECT * FROM advisory_applications WHERE id = ?').bind(id).first(), { full: true }) };
}

/** The applicant's copy: thanks, what happens next, and everything they sent */
/** Their headshot, small and round, for an email (Cloudflare's own address, as the reveal emails' pictures are) */
function headshotImg(app, px, alt) {
  const id = imageIdOf(app.headshot?.url);
  if (!id) return '';
  const src = `https://imagedelivery.net/${CF_HASH}/${id}/w=${px * 2},h=${px * 2},fit=cover,gravity=face,q=85,metadata=none`;
  return `<img src="${mail.esc(src)}" width="${px}" height="${px}" alt="${mail.esc(alt)}" style="display:block;width:${px}px;height:${px}px;border-radius:50%;border:0;object-fit:cover;">`;
}

export function applicantEmail(app) {
  const first = firstName(app.answers);
  const sections = answerSections(app.answers);
  // The headshot sits in About you, after its last answer, where the form asks for it
  const photo = headshotImg(app, 72, 'Your headshot');
  const photoRow = photo ? `<div style="font-family:${mail.SANS};font-size:13px;color:${mail.MUTED};margin-top:10px;" class="muted">A headshot</div><div style="margin-top:6px;">${photo}</div>` : '';
  const qa = sections.map((s) => `<div style="font-family:${mail.SERIF};font-size:16px;font-weight:700;margin:18px 0 6px;" class="ink">${mail.esc(s.title)}</div>`
    + s.items.map((it) => `<div style="font-family:${mail.SANS};font-size:13px;color:${mail.MUTED};margin-top:10px;" class="muted">${mail.esc(it.label)}</div>`
      + `<div style="font-family:${mail.SANS};font-size:15px;line-height:1.55;white-space:pre-line;" class="ink">${mail.esc(it.value)}</div>`).join('')
    + (s.id === 'you' ? photoRow : '')).join('');
  const html = mail.emailShell({
    preheader: 'We have your application. Here’s a copy of what you sent.',
    eyebrow: 'Advisory Board application',
    heading: first ? `Thank you, ${first}` : 'Thank you for applying',
    intro: 'We have your application to join the Sunshine on a Ranney Day Advisory Board. We review applications on a rolling basis and will be in touch soon. A copy of what you sent is below.',
    bodyHtml: mail.panel(qa) + `<div style="font-family:${mail.SANS};font-size:13px;margin-top:14px;">${mail.link('The Advisory Board overview (PDF)', OVERVIEW_PDF)}</div>`,
    footerHtml: 'Questions? Write to info@soardcharity.com.',
  });
  const text = [`Thank you${first ? `, ${first}` : ''}.`, '', 'We have your application to join the Sunshine on a Ranney Day Advisory Board. We review applications on a rolling basis and will be in touch soon.', '',
    ...sections.flatMap((s) => [`${s.title.toUpperCase()}`, ...s.items.map((it) => `${it.label}\n${it.value}\n`), ...(s.id === 'you' && app.headshot ? ['A headshot\nSent with your application\n'] : [])]),
    `The Advisory Board overview: ${OVERVIEW_PDF}`, 'Questions? Write to info@soardcharity.com.'].join('\n');
  return { subject: 'We have your Advisory Board application', html, text };
}

const yesNoFacts = (a) => [
  ['Four meetings a year', a.meetings],
  ['Makes introductions', a.introductions],
  ['Would host an event', a.hostEvent],
  ['Conflict of interest', a.conflict === 'Yes' ? `Yes${a.conflictMore ? `: ${a.conflictMore}` : ''}` : a.conflict],
];

/** Staff's heads-up: who applied, the key answers, and where to read it all */
export function staffEmail(app) {
  const a = app.answers;
  const work = [a.jobTitle, a.company].filter(Boolean).join(', ');
  const rows = [
    ['Email', a.email ? mail.link(a.email, `mailto:${a.email}`) : null],
    ['Phone', a.phone ? mail.esc(a.phone) : null],
    ['Work', work ? mail.esc(work) : null],
    ['Online', a.link ? mail.link(a.link.replace(/^https?:\/\/(www\.)?/, ''), a.link) : null],
    ['Heard about us', a.heardFrom ? mail.esc(a.heardFrom) : null],
    ...yesNoFacts(a).map(([k, v]) => [k, v ? mail.esc(v) : null]),
    ['Reference', a.refName ? mail.esc([a.refName, a.refRelationship].filter(Boolean).join(', ')) : null],
  ];
  const why = a.why ? `<div style="font-family:${mail.SANS};font-size:13px;color:${mail.MUTED};margin:16px 0 4px;" class="muted">Why they want to serve</div>${mail.paragraphs(a.why)}` : '';
  const photo = headshotImg(app, 88, `${a.fullName}’s headshot`);
  const html = mail.emailShell({
    preheader: `${work || 'A new applicant'}. Read it and reply from the admin.`,
    eyebrow: isTestApplication(a) ? TEST_LABEL : 'New Advisory Board application',
    heading: `${a.fullName} applied to the Advisory Board`,
    intro: 'It came in through the website. They have a copy of what they sent.',
    bodyHtml: mail.panel((photo ? `<div style="margin-bottom:14px;">${photo}</div>` : '') + mail.facts(rows) + why)
      + `<div style="margin-top:16px;">${mail.button('Read the application', adminUrl(app.id), 'primary')}</div>`,
    footerHtml: `This has their contact details, so please keep it inside SOARD. It goes to the list in ${mail.link('People → Applications', adminUrl())}.`,
  });
  const text = `${a.fullName} applied to the Advisory Board.\n\n${[['Email', a.email], ['Phone', a.phone], ['Work', work], ['Heard about us', a.heardFrom], ...yesNoFacts(a)]
    .filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nRead the application: ${adminUrl(app.id)}`;
  return { subject: `${isTestApplication(a) ? '[TEST] ' : ''}New Advisory Board application: ${a.fullName}`, html, text };
}

/** The same heads-up for Slack, without contact details */
export function staffSlack(app) {
  const a = app.answers;
  return slackCard({
    icon: '🤝',
    title: `Advisory Board application: ${a.fullName}`,
    test: isTestApplication(a) ? TEST_LABEL : null,
    lead: [a.jobTitle, a.company].filter(Boolean).join(', ') || null,
    facts: [['Heard about us', a.heardFrom], ...yesNoFacts(a)],
    buttons: [{ label: 'Read the application', url: adminUrl(app.id) }],
    footer: 'From the Apply page on the Advisory Board page',
  });
}

/** Tell the applicant and staff; records what went where. Never throws. */
/**
 * A new application's notices: the applicant's copy, the staff email, the Slack card. Each one that went is recorded
 * (notified: { applicant, staff, slack, at, tries }), and the heartbeat sends again only the ones that didn't
 * (retryNotices): "a copy is on its way" stays true when the email service had a bad minute.
 * prev: what went before (a retry sends only the rest)
 */
export async function notifyNew(env, app, { now = Date.now(), prev = null } = {}) {
  const out = { applicant: !!prev?.applicant, staff: Number(prev?.staff) || 0, slack: !!prev?.slack };
  if (!out.applicant) {
    try {
      const mine = applicantEmail(app);
      // A reply reaches SOARD, not the sending address
      const r = await sendEmails(env, { to: [app.answers.email], ...mine, replyTo: 'info@soardcharity.com', tags: [{ name: 'kind', value: 'advisory-application' }] });
      out.applicant = r.sent > 0;
    } catch { /* recorded below */ }
  }
  if (!out.staff) {
    try {
      // A test's staff email goes to the tester, never the staff list
      const to = isTestApplication(app.answers) ? [app.answers.email] : await staffRecipients(env.DB);
      // Staff answering the heads-up write straight to the applicant
      const r = await sendEmails(env, { to, ...staffEmail(app), replyTo: app.answers.email, tags: [{ name: 'kind', value: 'advisory-application-staff' }] });
      out.staff = r.sent;
    } catch { /* recorded below */ }
  }
  if (!out.slack) {
    try {
      const r = await slackPost(env, staffSlack(app), { kind: 'news' });
      out.slack = !!(r?.ok ?? r);
    } catch { /* recorded below */ }
  }
  try {
    await env.DB.prepare('UPDATE advisory_applications SET notified = ? WHERE id = ?')
      .bind(JSON.stringify({ ...out, at: iso(now), tries: (Number(prev?.tries) || 0) + 1 }), app.id).run();
  } catch (e) { console.error('[advisory] notices not recorded', e?.message); }
  return out;
}

const NOTICE_TRIES = 5;
const NOTICE_DAYS = 3;
/**
 * The heartbeat: an application whose notices didn't all go (the email service or Slack down, or a request cut off
 * before it sent any), sent again: only what didn't go, up to five tries over three days
 */
export async function retryNotices(env, { now = Date.now() } = {}) {
  await ensureAdvisorySchema(env.DB);
  const { results } = await env.DB.prepare(`SELECT * FROM advisory_applications WHERE source = 'site' AND created_at > ? AND (
      (notified IS NULL AND created_at < ?)
      OR (notified IS NOT NULL AND coalesce(json_extract(notified, '$.tries'), 1) < ? AND (
        coalesce(json_extract(notified, '$.applicant'), 0) = 0 OR coalesce(json_extract(notified, '$.staff'), 0) = 0 OR coalesce(json_extract(notified, '$.slack'), 0) = 0)))`)
    .bind(iso(now - NOTICE_DAYS * 86_400_000), iso(now - 10 * 60_000), NOTICE_TRIES).all();
  let sent = 0;
  for (const row of results || []) {
    const out = await notifyNew(env, fromRow(row, { full: true }), { now, prev: parse(row.notified, null) });
    if (out.applicant && out.staff && out.slack) sent++;
  }
  return { tried: (results || []).length, done: sent };
}

// ─── The admin ──────────────────────────────────────────────────────

export async function listAdvisoryApplications(DB) {
  await ensureAdvisorySchema(DB);
  const { results } = await DB.prepare('SELECT * FROM advisory_applications ORDER BY created_at DESC').all();
  return (results || []).map((r) => fromRow(r));
}

export async function getAdvisoryApplication(DB, id) {
  await ensureAdvisorySchema(DB);
  return fromRow(await DB.prepare('SELECT * FROM advisory_applications WHERE id = ?').bind(id).first(), { full: true });
}

export async function countNew(DB) {
  await ensureAdvisorySchema(DB);
  const { results } = await DB.prepare("SELECT name FROM advisory_applications WHERE status = 'new'").all();
  return (results || []).filter((r) => !isTestApplication(r.name)).length; // (the test rule the rest of the admin uses)
}

export async function setAdvisoryStatus(DB, id, status, { by = null, now = Date.now() } = {}) {
  if (!STATUS_IDS.has(status)) throw Object.assign(new Error('Unknown status'), { status: 400 });
  await ensureAdvisorySchema(DB);
  const r = await DB.prepare('UPDATE advisory_applications SET status = ?, status_at = ?, status_by = ?, updated_at = ? WHERE id = ?').bind(status, iso(now), by, iso(now), id).run();
  if (!r?.meta?.changes) throw Object.assign(new Error('This application isn’t here any more: it was deleted, maybe in another tab.'), { status: 404 });
  return getAdvisoryApplication(DB, id);
}

export const NOTE_MAX = 4000;
export async function addAdvisoryNote(DB, id, text, { by = null, now = Date.now() } = {}) {
  const t = String(text || '').trim();
  if (!t) throw Object.assign(new Error('Write the note first'), { status: 400 });
  // (never cut mid-word without a word said: too long is said, and the note stays in its box)
  if (t.length > NOTE_MAX) throw Object.assign(new Error(`That note is ${t.length.toLocaleString('en-US')} characters. Notes take up to ${NOTE_MAX.toLocaleString('en-US')}: shorten it, or split it in two.`), { status: 400 });
  const app = await getAdvisoryApplication(DB, id);
  if (!app) throw Object.assign(new Error('This application isn’t here any more: it was deleted, maybe in another tab.'), { status: 404 });
  const notes = [...app.notes, { at: iso(now), by, text: t }];
  await DB.prepare('UPDATE advisory_applications SET notes = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(notes), iso(now), id).run();
  return getAdvisoryApplication(DB, id);
}

/** They're on People → Advisory now (Add to Advisory Board, or linked by hand): Joined */
export async function linkAdvisor(DB, id, slug, { by = null, now = Date.now() } = {}) {
  // (any address People takes: ./_content-history.js SLUG_RE)
  if (!SLUG_RE.test(String(slug || ''))) throw Object.assign(new Error('That isn’t an address on People.'), { status: 400 });
  await ensureAdvisorySchema(DB);
  const r = await DB.prepare("UPDATE advisory_applications SET person_slug = ?, status = 'joined', status_at = ?, status_by = ?, updated_at = ? WHERE id = ?")
    .bind(slug, iso(now), by, iso(now), id).run();
  if (!r?.meta?.changes) throw Object.assign(new Error('This application isn’t here any more: it was deleted, maybe in another tab.'), { status: 404 });
  return getAdvisoryApplication(DB, id);
}

/**
 * Is this picture someone's photo on People (Add to Advisory Board made it theirs)? A People table that isn't
 * there has nobody on it; a read that fails says so (thrown), so nothing is deleted on a guess either way
 */
async function photoOnPeople(DB, imageId) {
  let rows;
  try {
    // (instr, not LIKE: D1 refuses a LIKE pattern over 50 bytes, and a headshot's id is longer)
    rows = (await DB.prepare('SELECT data FROM team WHERE instr(data, ?) > 0').bind(imageId).all()).results || [];
  } catch (e) {
    if (/no such table/i.test(e?.message || '')) return false;
    throw Object.assign(new Error('The site couldn’t check People just now, so nothing was deleted. Please try again in a moment.'), { status: 503 });
  }
  if (rows.some((r) => imageIdOf(parse(r.data, {})?.photo) === imageId)) return true;
  // A version History keeps (Recently deleted, or an earlier one that can be put back): its photo stays too
  try {
    const kept = (await DB.prepare("SELECT data FROM content_versions WHERE collection = 'team' AND instr(data, ?) > 0").bind(imageId).all()).results || [];
    return kept.some((r) => imageIdOf(parse(r.data, {})?.photo) === imageId);
  } catch (e) {
    if (/no such table/i.test(e?.message || '')) return false;
    throw Object.assign(new Error('The site couldn’t check People’s history just now, so nothing was deleted. Please try again in a moment.'), { status: 503 });
  }
}

/**
 * Their data leaves the site (a person asked, or it was a test), the headshot with it unless it's someone's
 * People photo now. A headshot Cloudflare didn't let go of keeps the application, so pressing Delete again works.
 */
export async function deleteAdvisoryApplication(env, id, { fetchImpl = fetch } = {}) {
  const { DB } = env;
  await ensureAdvisorySchema(DB);
  const row = await DB.prepare('SELECT headshot, source, source_id FROM advisory_applications WHERE id = ?').bind(id).first();
  if (!row) return false;
  const hs = parse(row.headshot, null);
  for (const pic of [hs?.id, ...(hs?.older || [])].filter(Boolean)) {
    if (await photoOnPeople(DB, pic)) continue;
    const gone = await deleteImage(env, pic, fetchImpl).catch(() => false);
    // (500, never 502: Cloudflare puts its own error page over a Function's 502, and these words would be lost)
    if (!gone) throw Object.assign(new Error('Its headshot didn’t delete just now, so the application is still here. Please try again in a moment.'), { status: 500 });
  }
  // One sent to the old form: its copy kept from Jotform goes too (else it would come back in on the next visit),
  // with any files of theirs that copy kept
  if (row.source === 'jotform' && row.source_id) await forgetJotformCopy(env, row.source_id);
  const r = await DB.prepare('DELETE FROM advisory_applications WHERE id = ?').bind(id).run();
  return !!r?.meta?.changes;
}

/**
 * The Jotform backfill's copy of an Advisory Board application: its answers and its files gone, so it never comes
 * back in on the next visit. Anything that doesn't go (D1 or the bucket busy) stops the delete, in words, before the
 * application itself goes: pressing Delete again finishes it. No backfill table at all: there is no copy.
 */
const FORGET_FAILED = 'Its copy from the old form didn’t delete just now, so the application is still here. Please try again in a moment.';
async function forgetJotformCopy(env, submissionId) {
  const { DB } = env;
  let row;
  try {
    row = await DB.prepare("SELECT saved FROM jotform_backfill WHERE submission_id = ? AND kind = 'advisory'").bind(submissionId).first();
  } catch (e) {
    if (/no such table/i.test(e?.message || '')) return;
    throw Object.assign(new Error(FORGET_FAILED), { status: 500 });
  }
  if (!row) return;
  const saved = parse(row.saved, []);
  const keys = (Array.isArray(saved) ? saved : []).map((f) => f?.key).filter(Boolean);
  const files = env.APPLICANT_FILES || env.FILES || null;
  if (keys.length && !files) throw Object.assign(new Error(FORGET_FAILED), { status: 500 });
  try {
    for (const key of keys) await files.delete(key);
    await DB.prepare("UPDATE jotform_backfill SET answers = NULL, saved = NULL WHERE submission_id = ? AND kind = 'advisory'").bind(submissionId).run();
  } catch {
    throw Object.assign(new Error(FORGET_FAILED), { status: 500 });
  }
}

// ─── The Jotform applications, brought in once ──────────────────────

/** A Jotform answer as plain words */
function jotformValue(q) {
  const a = q?.answer;
  if (a == null || a === '') return '';
  if (q.type === 'control_fullname' && typeof a === 'object') return [a.prefix, a.first, a.middle, a.last, a.suffix].filter(Boolean).join(' ');
  if (q.type === 'control_phone' && typeof a === 'object') return a.full || [a.area, a.phone].filter(Boolean).join(' ');
  if (q.type === 'control_address' && typeof a === 'object') return [a.addr_line1, a.addr_line2, [a.city, a.state].filter(Boolean).join(', '), a.postal].filter(Boolean).join('\n');
  if ((q.type === 'control_datetime' || q.type === 'control_birthdate') && typeof a === 'object') {
    return a.year && a.month && a.day ? `${a.year}-${String(a.month).padStart(2, '0')}-${String(a.day).padStart(2, '0')}` : (q.prettyFormat || '');
  }
  if (q.type === 'control_signature') return 'Signed on Jotform';
  if (Array.isArray(a)) return a.filter(Boolean).join(', ');
  if (typeof a === 'object') return q.prettyFormat ? String(q.prettyFormat).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim() : Object.values(a).filter(Boolean).join(' ');
  return String(a).trim();
}

/** A Jotform submission's answers in this form's ids (what doesn't map is kept under its question) */
export function fromJotform(answers) {
  const out = {};
  const extra = [];
  for (const q of Object.values(answers || {})) {
    const text = String(q?.text || '').replace(/<[^>]+>/g, '').trim();
    const value = jotformValue(q);
    if (!text || !value || /^(control_head|control_text|control_button|control_pagebreak|control_image)$/.test(q.type || '')) continue;
    const hit = JOTFORM_FIELDS.find(([re]) => re.test(text));
    if (!hit) { extra.push(`${text}\n${value}`); continue; }
    const [, id] = hit;
    const field = ADVISORY_FIELDS.find((f) => f.id === id);
    if (field?.type === 'check') out[id] = !!value;
    else if (field?.type === 'choice') out[id] = field.options.find((o) => o.toLowerCase() === value.toLowerCase()) || value;
    else out[id] = value;
  }
  if (extra.length) out.anythingElse = [out.anythingElse, ...extra].filter(Boolean).join('\n\n');
  return out;
}

/**
 * The Advisory Board applications the Jotform backfill copied, here once each.
 * Someone already on People → Advisory (by name) is Joined and linked.
 * Returns how many came in. Safe to call on every visit to the admin.
 */
export async function importJotformApplications(DB, { now = Date.now() } = {}) {
  await ensureAdvisorySchema(DB);
  let rows;
  try {
    ({ results: rows } = await DB.prepare(`SELECT b.submission_id, b.answers, b.submitted_at FROM jotform_backfill b
      WHERE b.kind = 'advisory' AND b.answers IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM advisory_applications a WHERE a.source = 'jotform' AND a.source_id = b.submission_id)`).all());
  } catch { return 0; } // no backfill table
  if (!rows?.length) return 0;
  // Who's on the Advisory Board now (active), with their private email: an old application is theirs only by that
  // email. A name alone (another address) is never taken as them here: Add to Advisory Board asks whether it's the same
  let advisors = [];
  try {
    const { results } = await DB.prepare('SELECT slug, data FROM team').all();
    advisors = (results || []).map((r) => ({ slug: r.slug, data: parse(r.data, {}) })).filter((t) => t.data.group === 'advisory' && personStatus(t.data) === 'active');
  } catch { /* no team table (tests) */ }
  let emailOf = {};
  try { emailOf = Object.fromEntries(((await DB.prepare('SELECT slug, email FROM reveal_board_emails').all()).results || []).map((r) => [r.slug, String(r.email || '').toLowerCase()])); } catch { /* none saved yet */ }
  const stmts = [];
  for (const r of rows) {
    const saved = parse(r.answers, {});
    const answers = fromJotform(saved.answers);
    if (!answers.fullName) continue;
    const email = String(answers.email || '').trim().toLowerCase();
    const byEmail = email ? advisors.filter((t) => emailOf[t.slug] === email) : [];
    const person = byEmail.length === 1 ? byEmail[0].slug : null;
    const created = saved.createdAt || r.submitted_at;
    const at = created ? new Date(`${String(created).replace(' ', 'T')}${/[zZ]|[+-]\d\d:?\d\d$/.test(created) ? '' : 'Z'}`) : new Date(now);
    const when = Number.isNaN(at.getTime()) ? iso(now) : at.toISOString();
    stmts.push(DB.prepare(`INSERT OR IGNORE INTO advisory_applications (id, source, source_id, name, email, phone, company, job_title, answers, status, status_at, status_by, person_slug, created_at, updated_at)
      VALUES (?, 'jotform', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(newId(), r.submission_id, answers.fullName, answers.email || null, answers.phone || null, answers.company || null, answers.jobTitle || null, JSON.stringify(answers),
        person ? 'joined' : 'new', person ? iso(now) : null, person ? 'the site (their email is already on People → Advisory)' : null, person, when, iso(now)));
  }
  if (stmts.length) await DB.batch(stmts);
  return stmts.length;
}

/** For Site → Automations: how many, how many New, and the last one (counts and times only) */
export async function advisoryFacts(DB) {
  await ensureAdvisorySchema(DB);
  const fresh = await countNew(DB);
  const row = await DB.prepare(`SELECT count(*) AS total,
      sum(CASE WHEN source = 'jotform' THEN 1 ELSE 0 END) AS jotform,
      max(CASE WHEN source = 'site' THEN created_at END) AS last_at
    FROM advisory_applications`).first();
  const last = await DB.prepare("SELECT notified FROM advisory_applications WHERE source = 'site' ORDER BY created_at DESC LIMIT 1").first('notified');
  const n = parse(last, null);
  return { total: row?.total || 0, new: fresh, fromJotform: row?.jotform || 0, lastAt: row?.last_at || null, lastNotified: n ? { applicant: !!n.applicant, staff: n.staff || 0, slack: !!n.slack } : null };
}
