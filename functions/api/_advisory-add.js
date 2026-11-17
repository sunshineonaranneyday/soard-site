/**
 * Add to Advisory Board (Admin → People → Applications), on the server, in one go
 * ===========================================================================
 * Peter, Nov 16 2026: Add to Advisory Board gives them everything at once (the
 * Advisory Board page, reveal invites, advisory@, and with the Advisory Board's
 * emails on, the email that says how to sign in), with their headshot as their
 * photo. It used to be several steps in the browser; one failing halfway left a
 * person half added that a second press couldn't finish, and the server took
 * any person it was told. Now:
 *
 *   addPlan(env, id)           what Add would do, for the confirm box to say before anything happens
 *   addToBoard(env, ctx, { id, as, by })   does it: as 'new' (a new People record) or 'same' (the one the plan found)
 *
 * Who they are is decided by their email first (each person signs in with their
 * own), then by their name:
 *   - their email is already someone's on People → Advisory: that's them ('same')
 *   - it's someone's elsewhere on People (the board, the team): nobody is added ('blocked'), the box says why
 *   - no email match, but someone on People → Advisory has their name (whatever their address on People
 *     is, "jordan-lee" or "jlee-2"): staff say which ('choose': the same person, or a different one, who
 *     gets their own address)
 *   - else a new record ('new'), at an address made from their name (one already used, or a
 *     former board member's, gets -2, -3, …; a name with no letters a to z gets "advisory-board-member")
 *
 * The same person: their sign-in email is never changed (one they have stays; none on file, this
 * application's is saved), their photo stays (none, the headshot becomes it), and a former member
 * (alumni) is made active again and hidden from the public site until staff show them (as anyone added
 * is). Everything else on their record stays as it is. Someone In memoriam is never added to.
 * An email the sign-in can't use (an old application's) is never saved: they're added, and the box says so.
 *
 * In order, each step safe to run again: the People record (through the admin's own save,
 * ./save-content.js: History, the GitHub copy, the checks), the application pointed at it, their
 * private email (./_reveal-invites.js setBoardEmail, as People → Advisory saves it), Joined, then the
 * welcome (./_advisory-mail.js welcomeOnJoin). A press after a failure picks up where it stopped:
 * before a new record is made, the address it's made at is written down for the application
 * (advisory_add_intents), so the next press finds that record, whichever way it was asked, and never
 * makes a second. Two presses at once (two tabs, two staff) can't both add: the application and the
 * email are held while one does. A new person never gets an address an application or a welcome
 * already points at (someone deleted from People), so nothing of theirs is mixed up with someone else's.
 */

import { getAdvisoryApplication, linkAdvisor, ensureAdvisorySchema, STATUSES } from './_advisory-applications.js';
import { onRequestPost as saveContent } from './save-content.js';
import { setBoardEmail, refreshForBoardChange, isEmail, normEmail } from './_reveal-invites.js';
import { welcomeOnJoin, welcomeRecords, hasOrGoing, mailSlugs } from './_advisory-mail.js';
import { logAudit } from './_audit.js';
import { generateSha } from './_collections.js';
import { slugOf, ADVISORY_TITLE, normalizeLinkedIn, photoUrl } from '../../public/admin/team-shared.js';
import { personStatus, personName } from './_team.js';
import { isGroupInbox, isStaffEmail } from './_board-roles.js';
import { TITLE, greetName } from './_advisory-form.js';
import { getSettings as advisorySettings } from './_advisory.js';
import { queueWelcome } from './_advisory-mail.js';

const parse = (s, d = null) => { try { return s == null ? d : JSON.parse(s); } catch { return d; } };
// (normEmail: lower case, and one person's other address as the one they sign in with, as setBoardEmail saves it)
const GROUPS = { advisory: 'People → Advisory', board: 'People → Board', team: 'People → Team' };
const FALLBACK_SLUG = 'advisory-board-member';
// The tables a former board member's records are kept under: their address is never someone else's (./save-content.js)
const FORMER_BOARD_TABLES = ['board_signatures', 'board_signins', 'board_activity', 'board_sign_events'];
const err = (message, status = 409) => Object.assign(new Error(message), { status });

/** People and their private emails. A read that fails stops the plan (never "nobody's on People"); no table yet is nobody */
async function peopleAndEmails(DB) {
  const all = async (sql) => {
    try { return (await DB.prepare(sql).all()).results || []; } catch (e) {
      if (/no such table/i.test(e?.message || '')) return [];
      throw e;
    }
  };
  const rows = await all('SELECT slug, data FROM team');
  const emails = Object.fromEntries((await all('SELECT slug, email FROM reveal_board_emails')).map((r) => [r.slug, normEmail(r.email)]));
  const people = rows.map((r) => ({ slug: r.slug, ...(parse(r.data, {}) || {}) }));
  return { people, emails };
}

/**
 * Someone on People, as the confirm box shows them (welcomed: they've had "Your Advisory Board page is ready", or it's
 * on its way, at the address they'll sign in with once added: the one on file, else this application's)
 */
const card = (p, emails, welcomedAt = () => false) => ({
  slug: p.slug, name: personName(p) || p.slug, group: p.group || 'team', where: GROUPS[p.group] || 'People',
  status: personStatus(p), hidden: p.publishStatus === 'draft', organization: p.organization || '',
  email: emails[p.slug] || '', hasPhoto: !!p.photo, photo: p.photo ? photoUrl(p, 96) : '', welcomed: !!welcomedAt(p),
});
/**
 * A name as people would match it: no accents, no case, one space, no title, middle initial or "Jr", no "In memoriam"
 * ("Dr. José  A. Núñez" is "jose nunez"). A first initial stays ("J. Ames" is "j ames"), and every alphabet counts
 * ("王小明", "Владимир Петров"), as letters, never dropped as not a-z.
 */
const wordOf = (w) => w.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const nameWords = (n) => {
  const words = String(personName({ name: n }) || '').split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < words.length - 1 && TITLE.test(words[i])) i++;
  return words.slice(i).map(wordOf).filter((w, k) => w && (k === 0 || !/^[a-z]$/.test(w)) && !/^(jr|sr|ii|iii|iv)$/.test(w));
};
const nameKey = (n) => nameWords(n).join(' ');
/**
 * Could these be one person? The same name as above, or the same last name with first names that start alike
 * ("Katie" and "Katherine", "Jo" and "Jordan"). Only ever asked about ("Is this the same?"), never taken as them.
 */
function mightBe(a, b) {
  const x = nameWords(a);
  const y = nameWords(b);
  if (!x.length || !y.length) return false;
  if (x.join(' ') === y.join(' ')) return true;
  if (x.length < 2 || y.length < 2 || x[x.length - 1] !== y[y.length - 1]) return false;
  const [f, g] = [x[0], y[0]];
  // (a first initial: "J. Ames" might be Jordan Ames)
  if (f.length === 1 || g.length === 1) return f[0] === g[0];
  return f.slice(0, 3) === g.slice(0, 3) || (Math.min(f.length, g.length) >= 2 && (f.startsWith(g) || g.startsWith(f)));
}

// An address made from a name is at most this long (a word is never cut in half; People takes up to 121)
const SLUG_MAX = 60;
const shortSlug = (slug) => {
  if (slug.length <= SLUG_MAX) return slug;
  const cut = slug.slice(0, SLUG_MAX + 1);
  return (cut.lastIndexOf('-') > 10 ? cut.slice(0, cut.lastIndexOf('-')) : slug.slice(0, SLUG_MAX)).replace(/-+$/, '');
};

/** The address written down for an application before its new record is made (see the top) */
const INTENTS = 'CREATE TABLE IF NOT EXISTS advisory_add_intents (app_id TEXT PRIMARY KEY, slug TEXT NOT NULL, at INTEGER NOT NULL)';
async function intentOf(DB, appId) {
  await DB.prepare(INTENTS).run();
  return (await DB.prepare('SELECT slug FROM advisory_add_intents WHERE app_id = ?').bind(appId).first())?.slug || null;
}

/**
 * Addresses that mean someone already: on People, a former board member's records, an application pointed at
 * (or about to be), a welcome had or waiting. A read that fails stops the plan, never a guess that it's free.
 */
async function usedSlugs(DB, appId) {
  await DB.prepare(INTENTS).run();
  const rows = async (sql, ...binds) => ((await DB.prepare(sql).bind(...binds).all()).results || []).map((r) => r.slug);
  return new Set([
    ...(await rows('SELECT person_slug AS slug FROM advisory_applications WHERE person_slug IS NOT NULL')),
    // (another application's; this one's own, with no record made at it, is theirs to use)
    ...(await rows('SELECT slug FROM advisory_add_intents WHERE app_id != ?', appId)),
    ...(await mailSlugs(DB)),
    // (an address History still keeps a record under: someone deleted can be put back, so it stays theirs)
    ...(await rows("SELECT DISTINCT slug FROM content_versions WHERE collection = 'team'").catch((e) => { if (/no such table/i.test(e?.message || '')) return []; throw e; })),
  ]);
}

/** An address for a new person from their name: free on People, never a former board member's, never one in use above */
async function freeSlug(DB, name, people, appId) {
  const base = shortSlug(slugOf(name) || FALLBACK_SLUG);
  const taken = new Set([...people.map((p) => p.slug), ...(await usedSlugs(DB, appId))]);
  for (let n = 1; n < 100; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    if (taken.has(slug)) continue;
    let former = false;
    for (const t of FORMER_BOARD_TABLES) {
      let had = null;
      try { had = await DB.prepare(`SELECT slug FROM ${t} WHERE slug = ? LIMIT 1`).bind(slug).first(); } catch (e) {
        if (!/no such table/i.test(e?.message || '')) throw e;
      }
      if (had) { former = true; break; }
    }
    if (!former) return slug;
  }
  throw err('Couldn’t find a free address for them on People. Add them by hand on People → Advisory.', 500);
}

/**
 * What Add to Advisory Board would do → { kind, application, person?, slug?, namesake? }
 *   kind 'joined'   already done (the application points at them and is Joined)
 *        'same'     they're the person found (by their email, or the application already points at them)
 *        'choose'   someone on People → Advisory has their name, with another email or none: staff say
 *        'new'      a new record at `slug` (namesake: someone elsewhere on People with their name)
 *        'blocked'  their email is someone's elsewhere on People: nobody is added
 */
export async function addPlan(env, id, { now = Date.now() } = {}) {
  const plan = await planOf(env, id, now);
  // What the box shows, as one key: a press with any other (a box opened before something changed) is refused. The
  // application's own part first (marked Not now in another tab since, say), then who it matches on People
  const p = plan.person || {};
  const app = plan.application || {};
  plan.key = `${[app.status || '', app.statusAt || ''].join('|')}#${[plan.kind, plan.why || '', p.slug || '', p.status || '', p.email || '', p.hasPhoto ? 1 : 0, p.welcomed ? 1 : 0,
    plan.slug || '', plan.emailUsable ? 1 : 0, plan.emailWhy || '', plan.namesake?.slug || '', plan.namesake?.status || '',
    plan.emailsOn ? 1 : 0, app.headshot?.url || ''].join('|')}`;
  return plan;
}

/**
 * Whether a press is adding them right now (this application, their email, or the address a new record would take):
 * the box says so and waits, never showing what's true halfway through someone else's press
 */
export async function addBusy(DB, plan, now = Date.now()) {
  const app = plan.application || {};
  const keys = [`app:${app.id}`, ...(app.email ? [`email:${normEmail(app.email)}`] : []), ...(plan.slug ? [`slug:${plan.slug}`] : [])];
  await DB.prepare('CREATE TABLE IF NOT EXISTS advisory_add_holds (key TEXT PRIMARY KEY, at INTEGER NOT NULL)').run();
  const row = await DB.prepare(`SELECT key FROM advisory_add_holds WHERE at >= ? AND key IN (${keys.map(() => '?').join(', ')}) LIMIT 1`).bind(now - HOLD_MS, ...keys).first();
  return !!row;
}

async function planOf(env, id, now = Date.now()) {
  const { DB } = env;
  await ensureAdvisorySchema(DB);
  const app = await getAdvisoryApplication(DB, id);
  if (!app) throw err('That application isn’t here any more', 404);
  const [{ people, emails }, welcomes, intent, settings] = await Promise.all([peopleAndEmails(DB), welcomeRecords(DB), intentOf(DB, app.id), advisorySettings(DB)]);
  const email = normEmail(app.email);
  // An email the sign-in can't use (one an old application came with), or SOARD's own group inbox (everyone in the
  // group would read their sign-in codes), is never saved as theirs
  const groupInbox = !!email && isGroupInbox(email);
  // (a soardcharity.com address signs in as staff, never as an Advisory Board member: it can't be theirs either)
  const staffAddress = !!email && !groupInbox && isStaffEmail(email);
  const emailUsable = !email || (isEmail(email) && !groupInbox && !staffAddress);
  // (had their welcome, or it's going now, at the address Add leaves them with: theirs on file, else this one)
  const show = (p) => card(p, emails, (x) => hasOrGoing(welcomes[x.slug], now, emails[x.slug] || (emailUsable ? email : '')));
  // (emailsOn: the Advisory Board's emails switch as it is now; emailAs: the address it signs in as, when that's
  // another of theirs, as peter@ranneyblair.com is peter@soardcharity.com)
  const typed = String(app.email || '').trim().toLowerCase();
  const base = { application: app, emailUsable, emailsOn: !!settings?.emails, ...(email && typed && email !== typed ? { emailAs: email } : {}),
    ...(groupInbox ? { emailWhy: 'group' } : staffAddress ? { emailWhy: 'staff' } : {}) };
  const by = (slug) => people.find((p) => p.slug === slug);
  const memorial = (p) => personStatus(p) === 'memorial';
  // Already pointed at someone (Joined, or a press that stopped partway), or the record a press that stopped
  // partway made for them: that person
  let pointed = app.personSlug ? by(app.personSlug) : null;
  if (!pointed && intent) {
    // (the record that press made: their name, on People → Advisory, with no one else's email on it)
    const made = by(intent);
    if (made && made.group === 'advisory' && nameKey(made.name) === nameKey(app.name) && (!emails[made.slug] || emails[made.slug] === email)) pointed = made;
  }
  if (pointed && pointed.group === 'advisory') {
    if (memorial(pointed)) return { kind: 'blocked', why: 'memorial', ...base, person: show(pointed) };
    const onBoard = personStatus(pointed) === 'active';
    const done = app.status === 'joined' && onBoard && (!email || !emailUsable || !!emails[pointed.slug]);
    return { kind: done ? 'joined' : 'same', why: 'linked', ...base, person: show(pointed) };
  }
  // Their email: each person signs in with their own (a group inbox is nobody's own)
  // (a SOARD address someone on People has is theirs too: blocked, or the same person)
  const owner = email && !groupInbox ? people.find((p) => emails[p.slug] === email) : null;
  if (owner) {
    if (owner.group === 'advisory') return memorial(owner) ? { kind: 'blocked', why: 'memorial', ...base, person: show(owner) } : { kind: 'same', why: 'email', ...base, person: show(owner) };
    return { kind: 'blocked', why: 'email', ...base, person: show(owner) };
  }
  // Their name: on People → Advisory under any address (an active member before a former one; never someone In
  // memoriam), else elsewhere on People
  const key = nameKey(app.name);
  const same = people.filter((p) => key && (p.slug === slugOf(app.name) || mightBe(p.name, app.name)));
  const exact = (p) => (nameKey(p.name) === key ? 0 : 1);
  const named = same.filter((p) => p.group === 'advisory' && !memorial(p))
    .sort((a, b) => exact(a) - exact(b) || (personStatus(a) === 'active' ? 0 : 1) - (personStatus(b) === 'active' ? 0 : 1))[0]
    || same.find((p) => p.slug === slugOf(app.name)) || same.sort((a, b) => exact(a) - exact(b))[0] || null;
  const slug = await freeSlug(DB, app.name, people, app.id);
  if (named && named.group === 'advisory' && !memorial(named)) return { kind: 'choose', why: 'name', ...base, person: show(named), slug };
  return { kind: 'new', ...base, slug, ...(named ? { namesake: show(named) } : {}) };
}

/** The admin's own save (./save-content.js), as staff pressing Save would: its checks, History and GitHub copy */
async function save(ctx, path, record, message, { create = false, sha = null } = {}) {
  const request = new Request('https://admin.internal/api/save-content', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content: JSON.stringify(record, null, 2), message, ...(sha ? { sha } : {}), ...(create ? { create: true } : {}) }),
  });
  const res = await saveContent({ env: ctx.env, request, data: ctx.data || {}, waitUntil: ctx.waitUntil || ((p) => p) });
  const j = await res.json().catch(() => ({}));
  // (refused for a reason staff can act on: its words; the save itself failing (D1): addToBoard says it in words)
  if (!res.ok || !j.success) {
    if (res.status >= 500) throw new Error(j.error || `save-content ${res.status}`);
    if (res.status === 409) throw err('Their People record changed a moment ago (someone else saved it, or another press). Look at the box again, then press.');
    throw err(j.error || 'Their People record didn’t save.', 400);
  }
  return j;
}

/** A People record as the admin's People editor saves one (index.html toPersonRecord) */
function personRecord(d) {
  const r = { ...d };
  for (const k of ['draft', 'role', 'seat', 'committees']) delete r[k];
  r.name = String(r.name || '').trim();
  r.title = String(r.title || '').trim();
  r.organization = String(r.organization || '').trim();
  r.order = Number(r.order) || 0;
  r.status = ['active', 'alumni', 'memorial'].includes(r.status) ? r.status : 'active';
  r.publishStatus = r.publishStatus === 'draft' ? 'draft' : 'published';
  for (const k of ['since', 'until']) {
    const n = Number(r[k]);
    if (r[k] === '' || r[k] == null || !Number.isInteger(n) || n < 1900 || n > 2200) delete r[k]; else r[k] = n;
  }
  if (r.status === 'active') delete r.until;
  for (const k of ['partner', 'linkedin']) if (!r[k]) delete r[k];
  if (!r.photo) { delete r.photoCrop; delete r.photoSize; delete r.photoCutout; }
  if (!r.photoCrop) delete r.photoCrop;
  if (!Array.isArray(r.photoSize)) delete r.photoSize;
  if (!r.photoCutout) delete r.photoCutout;
  return r;
}
const photoOf = (hs) => (hs?.url ? { photo: hs.url, ...(hs.width && hs.height ? { photoSize: [hs.width, hs.height] } : {}) } : {});

/**
 * Add them. as: 'new' (a new People record; plans 'new' and 'choose') or 'same' (the person the plan found;
 * plans 'same' and 'choose'). → { application, person: { slug, name, made, photoAdded, restored, email, emailKept }, welcome }
 * Throws { status } with words for staff when it can't (blocked, changed since the box opened, a save refused).
 */
const HOLD_MS = 2 * 60 * 1000; // a hold older than this is from a press that never finished (its request died)
/** Hold the application and their email while one press adds them: a second press at once is told, never adds twice */
async function hold(DB, keys, now) {
  await DB.prepare('CREATE TABLE IF NOT EXISTS advisory_add_holds (key TEXT PRIMARY KEY, at INTEGER NOT NULL)').run();
  const got = [];
  try {
    for (const key of keys) {
      await DB.prepare('DELETE FROM advisory_add_holds WHERE key = ? AND at < ?').bind(key, now - HOLD_MS).run();
      const r = await DB.prepare('INSERT OR IGNORE INTO advisory_add_holds (key, at) VALUES (?, ?)').bind(key, now).run();
      if (!r?.meta?.changes) { await release(DB, got); return null; }
      got.push(key);
    }
  } catch (e) {
    await release(DB, got); // (failing partway: what it had taken is let go, never left blocking presses for minutes)
    throw e;
  }
  return got;
}
const release = async (DB, keys) => { for (const key of keys || []) await DB.prepare('DELETE FROM advisory_add_holds WHERE key = ?').bind(key).run().catch(() => {}); };

export async function addToBoard(env, ctx, { id, as, seen = null, by = '', now = Date.now(), fetchImpl = fetch } = {}) {
  const { DB } = env;
  let keys = null;
  try {
    const first = await getAdvisoryApplication(DB, id);
    if (!first) throw err('That application isn’t here any more', 404);
    keys = await hold(DB, [`app:${id}`, ...(first.email ? [`email:${normEmail(first.email)}`] : [])], now);
    if (!keys) throw err('Someone is adding them right now. Give it a moment, then look again.');
    return await addHeld(env, ctx, { id, as, seen, by, now, fetchImpl });
  } catch (e) {
    if (e?.status) throw e;
    // D1 or a save that didn't answer: words for staff (never "D1_ERROR: …"), and the next press finishes it
    console.error('[advisory-add]', e?.message || e);
    throw err('Adding them stopped partway: the site’s database didn’t answer just now. Press Add to Advisory Board again in a moment: it finishes what’s left, and never adds them twice.', 503);
  } finally {
    await release(DB, keys);
  }
}

async function addHeld(env, ctx, { id, as, seen, by, now, fetchImpl }) {
  const { DB } = env;
  const plan = await addPlan(env, id);
  const app = plan.application;
  // The box pressed must say what's true now, all of it (a namesake added since, the person moved to alumni, their
  // email changed, another tab added them): if not, nothing is done and the box is asked again
  if (seen !== plan.key) {
    // (the application itself changed: said as what it is now, and who did it)
    const [was] = String(seen || '').split('#');
    if (was !== plan.key.split('#')[0] && app.status !== 'joined') {
      const label = STATUSES.find((s) => s.id === app.status)?.label || app.status;
      throw err(`This application was marked ${label}${app.statusBy ? ` by ${app.statusBy}` : ''} since the box opened. Look at the box again before pressing.`);
    }
    throw err('Who this matches on People changed since the box opened. Look at the box again before pressing.');
  }
  if (plan.kind === 'blocked' && plan.why === 'memorial') {
    throw err(`${plan.person.name} is In memoriam on People → Advisory, so nobody was added. If this is someone else, add them by hand on People → Advisory.`);
  }
  if (plan.kind === 'blocked') {
    throw err(`${app.email} is ${plan.person.name}’s email on ${plan.person.where}. Each person signs in with their own, and nobody was added. If ${plan.person.name} is moving to the Advisory Board, change their group on their People page first.`);
  }
  if (plan.kind === 'joined') {
    const welcome = await welcomeOnJoin(env, plan.person.slug, { by, now, fetchImpl, greet: greetName(app.answers || {}) })
      .catch((e) => { console.error('[advisory-add] welcome', e?.message || e); return { waiting: true, why: 'send' }; });
    return { application: app, person: { slug: plan.person.slug, name: plan.person.name, made: false }, welcome };
  }
  // (a press after one that stopped partway goes on with its person, whichever button)
  const wantNew = plan.why === 'linked' ? false : as === 'new';
  if (wantNew ? !['new', 'choose'].includes(plan.kind) : !['same', 'choose'].includes(plan.kind)) {
    throw err('Who this matches on People changed since the box opened. Close it and press Add to Advisory Board again.');
  }
  const ctxSave = { env, data: { ...(ctx?.data || {}), userEmail: by || ctx?.data?.userEmail || 'unknown' }, waitUntil: ctx?.waitUntil };
  const email = normEmail(app.email);
  const out = { slug: '', name: '', made: false, photoAdded: false, restored: false, email: '', emailKept: false, emailUnusable: plan.emailUsable ? '' : String(app.email || '').trim().toLowerCase(), ...(plan.emailAs ? { emailAs: plan.emailAs } : {}), ...(plan.emailWhy ? { emailWhy: plan.emailWhy } : {}) };

  if (wantNew) {
    const { people } = await peopleAndEmails(DB);
    const order = people.filter((p) => p.group === 'advisory').reduce((m, p) => Math.max(m, Number(p.order) || 0), -1) + 1;
    const linkedin = normalizeLinkedIn(app.link || '');
    const record = personRecord({
      name: app.name, slug: plan.slug, title: ADVISORY_TITLE, organization: app.company || '', group: 'advisory', order, status: 'active',
      publishStatus: 'draft', since: new Date(now).getFullYear(), ...(linkedin ? { linkedin } : {}), ...photoOf(app.headshot),
    });
    // The address held while this press makes the record there (two different people with one name, pressed at
    // once: one gets it, the other is asked again), and checked free inside the hold
    const slugHold = await hold(DB, [`slug:${plan.slug}`], now);
    if (!slugHold) throw err('Someone is adding a person with this name right now. Give it a moment, then look at the box again.');
    try {
      if (await DB.prepare('SELECT slug FROM team WHERE slug = ?').bind(plan.slug).first()) {
        throw err('Who this matches on People changed since the box opened. Look at the box again before pressing.');
      }
      // Written down first: a press after a failure from here on finds this record (see the top)
      await DB.prepare(INTENTS).run();
      await DB.prepare('INSERT OR REPLACE INTO advisory_add_intents (app_id, slug, at) VALUES (?, ?, ?)').bind(app.id, plan.slug, now).run();
      try {
        await save(ctxSave, `src/content/team/${plan.slug}.json`, record, `Add to the Advisory Board: ${app.name}`, { create: true });
      } catch (e) {
        // Refused (the address someone else's): no note of it left, so nothing later takes their record for this one's
        if (e?.status === 409 || e?.status === 400) await DB.prepare('DELETE FROM advisory_add_intents WHERE app_id = ?').bind(app.id).run().catch(() => {});
        throw e;
      }
    } finally {
      await release(DB, slugHold);
    }
    Object.assign(out, { slug: plan.slug, name: record.name, made: true, photoAdded: !!record.photo });
  } else {
    const slug = plan.person.slug;
    const row = await DB.prepare('SELECT data FROM team WHERE slug = ?').bind(slug).first();
    const saved = parse(row?.data, null);
    if (!saved) throw err('Their People record isn’t there any more. Close this and press Add to Advisory Board again.');
    const next = { ...saved };
    // A former member back: active again, and off the public site until staff show them (as anyone added is)
    if (next.status === 'alumni') { next.status = 'active'; next.publishStatus = 'draft'; out.restored = true; }
    if (!next.photo && app.headshot?.url) { Object.assign(next, photoOf(app.headshot)); out.photoAdded = true; }
    if (out.restored || out.photoAdded) {
      const sha = await generateSha(row.data); // the version read: a change made since is refused, never written over
      await save(ctxSave, `src/content/team/${slug}.json`, personRecord(next), `${out.restored ? 'Back on the Advisory Board' : 'Headshot from their application'}: ${saved.name || slug}`, { sha });
    }
    Object.assign(out, { slug, name: saved.name || slug });
  }

  // The application points at them now: a press after anything below fails picks up from here
  await DB.prepare('UPDATE advisory_applications SET person_slug = ?, updated_at = ? WHERE id = ?').bind(out.slug, new Date(now).toISOString(), app.id).run();

  // Their sign-in email: one they have stays; none on file, this application's
  // (a read that fails stops here: never taken as "none on file", which would save this one over theirs)
  const had = normEmail((await DB.prepare('SELECT email FROM reveal_board_emails WHERE slug = ?').bind(out.slug).first())?.email);
  if (had) Object.assign(out, { email: had, emailKept: true });
  else if (email && plan.emailUsable) {
    await setBoardEmail(DB, out.slug, email).catch((e) => {
      // (setBoardEmail's own words: an address someone else has, one that doesn't look right; anything else is D1)
      if (/D1_|SQLITE|network|connection/i.test(String(e?.message || ''))) throw e;
      throw err(`${out.name} is on the Advisory Board, but their email didn’t save: ${e.message}`);
    });
    await logAudit(DB, { userEmail: ctxSave.data.userEmail, action: 'updated', entityType: 'team', entitySlug: out.slug, entityName: `Reveal invite email for ${out.name}`, gitStatus: 'ok' }).catch(() => {});
    out.email = email;
    const refresh = refreshForBoardChange(env);
    if (ctx?.waitUntil) ctx.waitUntil(refresh); else await refresh;
  }

  // Their welcome is written down as waiting before the application is Joined: whatever fails from here, the heartbeat
  // sends it (once; never to someone who's had it), so a Joined application never leaves anyone without it
  const greet = greetName(app.answers || {});
  await queueWelcome(DB, out.slug, { by: ctxSave.data.userEmail, now, greet });
  const application = await linkAdvisor(DB, app.id, out.slug, { by: ctxSave.data.userEmail, now });
  await DB.prepare('DELETE FROM advisory_add_intents WHERE app_id = ?').bind(app.id).run()
    .catch((e) => console.error('[advisory-add] intent left (harmless: it names their record)', e?.message));
  const welcome = await welcomeOnJoin(env, out.slug, { by: ctxSave.data.userEmail, now, fetchImpl, greet })
    .catch((e) => { console.error('[advisory-add] welcome', e?.message || e); return { waiting: true, why: 'send' }; });
  return { application, person: out, welcome };
}
