/**
 * /api/advisory-action — the buttons in the monthly ask's email
 * =====================================================================
 * Public (no sign-in, so it works from a phone): each link carries a token for one
 * ask and one advisor (./_advisory-mail.js; D1 keeps only its hash, and it works for
 * 30 days). GET only shows the question, because mail scanners open links on their
 * own; the answer is saved when a person presses the button (POST).
 *   ?t=<token>&do=yes   I can help
 *   ?t=<token>&do=no    Not this time
 */

import { linkState, answerFromLink, sendNotice, LINK_STATUS } from './_advisory-mail.js';
import { escapeHtml, SITE_ORIGIN } from './_broadcast-notify.js';
import { ensureAdvisory } from './_advisory.js';

function page(title, body, { status = 200 } = {}) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${escapeHtml(title)} · SOARD Advisory Board</title>
<style>
@font-face{font-family:Outfit;src:url(/fonts/outfit-latin-variable.woff2) format('woff2');font-weight:100 900;font-display:swap}
@font-face{font-family:'Libre Baskerville';src:url(/fonts/libre-baskerville-latin-700-normal.woff2) format('woff2');font-weight:700;font-display:swap}
*{box-sizing:border-box}body{margin:0;background:#F5F4F0;color:#2D2E33;font:400 17px/1.55 Outfit,system-ui,sans-serif;padding:32px 16px}
main{max-width:520px;margin:0 auto;background:#FEFCF5;border:1px solid #E5E4E0;border-radius:14px;padding:28px}
h1{font:700 24px/1.25 'Libre Baskerville',Georgia,serif;margin:0 0 10px}p{margin:0 0 14px}
textarea{width:100%;min-height:96px;font:inherit;padding:10px 12px;border:1px solid #D4D2CB;border-radius:10px;background:#fff;color:inherit}
label{display:block;font-weight:600;margin:0 0 6px}
button,a.b{display:inline-block;font:600 16px Outfit,sans-serif;background:#FFDA24;color:#2D2E33;border:0;border-radius:999px;padding:12px 24px;margin-top:14px;text-decoration:none;cursor:pointer}
button:focus-visible,a.b:focus-visible,textarea:focus-visible{outline:3px solid #2D2E33;outline-offset:2px}
</style></head><body><main>${body}</main></body></html>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } });
}
const OPEN = `<a class="b" href="${SITE_ORIGIN}/admin/advisory/">Open the page</a>`;
/**
 * A link that can't take an answer, in true words for each case (Advisory Board QA round 21: every case said "This
 * link has expired" and offered a page that someone who left can't open). GET and POST say the same: both ask
 * linkState (./_advisory-mail.js) what the link stands for, its ask's state included (round 22: a closed ask was "That
 * ask has closed" opened and "That didn't go through" pressed). For the one that passes, 'moving' (a change of web
 * address under way, or the database not answering), a way to try again: the press made again (POST, with what they
 * typed), or the question shown again (GET)
 */
function refused(why, { t = '', yes = true, note = '', get = false } = {}) {
  const status = LINK_STATUS[why] || 410;
  if (why === 'left') {
    return page('Thank you for your time on SOARD’s Advisory Board', '<h1>Thank you for your time on SOARD’s Advisory Board</h1><p>This link was for current Advisory Board members, so it doesn’t take answers anymore.</p>', { status });
  }
  if (why === 'closed') return page('That ask has closed', `<h1>That ask has closed</h1><p>Thank you for looking. Your page always has what’s current.</p>${OPEN}`, { status });
  if (why === 'expired') return page('This link has expired', `<h1>This link has expired</h1><p>You can still answer on the Advisory Board page.</p>${OPEN}`, { status });
  if (why === 'moving') {
    const again = get
      ? `<a class="b" href="${SITE_ORIGIN}/api/advisory-action?t=${encodeURIComponent(t)}&amp;do=${yes ? 'yes' : 'no'}">Try again</a>`
      // (their answer, and what they typed with it, kept for the press again)
      : `<form method="post"><input type="hidden" name="t" value="${escapeHtml(t)}"><input type="hidden" name="do" value="${yes ? 'yes' : 'no'}"><input type="hidden" name="note" value="${escapeHtml(note)}">
<button type="submit">Try again</button></form>`;
    return page('We couldn’t take your answer just now', `<h1>We couldn’t take your answer just now</h1><p>Please try again in a few minutes.</p>${again}`, { status });
  }
  return page('This link doesn’t work anymore', `<h1>This link doesn’t work anymore</h1><p>If you’re on SOARD’s Advisory Board, you can answer on the Advisory Board page.</p>${OPEN}`, { status });
}
/**
 * A press the site's limit on presses a minute stopped before it got here (./_middleware.js): the words any press that
 * couldn't be taken gets, what they typed kept to press again, as a 429 (Advisory Board QA round 22: it was JSON)
 */
export async function pressLater(request, { wait = 60 } = {}) {
  const form = await request.formData().catch(() => null);
  const r = refused('moving', { t: String(form?.get('t') || ''), yes: form?.get('do') === 'yes', note: String(form?.get('note') || '') });
  return new Response(r.body, { status: 429, headers: { ...Object.fromEntries(r.headers), 'Retry-After': String(wait) } });
}

/**
 * Opening the link: the question, with its button. Everything it reads is inside the handling, the Advisory Board's
 * table setup on a fresh worker's first request included (Advisory Board QA round 22: a database failure here was a raw
 * error, Cloudflare's error page live): any failure is said in words with Try again, which opens the question again
 */
export async function onRequestGet({ env, request }) {
  const q = new URL(request.url).searchParams;
  const t = q.get('t') || '';
  const yes = q.get('do') === 'yes';
  try {
    await ensureAdvisory(env.DB);
    const link = await linkState(env.DB, t);
    if (link.why) return refused(link.why, { t, yes, get: true });
    const { ask } = link;
    return page(ask.title, `<h1>${escapeHtml(ask.title)}</h1>${ask.body ? `<p>${escapeHtml(ask.body)}</p>` : ''}
<form method="post"><input type="hidden" name="t" value="${escapeHtml(t)}"><input type="hidden" name="do" value="${yes ? 'yes' : 'no'}">
<label for="note">${yes ? 'Anything to add? (you can leave this blank)' : 'Want to say why? (you can leave this blank)'}</label><textarea id="note" name="note" maxlength="800"></textarea>
<button type="submit">${yes ? 'Yes, I can help' : 'Not this time'}</button></form>`);
  } catch (e) {
    console.error('[advisory-action]', e?.message || e);
    return refused('moving', { t, yes, get: true });
  }
}

/**
 * Pressing the button: the answer saved (./_advisory-mail.js answerFromLink). A link that can't take one says what
 * opening it says; anything else that stopped it, the table setup included, is said in words with the press kept to
 * make again. Nothing here answers with a raw error
 */
export async function onRequestPost(context) {
  const { env, request } = context;
  const form = await request.formData().catch(() => null);
  const answer = form?.get('do') === 'yes' ? 'yes' : 'no';
  const t = String(form?.get('t') || '');
  const note = String(form?.get('note') || '');
  try {
    await ensureAdvisory(env.DB);
    const r = await answerFromLink(env.DB, t, { answer, note });
    if (r.notice) {
      // (owed in the answer's own write, naming the person that very write was guarded on: sent now, else by the heartbeat)
      const told = sendNotice(env, r.notice);
      if (context.waitUntil) context.waitUntil(told); else await told;
    }
    return page('Thank you', `<h1>Thank you</h1><p>${answer === 'yes' ? 'We’ll be in touch.' : 'Thanks for letting us know.'}</p>`);
  } catch (e) {
    if (e.why) return refused(e.why, { t, yes: answer === 'yes', note });
    console.error('[advisory-action]', e?.message || e);
    return refused('moving', { t, yes: answer === 'yes', note });
  }
}
