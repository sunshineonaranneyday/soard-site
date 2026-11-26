/**
 * /api/families-admin — Admin → Families (public/admin/families.js)
 * =====================================================================
 * Behind Cloudflare Access (not in the middleware's public list). JobTread
 * stays the record; see ./_families.js.
 *
 * GET ?list=1                → { families, syncedAt, kidsWithoutFamily, syncing } (read again from JobTread when
 *                               it's older than 10 minutes: at once the first time, else after the answer)
 * GET ?id=<account>          → { family } with its links, updates and removals waiting, fresh from JobTread
 * GET ?preview=<account|sample> → { subject, html, to } the email that family would get (the link in it is a sample)
 *
 * POST { sync: true }                                  → read every family again now ("Check JobTread now")
 * POST { send: { ids: [...] } }                        → email each family a new link (up to 25 at a time)
 * POST { link: { id } }                                → a new link to copy, not emailed (the last one stops working)
 * POST { save: { id, contacts, address?, note? } }     → staff's own changes, straight to JobTread (a removal too)
 * POST { removal: { id, decision: 'remove' | 'keep' } } → a removal the family asked for
 * POST { mailing: { id } }                             → clear the address the family gave, once it's dealt with
 */
import {
  ensureFamilySchema, listFamilies, familyDetail, maybeSyncFamilies, syncFamilies, refreshFamily, sendFamilyLink, createFamilyLink,
  applyUpdate, decideRemoval, clearMailing, familyEmail, recipientsOf, childOf, readFamily, isAccountId, linkUrl, LINK_DAYS,
} from './_families.js';
import { greetingNames } from './_applicant-comms.js';
import { logAudit } from './_audit.js';

const ok = (body = {}) => Response.json({ ok: true, ...body }, { headers: { 'Cache-Control': 'no-store' } });
const fail = (error, status = 400, extra = {}) => Response.json({ ok: false, error, ...extra }, { status, headers: { 'Cache-Control': 'no-store' } });
const MAX_SEND = 25;

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return fail('DB not bound', 500);
  const url = new URL(request.url);
  try {
    await ensureFamilySchema(env.DB);
    if (url.searchParams.get('list')) {
      let syncing = false;
      if (env.JOBTREAD_GRANT_KEY) {
        const first = !(await env.DB.prepare('SELECT 1 FROM families LIMIT 1').first());
        if (first) await maybeSyncFamilies(env, { force: true });
        else { syncing = true; context.waitUntil?.(maybeSyncFamilies(env).catch((e) => console.error('[families sync]', e))); }
      }
      return ok({ ...(await listFamilies(env.DB)), syncing, jobtread: !!env.JOBTREAD_GRANT_KEY, linkDays: LINK_DAYS });
    }
    const id = url.searchParams.get('id');
    if (id) {
      if (!isAccountId(id)) return fail('Which family?');
      if (env.JOBTREAD_GRANT_KEY) await refreshFamily(env, id).catch((e) => console.error('[families refresh]', e));
      const family = await familyDetail(env.DB, id);
      return family ? ok({ family }) : fail('That family isn’t on the list.', 404);
    }
    const preview = url.searchParams.get('preview');
    if (preview) {
      const sampleUrl = linkUrl('sample-link-for-preview-only');
      const expiresAt = new Date(Date.now() + LINK_DAYS * 864e5).toISOString();
      if (preview === 'sample') return ok({ ...familyEmail({ greeting: 'Jordan and Sam Stone', child: 'Avery', url: sampleUrl, expiresAt }), to: ['jordan@example.com', 'sam@example.com'] });
      if (!isAccountId(preview)) return fail('Which family?');
      const f = env.JOBTREAD_GRANT_KEY ? await readFamily(env, preview) : null;
      const row = await env.DB.prepare('SELECT name, kids, contacts FROM families WHERE account_id = ?').bind(preview).first();
      const contacts = f?.contacts || JSON.parse(row?.contacts || '[]');
      const to = recipientsOf(contacts);
      const greeting = greetingNames(contacts.filter((c) => recipientsOf([c]).length), { fallback: '' });
      return ok({ ...familyEmail({ greeting, child: childOf(JSON.parse(row?.kids || '[]'), f?.name || row?.name), url: sampleUrl, expiresAt }), to: to.map((t) => t.email) });
    }
    return fail('What should it read?');
  } catch (e) {
    console.error('[families-admin]', e);
    return fail(e.message || 'That didn’t work', e.status || 500);
  }
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return fail('DB not bound', 500);
  if (!env.JOBTREAD_GRANT_KEY) return fail('JOBTREAD_GRANT_KEY is not set in Cloudflare', 500);
  let body = {};
  try { body = await request.json(); } catch { /* empty */ }
  const user = context.data?.userEmail || 'admin';
  const audit = (action, id, changes) => logAudit(env.DB, { userEmail: user, action, entityType: 'family', entitySlug: id, changes }).catch(() => {});
  const target = (o) => {
    if (!o || !isAccountId(o.id)) throw Object.assign(new Error('Which family?'), { status: 400 });
    return o.id;
  };
  try {
    await ensureFamilySchema(env.DB);

    if (body.sync) {
      const out = await syncFamilies(env);
      return ok({ ...out, ...(await listFamilies(env.DB)) });
    }

    if (body.send) {
      const ids = [...new Set((Array.isArray(body.send.ids) ? body.send.ids : []).filter(isAccountId))];
      if (!ids.length) return fail('Which families?');
      if (ids.length > MAX_SEND) return fail(`Send up to ${MAX_SEND} at a time.`);
      const results = [];
      for (const id of ids) {
        try {
          const r = await sendFamilyLink(env, id, { by: user });
          results.push({ id, ok: true, to: r.to });
          await audit('family-link-sent', id, [{ field: 'link', to: `emailed to ${r.to.length}` }]);
        } catch (e) {
          results.push({ id, ok: false, error: e.message });
        }
      }
      return ok({ results, sent: results.filter((r) => r.ok).length });
    }

    if (body.link) {
      const id = target(body.link);
      const link = await createFamilyLink(env.DB, id, { by: user });
      await audit('family-link-made', id, [{ field: 'link', to: 'made to copy' }]);
      return ok({ url: link.url, expiresAt: link.expiresAt });
    }

    if (body.save) {
      const id = target(body.save);
      const out = await applyUpdate(env, id, body.save, { by: user });
      await audit('family-contacts', id, [
        ...out.edits.map((e) => ({ field: `contact ${e.name}`, to: Object.keys(e.fields).join(', ') })),
        ...out.adds.map((a) => ({ field: 'contact added', to: a.name })),
        ...out.removes.map((r) => ({ field: 'contact removed', to: r.name })),
      ]);
      return ok({ result: { kind: out.kind, edits: out.edits.length, adds: out.adds.length, removes: out.removes.length, problems: out.problems }, family: await familyDetail(env.DB, id) });
    }

    if (body.removal) {
      const out = await decideRemoval(env, body.removal.id, body.removal.decision, { by: user });
      const row = await env.DB.prepare('SELECT account_id, name FROM family_removals WHERE id = ?').bind(Number(body.removal.id) || 0).first();
      if (row) await audit('family-removal', row.account_id, [{ field: `remove ${row.name}`, to: out.decision }]);
      return ok({ ...out, family: row ? await familyDetail(env.DB, row.account_id) : null });
    }

    if (body.mailing) {
      const id = target(body.mailing);
      await clearMailing(env.DB, id);
      await audit('family-address-cleared', id, null);
      return ok({ family: await familyDetail(env.DB, id) });
    }

    return fail('Unknown action');
  } catch (e) {
    if (!e.status || e.status >= 500) console.error('[families-admin]', e);
    return fail(e.message || 'That didn’t work', e.status || 500, e.field ? { field: e.field } : {});
  }
}
