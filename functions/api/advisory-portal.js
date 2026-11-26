/**
 * /api/advisory-portal (Cloudflare Access) — the Advisory Board's page (/admin/advisory/)
 *
 * Who: an advisor (context.data.advisor), the board member who runs the group, a board member on its committee,
 * or one of the Board area's admins. Anyone else gets 403. (./_advisory.js whoIs)
 *
 * GET                                          → everything the page shows (./_advisory-portal.js)
 * POST { action: 'answer', askId, answer, note }   this month's ask: 'yes' or 'no', and a line of text if they like
 * POST { action: 'intro', name, company, email, phone, how, help, wish }   "I know someone"
 * POST { action: 'host', title, when, where, expected, notes }   a request to host a fundraiser (staff approve it)
 * POST { action: 'sign', docId, name }         the advisor agreement, with their own name typed
 * POST { action: 'renew' }                     another year, when the term is near its end
 * POST { action: 'activity', events, touch }   what they looked at (../../public/admin/board/activity.js)
 * Only an advisor answers, signs or introduces: someone looking on their behalf has no seat here.
 * Each of their writes lands at the address they have as it's written, found by the email they signed in with, never
 * the address read when the request began (./_member-write.js; Advisory Board QA round 21), and the notice to whoever
 * runs the group names whose record it landed on, as that same write found them (Advisory Board QA round 22: never read
 * again by the record's address afterwards, which during a swap of two addresses was the other person), and a renewal's
 * date is the term that same write saved (round 23: ./_advisory.js termWritten).
 */

import { whoIs, answerAsk, addIntro, requestHost, signDoc, renew, getSettings } from './_advisory.js';
import { advisoryPortalData } from './_advisory-portal.js';
import { leadNotice, answerNotice, sendNotice } from './_advisory-mail.js';
import { noteGet, noteEvents } from './_board-activity.js';
import { PEOPLE_DOWN, PEOPLE_DOWN_SENT, SIGN_IN_DOWN } from './_board-roles.js';

const fail = (error, status = 400, extra = {}) => Response.json({ ok: false, error, ...extra }, { status });
const fromError = (e) => {
  // (a 503 is ours and in words: a read of who's signed in didn't answer, said with Try again, never "not for you")
  if (e.status && (e.status < 500 || (e.status === 503 && e.unread))) return fail(e.message, e.status, e.changed ? { changed: true } : {});
  // (a change of their web address still moving their records: nothing written, said in words: ./_member-write.js)
  if (e.moving) return fail(e.message, 503, { moving: true });
  console.error('[advisory]', e?.message || e);
  return Response.json({ ok: false, error: 'That didn’t go through. Try again in a moment.' }, { status: 500 });
};
const later = async (context, p) => { if (context.waitUntil) context.waitUntil(p); else await p; };
const REFUSED = 'The Advisory Board page is for SOARD’s Advisory Board';

export async function onRequestGet(context) {
  try {
    const w = await whoIs(context);
    if (!w) return fail(REFUSED, 403);
    if (w.kind === 'advisor') await later(context, noteGet(context.env, w, context.request));
    return Response.json(await advisoryPortalData(context.env, w), { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    // (the page's read of People that didn't answer: the sign-in's words with Try again, never a page of nobody: round 10)
    return fromError(e?.unread && [PEOPLE_DOWN, PEOPLE_DOWN_SENT].includes(e.message) ? Object.assign(e, { message: SIGN_IN_DOWN }) : e);
  }
}

export async function onRequestPost(context) {
  const { env, request } = context;
  try {
    const w = await whoIs(context);
    if (!w) return fail(REFUSED, 403);
    let body = {};
    try { body = await request.json(); } catch { return fail('Expected JSON'); }
    if (body.action === 'activity') {
      if (w.kind === 'advisor') await later(context, noteEvents(env, w, request, body));
      return Response.json({ ok: true });
    }
    if (!w.answers) return fail('Only an Advisory Board member can do this', 403);
    // The notice to whoever runs the group is owed in the member's own write (./_advisory-mail.js leadNotice), naming them
    // as that write found them; it's sent once the write is done, and the heartbeat sends it if that send can't
    // (Advisory Board QA round 25: sent after the write, a send that failed lost it)
    switch (body.action) {
      case 'answer': {
        const { slug, name, notice, ...mine } = await answerAsk(env.DB, String(body.askId || ''), w, { answer: body.answer, note: body.note }, {
          // (keyed by the ask, the member and the answer, never the moment of the press: the same answer again sends
          // nothing; a changed one sends one notice saying where it stands now: Advisory Board QA round 26)
          notice: (me, a) => answerNotice({ askId: a.askId, slug: me.slug, name: me.person.name, answer: a.answer, note: a.note }) });
        if (notice) await later(context, sendNotice(env, notice));
        return Response.json({ ok: true, mine });
      }
      case 'intro': {
        // (its id is the page's, made once for the form: pressed again, the one made, never a second, ./_advisory.js)
        const intro = await addIntro(env.DB, w, body, { notice: (me, x) => leadNotice('intro', { name: me.person.name, intro: x, ref: x.id }) });
        await later(context, sendNotice(env, `notice:intro:${intro.id}`));
        return Response.json({ ok: true, intro: { id: intro.id, name: intro.name, company: intro.company, status: intro.status, at: intro.at, updatedAt: intro.updatedAt } });
      }
      case 'host': {
        const hosted = await requestHost(env.DB, w, body, { notice: (me, x) => leadNotice('host', { name: me.person.name, hosted: x, ref: x.id }) });
        await later(context, sendNotice(env, `notice:host:${hosted.id}`));
        return Response.json({ ok: true, hosted: { id: hosted.id, title: hosted.title, status: hosted.status, when: hosted.when, note: '' } });
      }
      case 'sign':
        return Response.json({ ok: true, signed: await signDoc(env.DB, String(body.docId || ''), w, body.name, { version: body.version }) });
      case 'renew': {
        const { landedOn, notice, ...term } = await renew(env.DB, w, await getSettings(env.DB), {
          notice: (me, t) => leadNotice('renew', { name: me.person.name, term: t, ref: `${me.slug}:${t.ends}` }) });
        if (notice) await later(context, sendNotice(env, notice));
        return Response.json({ ok: true, term });
      }
      default: return fail('Unknown action');
    }
  } catch (e) { return fromError(e); }
}
