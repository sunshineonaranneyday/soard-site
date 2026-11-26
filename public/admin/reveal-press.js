/**
 * The press release in the admin (Peter, Nov 24 2026: "when a reveal is comfirmed i need a press release drafted
 * ... there should be a place to add the emails for the press release and it should come from linzi in her gmail").
 *
 *   <PressReleaseCard addToast=${…} upcoming=${…} />  Reveals → Invites: on/off, the press list, who it's from,
 *                                                       the words every press release carries, and a preview
 *   pressStep(r, { press, invites })                   the Press release step on each reveal on Reveals → Now
 *   draftPress(r)                                      its Draft button
 *
 * Server: functions/api/reveal-press-admin.js, functions/api/_reveal-press.js.
 */
import { h, htm, useState, useEffect, useRef } from './vendor.js';
import { useDialog } from './dialog.js';
import { EmailFrame, WidthSwitch } from './email-sheet.js';
import { parseList } from './press-list-shared.js';

const html = htm.bind(h);
const API = '/api/reveal-press-admin';

const CSS = `
.rp { display: grid; gap: 1.1rem; }
.rp > .ri-status { margin: 0; }
.rp-section { display: grid; gap: 0.6rem; padding-top: 1.1rem; border-top: 1px solid var(--color-border); min-width: 0; }
.rp-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 0.25rem 1rem; }
.rp-head h4 { margin: 0; font-size: var(--fs-base); }
.rp-head span { font-size: var(--fs-xs); color: var(--color-text-muted); }
.rp-list { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 0.4rem; max-height: 15.5rem; overflow: auto; }
.rp-chip { display: inline-flex; align-items: center; gap: 0.35rem; max-width: 100%; min-width: 0; padding: 0.2rem 0.25rem 0.2rem 0.65rem; border: 1px solid var(--color-border); border-radius: 999px; background: var(--color-bg-secondary); font-size: var(--fs-xs); line-height: 1.4; }
.rp-chip__text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rp-chip__text small { color: var(--color-text-muted); font-size: inherit; margin-left: 0.3rem; }
.rp-chip button { all: unset; cursor: pointer; flex: none; width: 22px; height: 22px; display: grid; place-items: center; border-radius: 50%; color: var(--color-text-muted); font-size: var(--fs-sm); }
.rp-chip button:hover { background: var(--color-bg-hover); color: var(--color-text); }
.rp-chip button:focus-visible { box-shadow: var(--focus-ring); }
.rp-empty { margin: 0; font-size: var(--fs-sm); color: var(--color-text-secondary); }
.rp-add { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0.6rem; align-items: start; }
.rp-add .form-textarea { min-height: 2.75rem; resize: vertical; }
.rp-words > summary { cursor: pointer; font-weight: 600; font-size: var(--fs-sm); list-style: none; display: flex; align-items: center; gap: 0.45rem; width: fit-content; }
.rp-words > summary::-webkit-details-marker { display: none; }
.rp-words > summary::before { content: ''; width: 6px; height: 6px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: rotate(-45deg); transition: transform var(--m-quick, 150ms) ease; }
.rp-words[open] > summary::before { transform: rotate(45deg); }
.rp-words > summary:focus-visible { outline: none; box-shadow: var(--focus-ring); border-radius: 4px; }
.rp-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0 1rem; margin-top: 0.9rem; }
.rp-grid .rp-wide { grid-column: 1 / -1; }
.rp-grid .form-group { margin-bottom: 0.9rem; min-width: 0; }
.rp-note { margin: 0; font-size: var(--fs-xs); color: var(--color-text-secondary); line-height: 1.5; }
.rp-note.is-warn { color: var(--tone-warn-fg); }
.rp-sheet { width: min(860px, 100%); }
.rp-sheet-body { overflow: auto; padding: 1rem 1.25rem 1.25rem; display: grid; gap: 0.85rem; }
.rp-sheet-tools { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.6rem 1rem; }
.rp-sheet-tools label { display: inline-flex; align-items: center; gap: 0.5rem; font-size: var(--fs-sm); }
.rp-sheet .mm-frame-wrap { max-width: 720px; background: #FFFFFF; }
.rp-sheet .mm-frame { background: #FFFFFF; }
.rp-sheet-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 0.6rem; padding: 0.85rem 1.25rem; border-top: 1px solid var(--color-border); }
.rp-bcc { line-height: 1.5; max-height: 6em; overflow: auto; }
@media (max-width: 900px) { .rp-grid { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 600px) { .rp-add { grid-template-columns: minmax(0, 1fr); } }
@media (pointer: coarse) { .rp-chip button { width: 36px; height: 36px; } }
`;
if (typeof document !== 'undefined' && !document.getElementById('reveal-press-css')) {
  const st = document.createElement('style');
  st.id = 'reveal-press-css';
  st.textContent = CSS;
  document.head.appendChild(st);
}

const firstName = (name, email = '') => String(name || '').trim().split(/\s+/)[0] || String(email || '').split('@')[0] || 'the sender';
const people = (n) => `${n} ${n === 1 ? 'person' : 'people'}`;
const when = (iso) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Addresses as people paste them, read as the server reads them, so the page shows what will be saved */
export const parseAddresses = (text) => parseList(text);

// ─── Reveals → Now: the step on each reveal ─────────────────────────

/** The Press release step for one reveal: { key, label, state, text, link?, draft?, kind } */
export function pressStep(r, { press = null, invites = {} } = {}) {
  const p = r.press;
  const first = firstName(press?.name, press?.from);
  const step = { key: 'press', label: `Press release in ${first}’s Gmail`, kind: 'press' };
  const open = p?.link ? { href: p.link, label: p.state === 'sent' ? 'Open in Gmail ↗' : `Open in ${first}’s Gmail ↗` } : null;
  if (r.test) return { ...step, state: 'off', text: 'Never for a rehearsal' };
  if (r.kidUrl && !r.slug) return { ...step, state: 'off', text: 'Only for kids’ reveals' };
  if (p?.state === 'sent') return { ...step, state: 'done', text: `Sent from Gmail${p.sentAt ? ` ${when(p.sentAt)}` : ''}${p.count ? ` to ${people(p.count)}` : ''}`, link: open };
  if (p?.state === 'edited') return { ...step, state: 'wait', text: `Edited in Gmail, so JobTread changes won’t rewrite it: ${first} is emailed them instead. Waiting for it to be sent`, link: open };
  if (p?.state === 'draft') {
    if (p.error) return { ...step, state: 'warn', text: p.error, link: open };
    return { ...step, state: 'wait', link: open, text: r.confirmed && r.time
      ? `In ${first}’s drafts${p.count ? `, to the ${people(p.count)} on the press list` : ''}. Waiting for ${first} to read it over and send it`
      : 'Drafted early, so the time says “to be confirmed”. It fills in by itself once JobTread confirms' };
  }
  if (p?.state === 'gone') return { ...step, state: 'off', text: `Deleted from ${first}’s drafts, so the site won’t make another`, draft: 'Draft it again' };
  if (press && press.enabled === false) return { ...step, state: 'off', text: 'Switched off in Reveals → Invites → Press release' };
  if (!r.preview) return { ...step, state: 'off', text: `No press release while the job is ${r.status || 'in this status'}` };
  if (!invites.enabled) return { ...step, state: 'wait', text: 'Waits for reveal invites to be turned on (Reveals → Invites)' };
  if (!r.slug) return { ...step, state: 'warn', text: 'No kid page matches this job, so there’s nothing to fill it from' };
  if (!r.pageReady) return { ...step, state: 'warn', text: `Waiting for ${r.name}’s kid page to be published` };
  if (p?.error) return { ...step, state: 'warn', text: p.error, draft: 'Try again' };
  return { ...step, state: 'wait', draft: 'Draft press release', text: r.confirmed && r.time
    ? `Drafts itself in ${first}’s Gmail within 5 minutes, or draft it now`
    : `Drafts itself in ${first}’s Gmail once JobTread confirms the reveal with a time, or draft it now (the time then says “to be confirmed”)` };
}

/** Draft a reveal's press release now → { ok, message } for a toast */
export async function draftPress(r) {
  try {
    const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: r.jobId }) });
    const d = await res.json().catch(() => ({}));
    if (!d.ok) return { ok: false, message: d.error || d.reason || `Couldn’t draft it (${res.status})` };
    if (d.press === 'drafted') return { ok: true, message: `${r.name}’s press release is in the sender’s Gmail drafts${d.told === false ? '. The email telling them hasn’t gone yet; the site keeps trying' : ', and they were emailed'}` };
    return { ok: true, message: `${r.name}’s press release is already in Gmail` };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

// ─── Reveals → Invites: the card ────────────────────────────────────

const WORDS = [
  { key: 'called', label: 'What it’s called', hint: 'At the top and in the subject.', wide: true, max: 40 },
  { key: 'contactName', label: 'Media contact', hint: 'Empty: the sender’s name in Google.', max: 80 },
  { key: 'contactTitle', label: 'Their title', max: 120 },
  { key: 'contactPhone', label: 'Their phone', hint: 'Empty: SOARD’s phone in Site Config.', max: 40 },
  { key: 'arrival', label: 'Under WHEN', wide: true, max: 300 },
  { key: 'interviews', label: 'Interviews available with', hint: 'One per line. {name} is the kid’s name.', area: 3, wide: true, max: 600 },
  { key: 'photosOffer', label: 'After the interviews', area: 2, wide: true, max: 400 },
  { key: 'why', label: 'WHY', area: 3, wide: true, max: 800 },
  { key: 'about', label: 'ABOUT SUNSHINE ON A RANNEY DAY', area: 5, wide: true, max: 1500 },
];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function PressReleaseCard({ addToast, upcoming = [] }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [draft, setDraft] = useState(null);
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState('');
  const [preview, setPreview] = useState(null);
  const load = async () => {
    try {
      const res = await fetch(API, { cache: 'no-store' });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || 'Couldn’t load the press release settings');
      setD(j); setDraft(j.settings); setErr('');
    } catch (e) { setErr(e.message); }
  };
  useEffect(() => { load(); }, []);

  if (err && !d) return html`<div class="card"><h3>Press release</h3><p class="ri-meta ri-warn">Couldn’t load: ${err} <button class="bc-link" type="button" onClick=${load}>Try again</button></p></div>`;
  if (!d || !draft) return html`<div class="card"><h3>Press release</h3><div style="text-align:center;padding:1.25rem"><span class="spinner" /></div></div>`;

  const saved = d.settings;
  const dirty = !same({ ...draft, enabled: saved.enabled }, saved);
  const choice = (d.choices || []).find((c) => c.email === draft.from || (c.aliases || []).includes(draft.from));
  const senderName = choice?.name || d.sender?.name || '';
  const first = firstName(senderName, draft.from);
  const kids = upcoming.filter((r) => r.slug && !r.test && r.preview);
  const set = (k, v) => setDraft((x) => ({ ...x, [k]: v }));
  const found = parseAddresses(paste);
  const fresh = found.filter((p) => !draft.list.some((x) => x.email === p.email));

  const save = async (patch, quiet = false) => {
    setBusy(patch.enabled !== undefined ? 'switch' : 'save');
    try {
      const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: patch }) });
      const j = await res.json().catch(() => ({}));
      if (!j.ok) throw new Error(j.error || `Couldn’t save (${res.status})`);
      setD((x) => ({ ...x, settings: j.settings }));
      setDraft((x) => (patch.enabled !== undefined ? { ...x, enabled: j.settings.enabled } : j.settings));
      if (!quiet) addToast(patch.enabled === undefined ? 'Saved. Drafts nobody has changed in Gmail take it on their next look' : j.settings.enabled ? 'Press releases are on' : 'Press releases are paused', 'success');
    } catch (e) { addToast(e.message, 'error'); }
    setBusy('');
  };
  const addPasted = () => {
    if (!fresh.length) return;
    set('list', [...draft.list, ...fresh]);
    setPaste('');
  };

  return html`<div class="card rp">
    <div class="ri-status">
      <div class="ri-status__main">
        <span class=${'ri-dot' + (saved.enabled ? ' ri-dot--on' : '')} aria-hidden="true"></span>
        <div>
          <h3>${saved.enabled ? 'Press releases are on' : 'Press releases are paused'}</h3>
          <p class="ri-meta">When JobTread confirms a reveal with a time, the site drafts the press release in ${senderName || first}’s Gmail (${saved.from}), with the press list in Bcc so no outlet sees the others. ${first} reads it over and sends it from Gmail; the site never sends it.</p>
          ${!d.google ? html`<p class="ri-meta ri-warn">The Google key is missing in Cloudflare, so nothing can be drafted.</p>` : null}
          ${d.sender?.error ? html`<p class="ri-meta ri-warn">${d.sender.error}</p>` : null}
        </div>
      </div>
      <button class=${'btn ' + (saved.enabled ? 'btn-ghost' : 'btn-primary')} type="button" disabled=${!!busy} onClick=${() => save({ enabled: !saved.enabled })}>
        ${busy === 'switch' ? html`<span class="spinner" />` : saved.enabled ? 'Pause' : 'Turn on'}
      </button>
    </div>

    <div class="rp-section">
      <div class="rp-head"><h4>Press list</h4><span>${draft.list.length ? `${people(draft.list.length)}, in Bcc` : 'In Bcc'}</span></div>
      ${draft.list.length ? html`<ul class="rp-list" aria-label="Press list">
        ${draft.list.map((p) => html`<li class="rp-chip" key=${p.email}>
          <span class="rp-chip__text" title=${p.name ? `${p.name} <${p.email}>` : p.email}>${p.name ? html`${p.name}<small>${p.email}</small>` : p.email}</span>
          <button type="button" aria-label=${`Take ${p.name || p.email} off the press list`} onClick=${() => set('list', draft.list.filter((x) => x.email !== p.email))}>×</button>
        </li>`)}
      </ul>` : html`<p class="rp-empty">No one yet. Paste the addresses below: one or many, even a whole To line copied from an email.</p>`}
      <div class="rp-add">
        <label class="sr-only" for="rp-paste">Add addresses to the press list</label>
        <textarea id="rp-paste" class="form-textarea" rows="2" value=${paste} placeholder="Paste addresses, like: Ross, Kaitlyn <ksross@example.com>, news@example.com"
          onInput=${(e) => setPaste(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addPasted(); } }} />
        <button class="btn btn-ghost" type="button" disabled=${!fresh.length} onClick=${addPasted}>${fresh.length ? `Add ${fresh.length}` : 'Add'}</button>
      </div>
      ${paste.trim() ? html`<p class="rp-note" aria-live="polite">${!found.length ? 'No email addresses in that yet.' : fresh.length === found.length ? `${people(found.length)} to add.` : `${people(fresh.length)} to add; ${found.length - fresh.length} already on the list.`}</p>` : null}
    </div>

    <details class="rp-section rp-words">
      <summary>Who it’s from, and the words every press release carries</summary>
      <div class="rp-grid">
        <label class="form-group rp-wide" for="rp-from">
          <span class="form-label">From</span>
          <select id="rp-from" class="form-select" style="display:block;width:100%;max-width:420px" value=${draft.from} onChange=${(e) => set('from', e.currentTarget.value)}>
            ${!(d.choices || []).some((c) => c.email === draft.from) ? html`<option value=${draft.from}>${choice?.name ? `${choice.name} (${draft.from})` : draft.from}</option>` : null}
            ${(d.choices || []).map((c) => html`<option value=${c.email} key=${c.email}>${c.name ? `${c.name} (${c.email})` : c.email}</option>`)}
          </select>
          <span class="form-hint">Drafted in this person’s own Gmail, with their Gmail signature, for them to send.</span>
        </label>
        ${WORDS.map((w) => html`<label class=${`form-group${w.wide ? ' rp-wide' : ''}`} for=${`rp-${w.key}`} key=${w.key}>
          <span class="form-label">${w.label}</span>
          ${w.area ? html`<textarea id=${`rp-${w.key}`} class="form-textarea" rows=${w.area} maxlength=${w.max} value=${draft[w.key] || ''} placeholder=${d.defaults[w.key] || ''} onInput=${(e) => set(w.key, e.target.value)} />`
            : html`<input id=${`rp-${w.key}`} class="form-input" maxlength=${w.max} value=${draft[w.key] || ''} placeholder=${w.key === 'contactName' ? senderName : w.key === 'contactPhone' ? d.orgPhone || '' : d.defaults[w.key] || ''} onInput=${(e) => set(w.key, e.target.value)} />`}
          ${w.hint ? html`<span class="form-hint">${w.hint}</span>` : null}
        </label>`)}
        <p class="rp-note rp-wide">The rest comes from each reveal: the headline and WHAT from the kid’s page (the few sentences about the kid are put in press words from the page’s story), WHEN, WHERE and the parking notes from JobTread, and two of the kid’s photos.</p>
      </div>
    </details>

    <div class="ri-savebar" style="margin-top:0">
      <button class="btn btn-primary" type="button" disabled=${!dirty || !!busy} onClick=${() => save({ from: draft.from, list: draft.list, ...Object.fromEntries(WORDS.map((w) => [w.key, draft[w.key] ?? ''])) })}>
        ${busy === 'save' ? html`<span class="spinner" /> Saving…` : 'Save'}
      </button>
      ${dirty ? html`<button class="btn btn-ghost" type="button" disabled=${!!busy} onClick=${() => { setDraft(saved); setPaste(''); }}>Undo changes</button>` : null}
      ${kids.length ? html`<button class="btn btn-ghost" type="button" onClick=${() => setPreview(kids[0].jobId)}>Preview ${kids[0].name}’s press release</button>` : null}
      <span class="ri-meta">${dirty ? 'Not saved yet.' : 'An untouched draft in Gmail takes a new press list or new words by itself.'}</span>
    </div>
    ${preview ? html`<${PressPreview} jobId=${preview} kids=${kids} dirty=${dirty} onPick=${setPreview} onClose=${() => setPreview(null)} addToast=${addToast} />` : null}
  </div>`;
}

/** The press release for one reveal as it would be drafted now, in a sheet */
function PressPreview({ jobId, kids, dirty, onPick, onClose, addToast }) {
  const box = useRef(null);
  const [p, setP] = useState(null);
  const [err, setErr] = useState('');
  const [phone, setPhone] = useState(false);
  const [busy, setBusy] = useState(false);
  useDialog(box, onClose, busy);
  useEffect(() => {
    let live = true;
    setP(null); setErr('');
    (async () => {
      try {
        const res = await fetch(`${API}?preview=${encodeURIComponent(jobId)}`, { cache: 'no-store' });
        const j = await res.json();
        if (!live) return;
        if (!j.ok) throw new Error(j.error || 'Couldn’t build it');
        setP(j);
      } catch (e) { if (live) setErr(e.message); }
    })();
    return () => { live = false; };
  }, [jobId]);
  const kid = kids.find((k) => k.jobId === jobId) || { jobId, name: p?.name || 'This kid' };
  const first = firstName(p?.from?.name, p?.from?.email);
  // Her Gmail signature's pictures live on Google's servers, which the admin doesn't load (its CSP), so here a line
  // stands where Gmail shows the signature
  const sigLine = `<p style="margin:18px 0 0;font:13px Arial,Helvetica,sans-serif;color:#80817A;">${first.replace(/[<>&"]/g, '')}’s Gmail signature goes here, as Gmail shows it.</p>`;
  const body = p ? String(p.html).replace(/<br><div class="gmail_signature">[\s\S]*$/, '') + (p.signature ? sigLine : '') : '';
  const doc = p ? `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank"><style>body{margin:0;padding:20px 22px;background:#fff}img{max-width:100%;height:auto}</style></head><body>${body}</body></html>` : '';
  const draftNow = async () => {
    setBusy(true);
    const out = await draftPress(kid);
    addToast(out.message, out.ok ? 'success' : 'error');
    setBusy(false);
    if (out.ok) onClose();
  };
  return html`<div class="mm-sheet-wrap" onClick=${(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <div class="mm-sheet rp-sheet" role="dialog" aria-modal="true" aria-labelledby="rp-title" tabindex="-1" ref=${box}>
      <div class="mm-sheet-head">
        <div>
          <h3 id="rp-title">${kid.name}’s press release</h3>
          <p>As it would be drafted in Gmail now${dirty ? ', with the settings as last saved' : ''}. Nothing is drafted or sent from here unless you press Draft.</p>
        </div>
        <button type="button" class="mm-sheet-x" aria-label="Close" onClick=${onClose}>×</button>
      </div>
      ${err ? html`<p class="rp-note is-warn" role="alert" style="margin:1rem 1.25rem;">${err}</p>`
        : !p ? html`<p class="rp-note" style="margin:1rem 1.25rem;"><span class="spinner spinner-12" /> Putting it together from JobTread and ${kid.name}’s page…</p>`
        : html`<dl class="mm-env">
            <dt>From</dt><dd>${p.from.name ? `${p.from.name} <${p.from.email}>` : p.from.email}</dd>
            <dt>To</dt><dd>${p.from.email} (the sender, so the press list can go in Bcc)</dd>
            <dt>Bcc</dt><dd class="rp-bcc">${p.bcc.length ? p.bcc.map((x) => x.name ? `${x.name} <${x.email}>` : x.email).join(', ') : html`<span class="ri-warn">No one yet: add the press list first</span>`}</dd>
            <dt>Subject</dt><dd class="mm-env-subject">${p.subject}</dd>
          </dl>
          <div class="rp-sheet-body">
            <div class="rp-sheet-tools">
              ${kids.length > 1 ? html`<label>Reveal <select class="form-select" value=${jobId} onChange=${(e) => onPick(e.currentTarget.value)}>${kids.map((k) => html`<option value=${k.jobId} key=${k.jobId}>${k.name}</option>`)}</select></label>` : html`<span></span>`}
              <${WidthSwitch} phone=${phone} setPhone=${setPhone} />
            </div>
            ${!p.confirmed || !p.time ? html`<p class="rp-note">JobTread hasn’t confirmed this reveal with a time yet, so the time says “to be confirmed”. The real draft is made once it does.</p>` : null}
            ${p.storyBy === 'page' ? html`<p class="rp-note">The sentences about ${kid.name} are the kid page’s own summary.</p>` : null}
            ${!p.signature ? html`<p class="rp-note">${first}’s Gmail signature goes under it in the real draft.</p>` : null}
            <${EmailFrame} doc=${doc} phone=${phone} title=${`${kid.name}’s press release`} />
          </div>
          <div class="rp-sheet-foot">
            <button class="btn btn-ghost" type="button" onClick=${onClose}>Close</button>
            <button class="btn btn-primary" type="button" disabled=${busy} onClick=${draftNow}>${busy ? html`<span class="spinner" /> Drafting…` : `Draft it in ${first}’s Gmail now`}</button>
          </div>`}
    </div>
  </div>`;
}
