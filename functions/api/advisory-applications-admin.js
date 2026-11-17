/**
 * /api/advisory-applications-admin — Admin → People → Applications
 * =====================================================================
 * Behind Cloudflare Access (not in the middleware's public list).
 *
 * GET                      → { applications, statuses, settings, boardEmails } (the Jotform ones come in first, once;
 *                            a Joined one whose person isn't an active Advisory Board member now has left: true;
 *                            boardEmails: whether the Advisory Board's emails switch is on, for what Add says it does)
 * GET ?count=1             → { new } for the tab's badge
 * GET ?id=<application>    → { application } with the answers by step and the notes, and `person`: who it's linked
 *                            to as People has them now ({ slug, name, group, status, publishStatus }), null when that
 *                            record isn't on People any more (every POST that answers with an application has it too)
 * GET ?plan=<application>  → { plan } what Add to Advisory Board would do, for its confirm box (./_advisory-add.js addPlan)
 * POST { add: { id, as, seen } }  → Add to Advisory Board, on the server in one go: as 'new' or 'same', seen: the kind
 *                             of box pressed (refused when that's not what's true now) (./_advisory-add.js)
 *                             → { application, person, welcome }
 * POST { status: { id, status } }      → where it stands (new, talking, not-now; joined only when it's linked to an
 *                                        active Advisory Board member: Add to Advisory Board sets it)
 * POST { note: { id, text } }          → a staff note
 * POST { person: { id, slug } }        → linked by hand to someone on People → Advisory (no one else), Joined, and their welcome
 *                                        ("Your Advisory Board page is ready") goes with the switch on:
 *                                        { application, welcome: { sent } | { waiting } | { off } | { already } | { noEmail } }
 * POST { settings: { staffEmails } }   → who gets the email when someone applies
 * POST { remove: { id } }              → delete the application from the site (its headshot too, unless it's
 *                                        their People photo now)
 *
 * See ./_advisory-applications.js.
 */

import {
  ensureAdvisorySchema, listAdvisoryApplications, getAdvisoryApplication, countNew, setAdvisoryStatus, addAdvisoryNote,
  linkAdvisor, deleteAdvisoryApplication, getAdvisorySettings, saveAdvisorySettings, importJotformApplications, isApplicationId, STATUSES,
} from './_advisory-applications.js';
import { logAudit } from './_audit.js';
import { getSettings as getBoardSettings } from './_advisory.js';
import { addPlan, addBusy, addToBoard, deleteWhenFree } from './_advisory-add.js';
import { personStatus, personName } from './_team.js';
import { signInWhy } from './_board-roles.js';

const ok = (body = {}) => Response.json({ success: true, ...body }, { headers: { 'Cache-Control': 'no-store' } });
const fail = (error, status = 400, extra = {}) => Response.json({ success: false, error, ...extra }, { status });
// D1 not answering: said in words (never "D1_ERROR: …"), and safe to try again
const BUSY = 'The site’s database didn’t answer just now. Please try again in a moment.';
const GONE = 'This application isn’t here any more: it was deleted, maybe in another tab.';
const failed = (e) => { if (!e?.status) console.error('[advisory-applications]', e?.message || e); return fail(e?.status ? e.message : BUSY, e?.status || 503); };

/**
 * The application with who it's linked to, read from People now (never the admin's own copy of People, which can be
 * from before an Add, or before someone else's in another tab). Couldn't be read just now: left out, and the panel
 * says nothing either way.
 */
/** The addresses of everyone active on People → Advisory now (null when People couldn't be read: nothing is marked) */
async function activeMembers(DB) {
  try {
    const { results } = await DB.prepare('SELECT slug, data FROM team').all();
    return new Set((results || []).filter((r) => { let d = {}; try { d = JSON.parse(r.data || '{}'); } catch { d = {}; } return d.group === 'advisory' && personStatus(d) === 'active'; }).map((r) => r.slug));
  } catch (e) {
    return /no such table/i.test(e?.message || '') ? new Set() : null;
  }
}

async function withPerson(DB, application) {
  if (!application) return application;
  // (Joined, linked to nobody now: they've left)
  if (!application.personSlug) return application.status === 'joined' ? { ...application, left: true } : application;
  try {
    const row = await DB.prepare('SELECT data FROM team WHERE slug = ?').bind(application.personSlug).first();
    if (!row) return { ...application, person: null, ...(application.status === 'joined' ? { left: true } : {}) };
    const d = JSON.parse(row.data || '{}');
    // (hasEmail: a sign-in email on file, which is what their sign-in, reveal invites and advisory@ follow)
    const email = await DB.prepare('SELECT email FROM reveal_board_emails WHERE slug = ?').bind(application.personSlug).first().catch((e) => { if (/no such table/i.test(e?.message || '')) return null; throw e; });
    const why = email?.email ? signInWhy(email.email) : '';
    const person = { slug: application.personSlug, name: personName(d) || application.name, group: d.group || null, status: personStatus(d), publishStatus: d.publishStatus || null, hasEmail: !!email?.email && !why, ...(why ? { emailWhy: why } : {}) };
    const on = person.group === 'advisory' && person.status === 'active';
    return { ...application, person, ...(application.status === 'joined' && !on ? { left: true } : {}) };
  } catch (e) {
    return /no such table/i.test(e?.message || '') ? { ...application, person: null } : application;
  }
}

export async function onRequestGet(context) {
  try { return await get(context); } catch (e) { return failed(e); }
}
async function get(context) {
  const { env, request } = context;
  if (!env.DB) return fail('DB not bound', 500);
  await ensureAdvisorySchema(env.DB);
  const url = new URL(request.url);
  if (url.searchParams.get('count')) return ok({ new: await countNew(env.DB) });
  const planFor = url.searchParams.get('plan');
  if (planFor) {
    if (!isApplicationId(planFor)) return fail('Bad id');
    try {
      const plan = await addPlan(env, planFor);
      // (busyName and busyOther: who that press is adding, and whether it's from another application)
      const busy = await addBusy(env.DB, plan);
      return ok({ plan: { ...plan, busy: !!busy, ...(busy ? { busyName: busy.name, busyOther: busy.other } : {}) } });
    } catch (e) { return failed(e); }
  }
  const id = url.searchParams.get('id');
  if (id) {
    if (!isApplicationId(id)) return fail('Bad id');
    const application = await getAdvisoryApplication(env.DB, id);
    return application ? ok({ application: await withPerson(env.DB, application) }) : fail(GONE, 404);
  }
  const imported = await importJotformApplications(env.DB).catch(() => 0);
  const [applications, settings, board, onBoard] = await Promise.all([listAdvisoryApplications(env.DB), getAdvisorySettings(env.DB), getBoardSettings(env.DB).catch(() => ({})), activeMembers(env.DB)]);
  // Joined, but they've left the Advisory Board since (or were deleted from People): said, never counted as Joined
  if (onBoard) for (const a of applications) if (a.status === 'joined' && !(a.personSlug && onBoard.has(a.personSlug))) a.left = true;
  return ok({ applications, statuses: STATUSES, settings, imported, boardEmails: !!board.emails });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return fail('DB not bound', 500);
  const by = context.data?.userEmail || null;
  let body;
  try { body = await request.json(); } catch { return fail('Bad request'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('Bad request');
  const idOf = (x) => (isApplicationId(x?.id) ? x.id : null);
  try {
    if (body.status) {
      const id = idOf(body.status);
      if (!id) return fail('Bad id');
      const app = await getAdvisoryApplication(env.DB, id);
      if (!app) return fail(GONE, 404);
      // What the panel showed must be what's so: one opened before another tab changed it changes nothing
      if (typeof body.status.from === 'string' && body.status.from !== app.status) {
        return fail('This application changed since the panel opened (in another tab, or by someone else). Here it is as it is now.', 409, { application: await withPerson(env.DB, app) });
      }
      // Joined means on the Advisory Board with everything that comes with it: only Add to Advisory Board makes it so
      // (it finishes what a stopped press left: their email, their welcome), never the pill alone
      if (body.status.status === 'joined' && app.status !== 'joined') {
        return fail('Joined is set by Add to Advisory Board, so they’re on the Advisory Board, with their sign-in and welcome, when it says so. Press Add to Advisory Board instead.', 409);
      }
      return ok({ application: await withPerson(env.DB, await setAdvisoryStatus(env.DB, id, body.status.status, { by })) });
    }
    if (body.note) {
      const id = idOf(body.note);
      if (!id) return fail('Bad id');
      if (typeof body.note.text !== 'string') return fail('Write the note first');
      return ok({ application: await withPerson(env.DB, await addAdvisoryNote(env.DB, id, body.note.text, { by })) });
    }
    if (body.add) {
      const id = idOf(body.add);
      if (!id) return fail('Bad id');
      if (!['new', 'same'].includes(body.add.as)) return fail('Say whether they’re a new person or the one found');
      const to = typeof body.add.to === 'string' && body.add.as === 'same' ? body.add.to : null;
      const done = await addToBoard(env, context, { id, as: body.add.as, to, seen: typeof body.add.seen === 'string' ? body.add.seen : null, by: by || '' });
      await logAudit(env.DB, { userEmail: by, action: 'updated', entityType: 'advisory-application', entitySlug: id, entityName: `Advisory Board application: ${done.application.name} added to the Advisory Board as ${done.person.name}`, changes: null, path: null, gitStatus: 'runtime' }).catch(() => {});
      return ok({ ...done, application: await withPerson(env.DB, done.application) });
    }
    if (body.person) {
      // (no screen uses this: kept for scripts, and held to Add's own rules: only the person Add finds for this
      // application, with its box, its email and its welcome; never a way round them)
      const id = idOf(body.person);
      if (!id) return fail('Bad id');
      const plan = await addPlan(env, id);
      if (plan.person?.slug !== String(body.person.slug || '') || !['same', 'joined'].includes(plan.kind)) {
        return fail('That isn’t who this application matches on People. Use Add to Advisory Board, which says who it is first.', 409);
      }
      const done = await addToBoard(env, context, { id, as: 'same', seen: plan.key, by: by || '' });
      return ok({ ...done, application: await withPerson(env.DB, done.application) });
    }
    if (body.settings) {
      const r = await saveAdvisorySettings(env.DB, body.settings, { by });
      if (r.problems) return fail('Check the emails', 422, { problems: r.problems });
      await logAudit(env.DB, { userEmail: by, action: 'updated', entityType: 'advisory-settings', entitySlug: 'staffEmails', entityName: 'Advisory Board applications: who hears about them', changes: null, path: null, gitStatus: 'runtime' }).catch(() => {});
      return ok({ settings: r.settings });
    }
    if (body.remove) {
      const id = idOf(body.remove);
      if (!id) return fail('Bad id');
      const app = await getAdvisoryApplication(env.DB, id);
      if (!app) return fail(GONE, 404);
      // (never while a press is adding from it: refused in words, and the press told it's gone if it comes meanwhile)
      await deleteWhenFree(env.DB, app, () => deleteAdvisoryApplication(env, id));
      await logAudit(env.DB, { userEmail: by, action: 'deleted', entityType: 'advisory-application', entitySlug: id, entityName: `Advisory Board application: ${app.name}`, changes: null, path: null, gitStatus: 'runtime' }).catch(() => {});
      return ok({ removed: id });
    }
    return fail('Nothing to do');
  } catch (e) {
    return failed(e);
  }
}
