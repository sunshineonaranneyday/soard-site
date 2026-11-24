/**
 * /api/reveal-press-admin (Cloudflare Access) — the press release, for Reveals → Invites → Press release
 * and the Press release step on Reveals → Now (./_reveal-press.js)
 *
 * GET                    → the settings (press list, who it's from, the standing words), the site's defaults,
 *                          and the Google accounts it can come from
 * GET ?preview=<jobId>   → that reveal's press release as it would be drafted now: subject, HTML, from, Bcc (drafts nothing)
 * POST { settings }      → save them (an untouched draft takes a new press list or new words on its next look)
 * POST { draft: jobId }  → draft it in the sender's Gmail now (ahead of JobTread, or again after it was deleted)
 */

import { readPressSettings, writePressSettings, cleanSettings, buildRelease, senderOf, senderChoices, PRESS_DEFAULTS, PRESS_LIMITS, LIST_MAX, readPressRow } from './_reveal-press.js';
import { readConfig, inviteFromJob, draftPressNow } from './_reveal-invites.js';
import { inviteFacts } from './_reveal-invite-kit.js';
import { accessToken, GMAIL_MODIFY_SCOPE } from './_google-calendar.js';
import { logAudit } from './_audit.js';
import { sayable } from './_board.js';

const ID = /^[A-Za-z0-9]{6,32}$/;
const fail = (error, status = 400) => Response.json({ ok: false, error }, { status });

export async function onRequestGet(context) {
  const { env } = context;
  const q = new URL(context.request.url).searchParams;
  try {
    const settings = await readPressSettings(env.DB);
    if (q.has('preview')) {
      const jobId = q.get('preview');
      if (!ID.test(jobId)) return fail('A JobTread job id is required');
      if (!env.JOBTREAD_GRANT_KEY) return fail('The JobTread grant key is missing in Cloudflare', 503);
      const { job, plan, who, room } = await inviteFromJob(env, jobId, await readConfig(env.DB));
      if (!job) return fail('JobTread has no such job', 404);
      if (plan.action !== 'upsert') return fail(`There’s no reveal to announce: ${plan.reason || 'JobTread has no Reveal date'}`, 409);
      const row = await readPressRow(env.DB, jobId);
      const from = row?.sender && ['draft', 'edited', 'sent'].includes(row.state) ? row.sender : settings.from;
      // Her Gmail's own name and signature when the site can read them; the press release without them otherwise
      let token = null;
      try { if (env.GOOGLE_CALENDAR_KEY) token = await accessToken(env, (await senderOf(env, from)).account, { scope: GMAIL_MODIFY_SCOPE }); } catch { /* no signature */ }
      const built = await buildRelease(env, { who, f: inviteFacts(plan, who, room), room, settings: { ...settings, from }, token });
      if (built.error) return fail(built.error, 409);
      return Response.json({
        ok: true, jobId, name: who?.name || null, confirmed: !!plan.confirmed, time: plan.facts?.start || null,
        subject: built.mail.subject, html: built.mail.html, from: built.sender, bcc: built.bcc, storyBy: built.storyBy, signature: !!token,
      });
    }
    let choices = [];
    try { choices = (await senderChoices(env)).map((b) => ({ email: b.email, name: b.name, aliases: b.aliases })); } catch { /* the page offers what's saved */ }
    let sender = null;
    try { sender = await senderOf(env, settings.from); } catch (e) { sender = { email: settings.from, error: e.message }; }
    // SOARD's phone in Site Config: the media contact's when that box is left empty
    let orgPhone = '';
    try { orgPhone = String(JSON.parse((await env.DB.prepare("SELECT data FROM site_config WHERE key = 'settings'").first())?.data || '{}').phone || ''); } catch { /* none */ }
    return Response.json({ ok: true, settings, defaults: PRESS_DEFAULTS, limits: { ...PRESS_LIMITS, list: LIST_MAX }, sender, choices, orgPhone, google: Boolean(env.GOOGLE_CALENDAR_KEY) });
  } catch (err) {
    return Response.json({ ok: false, error: err.unread ? err.message : sayable(err) }, { status: err.unread ? 503 : 500 });
  }
}

export async function onRequestPost(context) {
  const { env } = context;
  const me = context.data?.userEmail || 'unknown';
  let body = {};
  try { body = await context.request.json(); } catch { /* empty */ }
  try {
    if (body.draft !== undefined) {
      const jobId = String(body.draft);
      if (!ID.test(jobId)) return fail('A JobTread job id is required');
      if (!me.includes('@')) return fail('Could not tell who you are from Access', 403);
      const result = await draftPressNow(env, jobId);
      if (['drafted', 'updated'].includes(result.press)) {
        await logAudit(env.DB, { userEmail: me, action: 'created', entityType: 'newsletter', entitySlug: jobId, entityName: `Press release draft: ${result.name || jobId}`, gitStatus: 'ok' }).catch(() => {});
      }
      return Response.json({ ok: !['error', 'skip', 'off'].includes(result.press), ...result });
    }
    if (body.settings && typeof body.settings === 'object') {
      const s = body.settings;
      const before = await readPressSettings(env.DB);
      const next = cleanSettings(s, before);
      if (next.from !== before.from) {
        // It's drafted in that person's own Gmail: only an active Google account of SOARD's, or an alias on one
        try { await senderOf(env, next.from); } catch (e) { return fail(e.message); }
      }
      if (Array.isArray(s.list) && s.list.length > LIST_MAX) return fail(`The press list holds ${LIST_MAX} addresses at most`);
      const saved = await writePressSettings(env.DB, s);
      const changed = Object.keys(saved).filter((k) => JSON.stringify(saved[k]) !== JSON.stringify(before[k]));
      if (changed.length) {
        await logAudit(env.DB, {
          userEmail: me, action: 'updated', entityType: 'site-config', entitySlug: 'reveal-press', entityName: 'Press release',
          changes: changed.map((field) => ({ field, from: field === 'list' ? `${before.list.length} addresses` : before[field], to: field === 'list' ? `${saved.list.length} addresses` : saved[field] })),
          gitStatus: 'ok',
        }).catch(() => {});
      }
      return Response.json({ ok: true, settings: saved });
    }
    return fail('Nothing to change');
  } catch (err) {
    return Response.json({ ok: false, error: err.unread ? err.message : sayable(err) }, { status: err.unread ? 503 : 500 });
  }
}
