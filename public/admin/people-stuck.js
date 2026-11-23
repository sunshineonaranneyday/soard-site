/**
 * People's note at the top: a change of web address that couldn't finish by itself, and a button for each way to settle it
 * ===================================================================================================================
 * A rename moves the person's record at once; their board records and Advisory Board page records follow right after
 * (functions/api/_rename-finish.js). One that can't follow as things stand (someone else at the old address now, or the
 * person no longer at the new one) waits for a person: until then neither address is given to anyone. This note says
 * what happened, why it stopped and what's still at the old address, by kind, and settles it (Peter's rules: decisions
 * live in the admin, inside an existing page, in plain words), each button asked first in the admin's own dialog:
 *   Move them to <to>     only while the person is at <to>: everything at <from> moves there, as a rename moves it
 *   Leave them at <from>  they stay with whoever is at <from>, or with nobody
 * The server (functions/api/rename-settle.js) does it, resolves the Needs attention post and writes the audit log.
 * Staff only, as People's rename is.
 */
import { h, htm, useState, useEffect, useRef } from './vendor.js';
import { ask } from './ask.js';

const html = htm.bind(h);
const API = '/api/rename-settle';
const q = (slug) => `“${slug}”`;
const NO_ANSWER = 'The site didn’t answer. Reload People to see whether it went through.';

async function call(body = null) {
  let r;
  try {
    r = await fetch(API, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
  } catch {
    return { success: false, error: 'No connection. Check your internet and try again.' };
  }
  let j = null;
  try { j = await r.json(); } catch { j = null; }
  if (!j || typeof j !== 'object') return { success: false, error: NO_ANSWER };
  if (!r.ok) j.success = false;
  if (!j.success && !j.error) j.error = NO_ANSWER;
  return j;
}

/**
 * The note's words, and each button's question, for one stuck rename ({ from, to, name, here, other, left }, as
 * /api/rename-settle lists it)
 */
export function stuckWords(s) {
  const who = s.name || 'Someone';
  const them = s.name || 'the person';
  const list = s.left?.length ? s.left.join(', ') : '';
  const still = s.left == null ? `The site couldn’t count what’s still at ${q(s.from)} just now.`
    : list ? `Still at ${q(s.from)}: ${list}.` : `The site found nothing of theirs still at ${q(s.from)}.`;
  const lead = s.left?.length === 0
    ? `${who}’s web address was changed from ${q(s.from)} to ${q(s.to)}, but that change didn’t finish.`
    : `${who}’s web address was changed from ${q(s.from)} to ${q(s.to)}, but some of their records are still at ${q(s.from)}.`;
  const why = s.other && !s.here ? `It stopped because someone else, ${s.other}, is at ${q(s.from)} now, and ${them} isn’t at ${q(s.to)} any more.`
    : s.other ? `It stopped because someone else, ${s.other}, is at ${q(s.from)} now, so the site can’t tell whose they are.`
      : !s.here ? `It stopped because ${them} isn’t at ${q(s.to)} any more.`
        : 'It stopped partway, and it won’t try again by itself.';
  const move = {
    title: `Move them to ${q(s.to)}?`,
    text: s.other
      ? `${s.other} is at ${q(s.from)} now, so anything of theirs there moves to ${them} at ${q(s.to)} too. ${still}`
      : `Everything still at ${q(s.from)} moves to ${them} at ${q(s.to)}. ${still}`,
    yes: `Move them to ${q(s.to)}`,
  };
  const leave = {
    title: `Leave them at ${q(s.from)}?`,
    text: `${s.other ? `They stay at ${q(s.from)}, with ${s.other}, who is at that address now.` : `They stay at ${q(s.from)}, with nobody: nobody is at that address on People now.`}${s.here ? ` Nothing moves to ${them} at ${q(s.to)}.` : ''} ${still}`,
    yes: `Leave them at ${q(s.from)}`,
  };
  return { lead, why, still, move, leave };
}

const ALERT = html`<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>`;

/**
 * Where the keyboard's focus goes once a note is settled (Advisory Board QA round 20, rule 8): the next note's first
 * button, else People's heading (made focusable, tabindex -1, never a Tab stop), never the page body. A note still
 * there (the settle refused) gets its own button back
 */
function focusAfter(want) {
  if (!want) return false;
  const note = want.from ? document.querySelector(`.ppl-stuck[data-from="${CSS.escape(want.from)}"]`) : null;
  const button = note && ((want.choice && note.querySelector(`[data-settle="${want.choice}"]`)) || note.querySelector('button'));
  if (button && !button.disabled) { button.focus(); return document.activeElement === button; }
  if (want.from) return false;
  // (People's heading: the first heading after its tabs, the page's own)
  const tabs = document.querySelector('.ppl-stucks ~ .hub-tabs') || document.querySelector('.hub-tabs');
  const heading = [...document.querySelectorAll('.main h1, .main h2')].find((x) => !x.classList.contains('sr-only') && tabs && (tabs.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING));
  if (!heading) return false;
  if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
  heading.focus();
  return document.activeElement === heading;
}

/** The notes, one for each stuck rename (none: nothing shown). onChanged: People's list to read again after one is settled */
export function StuckRenames({ addToast = () => {}, onChanged = () => {} }) {
  const [list, setList] = useState([]);
  const [busy, setBusy] = useState(null); // `${from}:${choice}`
  // What was done, in the note's own words, for a screen reader (a polite status line that stays on the page)
  const [said, setSaid] = useState('');
  const want = useRef(null);
  // (a list that didn't load shows nothing new: the Needs attention post still says it)
  const load = async () => { const j = await call(); if (j.success && Array.isArray(j.stuck)) setList(j.stuck); };
  useEffect(() => { load(); }, []);
  // (after each change the page draws: the focus where it belongs, tried again a moment later, as People's list is read
  // again and redrawn after a settle)
  useEffect(() => {
    if (!want.current) return undefined;
    const target = want.current;
    target.tries ||= 0;
    let timer = null;
    const go = () => {
      if (want.current !== target) return;
      // (placed once, then put back only if a redraw dropped it to the page: never taken from where someone moved it)
      const lost = !document.activeElement || document.activeElement === document.body;
      if (!target.placed || lost) target.placed = focusAfter(target) || target.placed;
      if (++target.tries < 14) timer = setTimeout(go, 120); else want.current = null;
    };
    timer = setTimeout(go, 0);
    return () => clearTimeout(timer);
  });

  const settle = async (s, choice) => {
    const w = stuckWords(s);
    if (!(await ask({ ...w[choice], no: 'Cancel', careful: true }))) return;
    setBusy(`${s.from}:${choice}`);
    const j = await call({ from: s.from, at: s.at, choice });
    if (j.success) {
      const at = list.findIndex((x) => x.from === s.from);
      const rest = list.filter((x) => x.from !== s.from);
      const next = rest[at] || rest[at - 1] || null;
      want.current = next ? { from: next.from } : { heading: true };
      setList(rest);
      setSaid(j.said || 'Settled.');
      addToast(j.said || 'Settled.', 'success');
      onChanged();
    } else {
      want.current = { from: s.from, choice };
      addToast(j.error, 'error');
    }
    setBusy(null);
    load();
  };

  const status = html`<p class="sr-only" role="status" aria-live="polite">${said}</p>`;
  if (!list.length) return html`<div class="ppl-stucks ppl-stucks--none">${status}</div>`;
  return html`<div class="ppl-stucks">${status}${list.map((s) => {
    const w = stuckWords(s);
    const doing = busy?.startsWith(`${s.from}:`) ? busy.slice(s.from.length + 1) : null;
    return html`<div class="notice notice--warn ppl-stuck" key=${s.from} role="status" data-from=${s.from}>
      ${ALERT}
      <div class="notice__body">
        <strong>${w.lead}</strong> ${w.why}
        ${s.left?.length ? html`<p class="ppl-stuck__k">Still at ${q(s.from)}:</p>
          <ul class="ppl-stuck__left">${s.left.map((x) => html`<li key=${x}>${x}</li>`)}</ul>`
          : html`<p class="ppl-stuck__k">${w.still}</p>`}
      </div>
      <div class="notice__actions">
        ${s.here ? html`<button type="button" class="btn btn-primary" data-settle="move" disabled=${!!busy} onClick=${() => settle(s, 'move')}>
          ${doing === 'move' ? html`<span class="spinner spinner-14" /> Moving…` : `Move them to ${q(s.to)}`}</button>` : null}
        <button type="button" class="btn btn-ghost" data-settle="leave" disabled=${!!busy} onClick=${() => settle(s, 'leave')}>
          ${doing === 'leave' ? html`<span class="spinner spinner-14" /> Saving…` : `Leave them at ${q(s.from)}`}</button>
      </div>
    </div>`;
  })}</div>`;
}
