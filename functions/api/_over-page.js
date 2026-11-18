/**
 * The tap-to-answer page for "Is the reveal over?" (Peter, Nov 18 2026: "can the text have response buttons?")
 * ===========================================================================
 * GET  /over/<token>      (functions/over/[token].js) shows the question and two buttons. Read only: phones and chat
 *                         apps open links by themselves to preview them, so a GET never answers anything.
 * POST /api/over-answer   (functions/api/over-answer.js) { token, answer: yes | no }, from the buttons (a form post,
 *                         answered with the page) or as JSON. The answer goes through answerByText, exactly as a Y or
 *                         N text does, and counts only for the broadcast and stop its link names.
 * The token (./_over-link.js) is checked first: a bad, expired or old one changes nothing and says why. Only a
 * number still on the staff alert list is heard, as for texts. Public pages: noindex, no-store, no referrer (the
 * link is the key), the site's page CSP with no scripts at all, and the site's fonts and colors.
 */

import { pageCsp, SECURITY_HEADERS } from './_middleware.js';
import { crossSiteChange } from './_origin-guard.js';
import * as notify from './_broadcast-notify.js';
import { answerByText, overLinkView, readConfig } from './_broadcast.js';
import { readOverLink } from './_over-link.js';
import { answerReply, whoTexted, timing } from './twilio-inbound.js';

const esc = notify.escapeHtml;
const MAX_BODY = 4 * 1024;

export const LINK_TEXTS = {
  bad: "This link isn't right, so nothing changed. Reply Y or N to the text instead.",
  expired: "This link has expired (they work for 30 minutes), so nothing changed. If the reveal is still waiting on its phone, a new question comes by text.",
  notStaff: 'This number is no longer on the alert list, so nothing changed.',
  crossSite: 'That came from another site, so nothing changed.',
};

/** What a tap did, in plain words */
export function linkResult(answer, r) {
  switch (r.outcome) {
    case 'ended': return 'Done: ended. Viewers see the last moments, then Thank you for watching. The replay follows in a few minutes.';
    case 'test-ended': return 'Done: the test ended. The site is back to how it was before the test.';
    case 'pre-show': return 'Done: ended. It stopped before the start time, so the countdown is back up for the reveal.';
    case 'held':
    case 'test-held': return 'Done: staying live. Viewers see Reconnecting until the phone is back (up to 15 min).';
    default: return answerReply(answer, r);
  }
}

export function pageHeaders() {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    ...SECURITY_HEADERS,
    // same-origin, never no-referrer: with no referrer the browser sends `Origin: null` on the buttons' POST and the
    // site's origin guard refuses it as another site (the page loads nothing from anywhere else, so the token in the
    // address never leaves the site)
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': pageCsp([]),
  };
}

const buttons = (token, { yes = true, no = true } = {}) => `<div class="actions">${[
  yes ? `<form method="post" action="/api/over-answer"><input type="hidden" name="token" value="${esc(token)}"><input type="hidden" name="answer" value="yes"><button class="yes" type="submit">Yes, it's over</button></form>` : '',
  no ? `<form method="post" action="/api/over-answer"><input type="hidden" name="token" value="${esc(token)}"><input type="hidden" name="answer" value="no"><button class="no" type="submit">No, the signal dropped</button></form>` : '',
].join('')}</div>`;

export function page({ eyebrow = 'Live reveal', lead = '', title, note = '', token = null, show = null, status = 200 }) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="same-origin"><meta name="color-scheme" content="light dark">
<title>${esc(title)} · Sunshine on a Ranney Day</title>
<style>
@font-face{font-family:Outfit;src:url(/fonts/outfit-latin-variable.woff2) format('woff2');font-weight:100 900;font-display:swap}
@font-face{font-family:'Libre Baskerville';src:url(/fonts/libre-baskerville-latin-700-normal.woff2) format('woff2');font-weight:700;font-display:swap}
:root{--page:#F5F4F0;--card:#FEFCF5;--ink:#2D2E33;--muted:#5A5B61;--gold:#8A7200;--y:#FFDA24;--outline:#D4D2CB;--outline-bg:#fff}
@media (prefers-color-scheme:dark){:root{--page:#141518;--card:#1F2024;--ink:#ECECEA;--muted:#ABACB2;--gold:#E6C744;--outline:#56575D;--outline-bg:#26272C}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:var(--page);font:17px/1.55 Outfit,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:var(--ink);-webkit-text-size-adjust:100%}
main{max-width:480px;margin:0 auto;padding:8vh 16px 40px}
.card{background:var(--card);border-radius:16px;padding:28px 22px 24px;box-shadow:0 1px 2px rgba(26,27,31,.04),0 8px 24px -8px rgba(26,27,31,.1)}
.eyebrow{display:flex;align-items:center;gap:10px;margin:0 0 14px;font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--gold)}
.eyebrow::before{content:'';width:28px;height:2px;background:var(--y);flex:none}
.lead{margin:0 0 6px;color:var(--muted)}
h1{font-family:'Libre Baskerville',Georgia,serif;font-size:26px;line-height:1.3;font-weight:700;margin:0 0 20px;text-wrap:balance}
.note{margin:0 0 20px;color:var(--muted)}
.actions{display:flex;flex-direction:column;gap:12px}
.actions form{margin:0}
button{width:100%;min-height:64px;padding:0 20px;border-radius:14px;font:inherit;font-size:19px;font-weight:700;cursor:pointer;-webkit-tap-highlight-color:transparent}
.yes{background:var(--y);color:#2D2E33;border:1px solid var(--y)}
.no{background:var(--outline-bg);color:var(--ink);border:1px solid var(--outline)}
button:focus-visible{outline:3px solid var(--ink);outline-offset:2px}
.foot{margin:18px 4px 0;font-size:12px;color:var(--muted);text-align:center}
</style></head><body><main><div class="card"><p class="eyebrow">${esc(eyebrow)}</p>${lead ? `<p class="lead">${esc(lead)}</p>` : ''}<h1>${esc(title)}</h1>${note ? `<p class="note">${esc(note)}</p>` : ''}${token && show ? buttons(token, show) : ''}</div><p class="foot">Sunshine on a Ranney Day</p></main></body></html>`, { status, headers: pageHeaders() });
}

/** A link that can't be used: why, in plain words */
const refused = (why, status) => page({ title: why === 'expired' ? 'This link has expired' : "Nothing changed", note: LINK_TEXTS[why] || LINK_TEXTS.bad, status });

/** The token checked → { ok: true, link } or { ok: false, why } */
async function checkLink(env, token) {
  const link = await readOverLink(env, token);
  return link.ok ? { ok: true, link } : link;
}

/** GET /over/<token>: the question and its two buttons, or where things stand. Never changes anything. */
export async function getOverPage(env, token) {
  try {
    const c = await checkLink(env, token);
    if (!c.ok) return refused(c.why, c.why === 'expired' ? 410 : 400);
    const view = await overLinkView(env, { broadcastId: c.link.broadcastId, key: c.link.key });
    if (!notify.alertPhones(view.config).includes(c.link.phone)) return refused('notStaff', 403);
    const eyebrow = view.test ? 'Test on the main feed' : 'Live reveal';
    if (view.question) return page({ eyebrow, lead: view.question, title: 'Is the reveal over?', token, show: { yes: true, no: true } });
    return page({ eyebrow, title: 'Nothing to answer here', note: linkResult('yes', view) });
  } catch {
    return page({ title: 'Nothing changed', note: 'The site could not answer just now. Reply Y or N to the text instead.', status: 503 });
  }
}

/** POST /api/over-answer: a tap on a button (a form post, answered with the page) or { token, answer } as JSON */
export async function postOverAnswer(context) {
  const { env, request } = context;
  const json = /application\/json/i.test(request.headers.get('Content-Type') || '');
  const answerWith = (status, { outcome = null, message, html }) => (json
    ? Response.json({ ok: status === 200 && !!outcome, outcome, message }, { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } })
    : html);
  if (crossSiteChange(request, [notify.SITE_ORIGIN])) {
    return answerWith(403, { message: LINK_TEXTS.crossSite, html: page({ title: 'Nothing changed', note: LINK_TEXTS.crossSite, status: 403 }) });
  }
  let token = '';
  let answer = '';
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY) throw new Error('too big');
    const body = json ? JSON.parse(raw || '{}') : Object.fromEntries(new URLSearchParams(raw));
    token = String(body?.token || '');
    answer = String(body?.answer || '').toLowerCase();
  } catch { /* checked below */ }
  if (!['yes', 'no'].includes(answer)) return answerWith(400, { message: LINK_TEXTS.bad, html: refused('bad', 400) });
  try {
    const c = await checkLink(env, token);
    if (!c.ok) return answerWith(c.why === 'expired' ? 410 : 400, { message: LINK_TEXTS[c.why], html: refused(c.why, c.why === 'expired' ? 410 : 400) });
    const { phone, broadcastId, key } = c.link;
    const config = await readConfig(env.DB);
    if (!notify.alertPhones(config).includes(phone)) return answerWith(403, { message: LINK_TEXTS.notStaff, html: refused('notStaff', 403) });
    const waitUntil = (p) => { if (context.waitUntil) context.waitUntil(p); };
    // After a "Got it" (slow), how it came out follows by text, to this number only, as for a text reply
    const onLate = (r) => notify.sendSms(env, { to: [phone], body: notify.smsSafe(answerReply(answer, { config, ...r })) });
    const r = await answerByText(env, { answer, who: whoTexted(phone), via: 'link', about: { broadcastId, key }, waitUntil, replyWithinMs: timing.replyWithinMs, onLate });
    const message = linkResult(answer, { config, ...r });
    const again = r.outcome === 'held' || r.outcome === 'test-held';
    return answerWith(200, { outcome: r.outcome, message, html: page({ title: message.startsWith('Done') ? 'Done' : r.outcome === 'slow' ? 'Got it' : 'Nothing changed', note: message, token: again ? token : null, show: again ? { yes: true, no: false } : null }) });
  } catch {
    const message = "Sorry, that didn't go through. Tap again, or reply Y or N to the text.";
    return answerWith(503, { message, html: page({ title: 'Nothing changed', note: message, status: 503 }) });
  }
}
