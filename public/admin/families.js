/**
 * Admin → Families (#families, #families/<JobTread account id>)
 * ===========================================================================
 * Every makeover family in one place (Peter, Nov 25 2026): the people we can
 * reach (from their JobTread customer, the record), their home, their kid
 * pages, and the private link that lets them check it all themselves
 * (/family-update/). Loaded on first visit, like ./demo-invites.js.
 *
 *  - The list: search, what's waiting (someone a family asked us to take off, an
 *    address they sent), and where each family's link stands. Pick families and
 *    email them their links (up to 25 at a time); a family with no email address
 *    says so and can't be picked.
 *  - A family: their people, edited in place and written straight to JobTread
 *    (add someone, change an email, take someone off), the address on file and
 *    any they sent, their link (email it, or copy one to text them), and every
 *    change they or staff made.
 * Server: /api/families-admin (functions/api/families-admin.js, _families.js).
 */

import { h, htm, useState, useEffect, useMemo, useRef, useCallback } from './vendor.js';
import { ask } from './ask.js';
import { useDialog } from './dialog.js';

const html = htm.bind(h);
const API = '/api/families-admin';
const JT = (id) => `https://app.jobtread.com/customers/${id}`;
const MAX_SEND = 25;
const RELATIONSHIPS = ['Mother', 'Father', 'Stepmother', 'Stepfather', 'Grandmother', 'Grandfather', 'Guardian', 'Aunt', 'Uncle', 'Sibling', 'Caregiver', 'Family friend'];

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const when = (iso) => {
  if (!iso) return '';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} hr ago`;
  return day(iso);
};
const phoneText = (s) => {
  const d = String(s || '').replace(/\D/g, '');
  const ten = d.length === 11 && d[0] === '1' ? d.slice(1) : d;
  return ten.length === 10 ? `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}` : String(s || '');
};
const addressText = (a) => (!a ? '' : [a.line1, a.line2, [a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', '));
const childOf = (f) => {
  const names = [...new Set((f.kids || []).map((k) => k.name).filter(Boolean))];
  if (names.length) return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return String(f.name || '').replace(/\(\d{4}\)/g, '').trim();
};
const hasEmail = (f) => (f.contacts || []).some((c) => /\S+@\S+\.\S+/.test(c.email || ''));
const who = (by) => (!by ? '' : by === 'family' ? 'The family' : String(by).split('@')[0].split(/[._+-]/)[0].replace(/^\w/, (c) => c.toUpperCase()));

/** Where a family's link stands, in words and a tone */
function linkWords(l) {
  if (!l) return { text: 'Not asked yet', tone: 'muted' };
  switch (l.state) {
    case 'answered': return { text: `Answered ${when(l.answeredAt)}`, tone: 'on' };
    case 'opened': return { text: `Opened ${when(l.openedAt)}`, tone: 'ready' };
    case 'sent': return { text: `Emailed ${when(l.sentAt)}`, tone: 'ready' };
    case 'expired': return { text: `Link expired ${day(l.expiresAt)}`, tone: 'muted' };
    default: return { text: `Link made ${when(l.createdAt)}`, tone: 'muted' };
  }
}
const FILTERS = [
  ['all', 'All'],
  ['waiting', 'Needs a look'],
  ['not-asked', 'Not asked yet'],
  ['asked', 'Asked, no answer'],
  ['answered', 'Answered'],
  ['no-email', 'No email'],
];
const inFilter = (f, key) => {
  const st = f.link?.state;
  switch (key) {
    case 'waiting': return f.removals > 0 || !!f.mailing;
    case 'not-asked': return !f.link || st === 'made';
    case 'asked': return st === 'sent' || st === 'opened' || st === 'expired';
    case 'answered': return st === 'answered';
    case 'no-email': return !hasEmail(f);
    default: return true;
  }
};

const STYLES = `
  .fam { display: grid; gap: 1rem; }
  .fam > .card { margin-bottom: 0; }
  .fam h3 { margin: 0; font-size: var(--fs-md); }
  .fam-meta { margin: 0.25rem 0 0; color: var(--color-text-secondary); font-size: var(--fs-sm); line-height: 1.5; overflow-wrap: anywhere; }
  .fam-muted { color: var(--color-text-muted); }
  .fam-warn { color: var(--tone-warn-fg); }
  .fam-chip { display: inline-flex; align-items: center; min-height: 20px; padding: 0.1rem 0.5rem; border-radius: 999px; font-size: var(--fs-2xs); font-weight: 600; line-height: 1.35; white-space: nowrap; background: var(--tone-neutral-bg); color: var(--tone-neutral-fg); }
  .fam-chip--on { background: var(--tone-success-bg); color: var(--tone-success-fg); }
  .fam-chip--ready { background: var(--tone-info-bg); color: var(--tone-info-fg); }
  .fam-chip--warn { background: var(--tone-warn-bg); color: var(--tone-warn-fg); box-shadow: inset 0 0 0 1px var(--tone-warn-line); }
  .fam-chip--muted { color: var(--color-text-muted); }
  .fam-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem 0.75rem; }
  .fam-bar .search-bar { flex: 1 1 16rem; max-width: 22rem; }
  .fam-filters { display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .fam-filter { border: 1px solid var(--color-border); background: var(--color-bg-card); border-radius: 999px; padding: 0.3rem 0.75rem; font-size: var(--fs-xs); font-weight: 600; color: var(--color-text-secondary); cursor: pointer; min-height: 32px; }
  .fam-filter[aria-pressed="true"] { background: var(--color-text); border-color: var(--color-text); color: var(--color-bg-card); }
  .fam-filter:focus-visible, .fam-row:focus-visible, .fam-linkbtn:focus-visible { outline: none; box-shadow: var(--focus-ring-strong); }
  .fam-filter span { margin-left: 0.35rem; opacity: 0.75; font-variant-numeric: tabular-nums; }
  .fam-sendbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.6rem 1rem; padding: 0.75rem 1rem; border: 1px solid var(--tone-info-line, var(--color-border)); background: var(--tone-info-bg); border-radius: var(--radius-md); }
  .fam-table { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
  .fam-table th { text-align: left; font-size: var(--fs-2xs); font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--color-text-muted); padding: 0.5rem 0.6rem; border-bottom: 1px solid var(--color-border); white-space: nowrap; }
  .fam-table td { padding: 0.7rem 0.6rem; border-bottom: 1px solid var(--color-border); vertical-align: top; }
  .fam-table tr:last-child td { border-bottom: 0; }
  .fam-row { cursor: pointer; }
  .fam-row:hover td { background: var(--color-bg-hover); }
  .fam-pick { width: 2.25rem; }
  .fam-pick input { width: 18px; height: 18px; cursor: pointer; }
  .fam-name { font-weight: 700; }
  .fam-name small { font-weight: 500; color: var(--color-text-muted); margin-left: 0.35rem; }
  .fam-people { display: grid; gap: 0.15rem; }
  .fam-person-line { overflow-wrap: anywhere; }
  .fam-person-line small { color: var(--color-text-muted); }
  .fam-empty { padding: 2.5rem 1rem; text-align: center; color: var(--color-text-secondary); }
  .fam-back { display: inline-flex; align-items: center; gap: 0.35rem; color: var(--color-text-secondary); font-size: var(--fs-sm); text-decoration: none; margin-bottom: 0.25rem; }
  .fam-back:hover { color: var(--color-text); }
  .fam-grid { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 1rem; align-items: start; }
  .fam-col { display: grid; gap: 1rem; }
  .fam-col > .card { margin: 0; }
  .fam-card-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 0.5rem 1rem; margin-bottom: 0.75rem; }
  .fam-contact { border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 0.8rem 0.95rem; background: var(--color-bg-card); }
  .fam-contact + .fam-contact { margin-top: 0.6rem; }
  .fam-contact__head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 0.25rem 0.75rem; }
  .fam-contact__name { font-weight: 700; display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; }
  .fam-contact__facts { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0.15rem 0.75rem; margin: 0.45rem 0 0; font-size: var(--fs-sm); }
  .fam-contact__facts dt { color: var(--color-text-muted); }
  .fam-contact__facts dd { margin: 0; overflow-wrap: anywhere; }
  .fam-edit { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0.6rem 0.75rem; margin-top: 0.6rem; }
  .fam-edit .form-group { margin: 0; }
  .fam-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-top: 0.75rem; }
  .fam-linkbtn { border: 0; background: none; padding: 0.2rem 0; font: inherit; font-size: var(--fs-xs); color: var(--color-text-secondary); text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
  .fam-linkbtn:hover { color: var(--color-text); }
  .fam-linkbtn--danger { color: var(--color-danger); }
  .fam-facts { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0.25rem 0.85rem; margin: 0; font-size: var(--fs-sm); }
  .fam-facts dt { color: var(--color-text-muted); }
  .fam-facts dd { margin: 0; overflow-wrap: anywhere; }
  .fam-callout { border-radius: var(--radius-md); padding: 0.8rem 0.95rem; background: var(--tone-warn-bg); box-shadow: inset 0 0 0 1px var(--tone-warn-line); font-size: var(--fs-sm); }
  .fam-callout + .fam-callout { margin-top: 0.6rem; }
  .fam-callout strong { display: block; margin-bottom: 0.2rem; }
  .fam-history { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.75rem; }
  .fam-history > li { border-left: 2px solid var(--color-border); padding-left: 0.75rem; font-size: var(--fs-sm); }
  .fam-history > li.is-family { border-left-color: var(--color-primary); }
  .fam-history__when { color: var(--color-text-muted); font-size: var(--fs-xs); }
  .fam-history ul { margin: 0.25rem 0 0; padding-left: 1.1rem; }
  .fam-history .fam-problem { color: var(--color-danger); }
  .fam-kids { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.4rem; }
  .fam-kid { display: inline-flex; align-items: center; gap: 0.3rem; border: 1px solid var(--color-border); border-radius: 999px; padding: 0.15rem 0.6rem; font-size: var(--fs-xs); color: var(--color-text); text-decoration: none; background: var(--color-bg-card); }
  .fam-kid:hover { border-color: var(--color-border-strong); }
  .fam-dialog { max-width: 680px; width: 100%; max-height: calc(100vh - 2rem); display: flex; flex-direction: column; background: var(--color-bg-card); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); overflow: hidden; }
  .fam-dialog__head { padding: 1.1rem 1.3rem 0.6rem; }
  .fam-dialog__head h3 { font-size: var(--fs-lg); margin: 0; }
  .fam-dialog__body { padding: 0 1.3rem; overflow: auto; flex: 1; }
  .fam-dialog__foot { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0.6rem; padding: 0.9rem 1.3rem 1.1rem; border-top: 1px solid var(--color-border); }
  .fam-preview { width: 100%; height: 440px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: #F5F4F0; }
  .fam-copy { display: flex; gap: 0.5rem; margin-top: 0.6rem; }
  .fam-copy input { flex: 1; min-width: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: var(--fs-xs); }
  @media (max-width: 960px) { .fam-grid { grid-template-columns: minmax(0, 1fr); } }
  @media (max-width: 700px) {
    .fam-table thead { display: none; }
    .fam-table, .fam-table tbody, .fam-table tr, .fam-table td { display: block; width: 100%; }
    .fam-table tr { border-bottom: 1px solid var(--color-border); padding: 0.5rem 0; position: relative; }
    .fam-table td { border: 0; padding: 0.2rem 0.4rem 0.2rem 2.6rem; }
    .fam-table td.fam-pick { position: absolute; left: 0; top: 0.55rem; width: auto; padding: 0.2rem 0.5rem; }
    .fam-edit { grid-template-columns: minmax(0, 1fr); }
  }
`;

// ─── Talking to the server ──────────────────────────────────────────

async function getJson(query) {
  const res = await fetch(`${API}?${query}`, { cache: 'no-store' });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.ok) throw new Error(d.error || `That didn’t load (${res.status})`);
  return d;
}
async function postJson(body) {
  const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.ok) throw Object.assign(new Error(d.error || `That didn’t work (${res.status})`), { field: d.field });
  return d;
}

// ─── The address: #families or #families/<id> ───────────────────────

const placeOf = () => {
  const m = /^#families\/([A-Za-z0-9]{6,32})\b/.exec(location.hash);
  return m ? m[1] : null;
};

export function FamiliesArea({ addToast = () => {} }) {
  const [open, setOpen] = useState(placeOf);
  useEffect(() => {
    const on = () => { if (/^#families\b/.test(location.hash)) setOpen(placeOf()); };
    window.addEventListener('hashchange', on);
    window.addEventListener('popstate', on);
    return () => { window.removeEventListener('hashchange', on); window.removeEventListener('popstate', on); };
  }, []);
  const go = (id) => { location.hash = id ? `#families/${id}` : '#families'; setOpen(id); window.scrollTo({ top: 0 }); };
  return html`<div class="fam">
    <style>${STYLES}</style>
    ${open ? html`<${FamilyPage} id=${open} addToast=${addToast} onBack=${() => go(null)} />` : html`<${FamilyList} addToast=${addToast} onOpen=${go} />`}
  </div>`;
}

// ─── The email, before it goes ──────────────────────────────────────

function SendDialog({ families, onClose, onSent, addToast }) {
  const box = useRef(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  useDialog(box, onClose, busy);
  const one = families.length === 1 ? families[0] : null;
  useEffect(() => {
    getJson(`preview=${one ? one.id : 'sample'}`).then(setPreview).catch((e) => setPreview({ error: e.message }));
  }, []);
  const send = async () => {
    setBusy(true);
    try {
      let sent = 0;
      const failed = [];
      for (let i = 0; i < families.length; i += MAX_SEND) {
        const d = await postJson({ send: { ids: families.slice(i, i + MAX_SEND).map((f) => f.id) } });
        sent += d.sent;
        for (const r of d.results) if (!r.ok) failed.push(`${childOf(families.find((f) => f.id === r.id) || {})}: ${r.error}`);
      }
      addToast(sent ? `Emailed ${plural(sent, 'family', 'families')} their link` : 'Nothing went out', sent ? 'success' : 'error');
      if (failed.length) addToast(failed.slice(0, 3).join(' · '), 'error');
      onSent();
    } catch (e) { addToast(e.message, 'error'); } finally { setBusy(false); }
  };
  const people = one ? (preview?.to || []) : [];
  return html`<div class="modal-overlay" onClick=${(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <div class="fam-dialog" role="dialog" aria-modal="true" aria-labelledby="fam-send-title" tabindex="-1" ref=${box}>
      <div class="fam-dialog__head">
        <h3 id="fam-send-title">${one ? `Email ${childOf(one)}’s family their link?` : `Email ${plural(families.length, 'family', 'families')} their links?`}</h3>
        <p class="fam-meta">${one
          ? (people.length ? `To ${people.join(', ')}.` : 'To everyone in the family with an email address.')
          : 'Each family gets its own link, sent to everyone in that family with an email address.'}
          ${' '}A new link replaces any earlier one, which stops working.</p>
      </div>
      <div class="fam-dialog__body">
        ${!preview ? html`<div style="text-align:center;padding:2rem"><span class="spinner" /></div>`
          : preview.error ? html`<p class="fam-meta fam-warn">Couldn’t show the email: ${preview.error}</p>`
          : html`<p class="fam-meta"><strong>Subject:</strong> ${preview.subject}${one ? '' : ' (shown here for a sample family)'}</p>
            <iframe class="fam-preview" title="The email" sandbox="" srcdoc=${preview.html}></iframe>`}
      </div>
      <div class="fam-dialog__foot">
        <button type="button" class="btn btn-ghost" onClick=${onClose} disabled=${busy}>Cancel</button>
        <button type="button" class="btn btn-primary" onClick=${send} disabled=${busy || !preview || preview.error}>
          ${busy ? html`<span class="spinner spinner-14" /> Sending…` : one ? 'Send it' : `Email ${plural(families.length, 'family', 'families')}`}
        </button>
      </div>
    </div>
  </div>`;
}

// ─── The list ───────────────────────────────────────────────────────

function FamilyList({ addToast, onOpen }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [picked, setPicked] = useState(() => new Set());
  const [sending, setSending] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setErr('');
    try { setData(await getJson('list=1')); } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  // The first answer may be from before a sync that's still running: look again once it's had time
  useEffect(() => {
    if (!data?.syncing) return undefined;
    const t = setTimeout(() => getJson('list=1').then((d) => setData({ ...d, syncing: false })).catch(() => {}), 8000);
    return () => clearTimeout(t);
  }, [data?.syncedAt, data?.syncing]);

  const sync = async () => {
    setBusy(true);
    try { const d = await postJson({ sync: true }); setData({ ...d, syncing: false }); addToast(`Read ${plural(d.families.length, 'family', 'families')} from JobTread`, 'success'); } catch (e) { addToast(e.message, 'error'); } finally { setBusy(false); }
  };

  const fams = data?.families || [];
  const search = q.trim().toLowerCase();
  const matches = (f) => !search || [f.name, childOf(f), f.year, ...(f.contacts || []).flatMap((c) => [c.name, c.email, c.phone, c.title]), addressText(f.home)]
    .some((s) => String(s || '').toLowerCase().includes(search));
  const counts = useMemo(() => Object.fromEntries(FILTERS.map(([k]) => [k, fams.filter((f) => inFilter(f, k)).length])), [fams]);
  const shown = fams.filter((f) => inFilter(f, filter) && matches(f));
  const pickable = shown.filter(hasEmail);
  const pickedList = fams.filter((f) => picked.has(f.id));
  const allPicked = pickable.length > 0 && pickable.every((f) => picked.has(f.id));
  const toggle = (id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setPicked((s) => { const n = new Set(s); if (allPicked) pickable.forEach((f) => n.delete(f.id)); else pickable.forEach((f) => n.add(f.id)); return n; });
  const waiting = fams.filter((f) => f.removals > 0 || f.mailing);

  if (err) return html`<div class="card"><p class="fam-meta fam-warn">Couldn’t load the families: ${err}</p><div class="fam-actions"><button class="btn btn-ghost btn-sm" onClick=${load}>Try again</button></div></div>`;

  return html`
    <div class="page-header">
      <div>
        <h2>Families</h2>
        <p class="page-sub">Every makeover family and the people we can reach, from JobTread. Email a family their private link and they can check it, fix it, and add a spouse or anyone else.</p>
      </div>
      <div class="u-row">
        <button type="button" class="btn btn-ghost btn-sm" onClick=${sync} disabled=${busy || !data}>${busy ? html`<span class="spinner spinner-14" /> Reading JobTread…` : 'Check JobTread now'}</button>
      </div>
    </div>

    ${!data ? html`<div class="card" style="text-align:center;padding:3rem"><span class="spinner" /><p class="fam-meta">Reading the families from JobTread…</p></div>` : html`
      ${waiting.length ? html`<div class="card fam-callout" role="note">
        <strong>${plural(waiting.length, 'family', 'families')} sent something that needs a look</strong>
        Someone they asked us to take off their list, or a new address. <button type="button" class="fam-linkbtn" onClick=${() => setFilter('waiting')}>Show them</button>
      </div>` : null}

      <div class="card">
        <div class="fam-bar">
          <div class="search-bar">
            <span class="search-icon" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg></span>
            <input type="search" placeholder="Name, child, email, phone or street" aria-label="Search families" value=${q} onInput=${(e) => setQ(e.target.value)} />
          </div>
          <div class="fam-filters" role="group" aria-label="Show">
            ${FILTERS.map(([k, label]) => html`<button type="button" class="fam-filter" aria-pressed=${filter === k ? 'true' : 'false'} onClick=${() => setFilter(k)}>${label}<span>${counts[k]}</span></button>`)}
          </div>
        </div>
        <p class="fam-meta fam-muted" style="margin-top:0.6rem">
          ${data.syncedAt ? `Read from JobTread ${when(data.syncedAt)}.` : 'Not read from JobTread yet.'}
          ${data.kidsWithoutFamily?.length ? ` ${plural(data.kidsWithoutFamily.length, 'kid page')} ${data.kidsWithoutFamily.length === 1 ? 'isn’t' : 'aren’t'} linked to a JobTread customer yet (Kids → Past makeovers in JobTread), so ${data.kidsWithoutFamily.length === 1 ? 'it isn’t' : 'they aren’t'} here.` : ''}
        </p>
      </div>

      ${pickedList.length ? html`<div class="fam-sendbar" role="region" aria-label="Picked families">
        <span><strong>${plural(pickedList.length, 'family', 'families')}</strong> picked</span>
        <div class="u-row">
          <button type="button" class="btn btn-ghost btn-sm" onClick=${() => setPicked(new Set())}>Clear</button>
          <button type="button" class="btn btn-primary btn-sm" onClick=${() => setSending(pickedList)}>Email them their links…</button>
        </div>
      </div>` : null}

      <div class="card" style="padding:0.25rem 0.5rem">
        ${!shown.length ? html`<p class="fam-empty">${fams.length ? 'No families match.' : 'No families yet. Check JobTread now to read them.'}</p>` : html`
        <table class="fam-table">
          <thead><tr>
            <th class="fam-pick"><input type="checkbox" aria-label="Pick every family shown that has an email" checked=${allPicked} disabled=${!pickable.length} onChange=${toggleAll} /></th>
            <th>Family</th><th>People we can reach</th><th>Home</th><th>Their link</th>
          </tr></thead>
          <tbody>
            ${shown.map((f) => {
              const lw = linkWords(f.link);
              const ppl = f.contacts || [];
              return html`<tr class="fam-row" key=${f.id} tabindex="0" onClick=${(e) => { if (!e.target.closest('.fam-pick')) onOpen(f.id); }} onKeyDown=${(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(f.id); }}>
                <td class="fam-pick">${hasEmail(f)
                  ? html`<input type="checkbox" aria-label=${`Pick ${childOf(f)}’s family`} checked=${picked.has(f.id)} onChange=${() => toggle(f.id)} />`
                  : null}</td>
                <td><div class="fam-name">${childOf(f)}${f.year ? html`<small>${f.year}</small>` : null}</div>
                  ${f.removals || f.mailing ? html`<span class="fam-chip fam-chip--warn">Needs a look</span>` : null}</td>
                <td><div class="fam-people">
                  ${ppl.length ? ppl.slice(0, 3).map((c) => html`<div class="fam-person-line">${c.name}${c.title ? html` <small>${c.title}</small>` : null}${!c.email ? html` <small class="fam-warn">· no email</small>` : null}</div>`)
                    : html`<span class="fam-warn">Nobody yet</span>`}
                  ${ppl.length > 3 ? html`<small class="fam-muted">and ${ppl.length - 3} more</small>` : null}
                </div></td>
                <td>${f.mailing ? html`<span>${addressText(f.mailing)} <span class="fam-chip fam-chip--warn">new</span></span>` : f.home ? addressText(f.home) : html`<span class="fam-muted">None on file</span>`}</td>
                <td><span class=${`fam-chip fam-chip--${lw.tone}`}>${lw.text}</span>${f.last && f.link?.state === 'answered' ? html`<div class="fam-meta">${f.last.kind === 'confirmed' ? 'All still right' : 'Sent changes'}</div>` : null}</td>
              </tr>`;
            })}
          </tbody>
        </table>`}
      </div>
    `}
    ${sending ? html`<${SendDialog} families=${sending} addToast=${addToast} onClose=${() => setSending(null)} onSent=${() => { setSending(null); setPicked(new Set()); load(); }} />` : null}
  `;
}

// ─── One family ─────────────────────────────────────────────────────

const blank = () => ({ name: '', title: '', email: '', phone: '' });

function ContactForm({ value, onChange, n }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  return html`<div class="fam-edit">
    <div class="form-group"><label class="form-label" for=${`fam-n-${n}`}>Name</label><input id=${`fam-n-${n}`} class="form-input" value=${value.name} onInput=${set('name')} maxlength="80" /></div>
    <div class="form-group"><label class="form-label" for=${`fam-t-${n}`}>Relationship to the child</label><input id=${`fam-t-${n}`} class="form-input" list="fam-relationships" value=${value.title} onInput=${set('title')} maxlength="40" /></div>
    <div class="form-group"><label class="form-label" for=${`fam-e-${n}`}>Email</label><input id=${`fam-e-${n}`} class="form-input" type="email" value=${value.email} onInput=${set('email')} maxlength="200" /></div>
    <div class="form-group"><label class="form-label" for=${`fam-p-${n}`}>Mobile phone</label><input id=${`fam-p-${n}`} class="form-input" type="tel" value=${value.phone} onInput=${set('phone')} maxlength="40" /></div>
  </div>`;
}

function changeLines(u) {
  const out = [];
  for (const c of u.changes || []) {
    if (c.type === 'add') out.push(`Added ${c.name}${c.title ? ` (${c.title})` : ''}${[c.email, phoneText(c.phone)].filter(Boolean).length ? `: ${[c.email, phoneText(c.phone)].filter(Boolean).join(', ')}` : ''}`);
    else if (c.type === 'remove') out.push(`Took ${c.name} off${c.asked ? ', as the family asked' : ''}`);
    else if (c.type === 'remove-ask') out.push(`Asked us to take ${c.name} off`);
    else if (c.type === 'edit') {
      const parts = Object.entries(c.fields || {}).map(([k, [a, b]]) => {
        const show = (v) => (k === 'phone' ? phoneText(v) : v) || 'blank';
        return `${{ name: 'name', title: 'relationship', email: 'email', phone: 'phone' }[k]} ${show(a)} → ${show(b)}`;
      });
      out.push(`${c.name}: ${parts.join('; ')}`);
    }
  }
  if (u.address) out.push(`New address: ${addressText(u.address.after)}${u.address.before ? ` (was ${u.address.before})` : ''}`);
  if (u.note) out.push(`Note: “${u.note}”`);
  return out;
}

function FamilyPage({ id, addToast, onBack }) {
  const [f, setF] = useState(null);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(null); // contact id being edited, or 'new'
  const [draft, setDraft] = useState(blank());
  const [busy, setBusy] = useState(null);
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(null);

  const load = useCallback(async () => {
    setErr('');
    try { setF((await getJson(`id=${encodeURIComponent(id)}`)).family); } catch (e) { setErr(e.message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const run = async (key, fn) => {
    setBusy(key);
    try { return await fn(); } catch (e) { addToast(e.message, 'error'); return null; } finally { setBusy(null); }
  };
  const save = (contacts, what) => run('save', async () => {
    const d = await postJson({ save: { id, contacts } });
    setF(d.family);
    setEditing(null);
    if (d.result.problems?.length) addToast(d.result.problems.join(' '), 'error');
    else addToast(what, 'success');
  });

  if (err) return html`<a href="#families" class="fam-back" onClick=${(e) => { e.preventDefault(); onBack(); }}>← Families</a>
    <div class="card"><p class="fam-meta fam-warn">${err}</p><div class="fam-actions"><button class="btn btn-ghost btn-sm" onClick=${load}>Try again</button></div></div>`;
  if (!f) return html`<div class="card" style="text-align:center;padding:3rem"><span class="spinner" /></div>`;

  const contacts = f.contacts || [];
  const live = f.links?.find((l) => l.live);
  const lw = linkWords(f.links?.[0]);
  const emailable = hasEmail(f);

  const startEdit = (c) => { setEditing(c ? c.id : 'new'); setDraft(c ? { name: c.name, title: c.title, email: c.email, phone: phoneText(c.phone) } : blank()); };
  const saveEdit = () => {
    const name = draft.name.trim() || 'them';
    if (editing === 'new') return save([{ ...draft }], `Added ${name} in JobTread`);
    return save([{ id: editing, ...draft }], `Saved ${name} in JobTread`);
  };
  const removeOne = async (c) => {
    if (!(await ask({ title: `Take ${c.name} off?`, text: `${c.name} comes off ${childOf(f)}’s family in JobTread and stops getting SOARD’s family emails. JobTread doesn’t keep a copy.`, yes: 'Take them off', danger: true }))) return;
    save([{ id: c.id, remove: true }], `Took ${c.name} off in JobTread`);
  };
  const decide = (r, decision) => run(`rm-${r.id}`, async () => {
    const d = await postJson({ removal: { id: r.id, decision } });
    if (d.family) setF(d.family); else load();
    addToast(decision === 'remove' ? `Took ${r.name} off in JobTread` : `Kept ${r.name}`, 'success');
  });
  const clearMailing = () => run('mailing', async () => {
    const d = await postJson({ mailing: { id } });
    setF(d.family);
    addToast('Cleared', 'success');
  });
  const copyLink = async () => {
    if (live?.sentAt && !(await ask({ title: 'Make a new link?', text: `The link emailed ${day(live.sentAt)} stops working, and this one takes its place. Use it to text the family, or paste it in your own email.`, yes: 'Make a new link' }))) return;
    run('link', async () => {
      const d = await postJson({ link: { id } });
      setCopied(d.url);
      try { await navigator.clipboard.writeText(d.url); addToast('Link copied', 'success'); } catch { addToast('Link made: copy it below', 'success'); }
      load();
    });
  };

  return html`
    <a href="#families" class="fam-back" onClick=${(e) => { e.preventDefault(); onBack(); }}>← Families</a>
    <div class="page-header">
      <div>
        <h2>${childOf(f)}’s family</h2>
        <p class="page-sub">${[f.year && `Makeover ${f.year}`, f.status, f.language && f.language !== 'English' ? `Speaks ${f.language}` : null].filter(Boolean).join(' · ')}</p>
        ${f.kids?.length ? html`<div class="fam-kids">${f.kids.map((k) => html`<a class="fam-kid" href=${`#kids/${encodeURIComponent(k.slug)}`}>${k.name}${k.year ? ` · ${k.year}` : ''} kid page</a>`)}</div>` : null}
      </div>
      <div class="u-row">
        <a class="btn btn-ghost btn-sm" href=${JT(f.id)} target="_blank" rel="noopener">Open in JobTread ↗</a>
        <button type="button" class="btn btn-primary btn-sm" onClick=${() => setSending(true)} disabled=${!emailable} title=${emailable ? null : 'Add someone with an email address first'}>Email them their link…</button>
      </div>
    </div>

    ${f.gone ? html`<div class="card fam-callout">This family isn’t on the list any more: their JobTread customer was archived, or it has no makeover now.</div>` : null}

    <div class="fam-grid">
      <div class="fam-col">
        ${f.removals?.length ? html`<div class="card">
          <div class="fam-card-head"><h3>They asked us to take someone off</h3></div>
          ${f.removals.map((r) => html`<div class="fam-callout" key=${r.id}>
            <strong>${r.name}</strong>
            Asked ${when(r.askedAt)}. They stay in JobTread until you decide.
            <div class="fam-actions">
              <button type="button" class="btn btn-danger btn-sm" disabled=${!!busy} onClick=${() => decide(r, 'remove')}>${busy === `rm-${r.id}` ? 'Working…' : 'Take them off in JobTread'}</button>
              <button type="button" class="btn btn-ghost btn-sm" disabled=${!!busy} onClick=${() => decide(r, 'keep')}>Keep them</button>
            </div>
          </div>`)}
        </div>` : null}

        <div class="card">
          <div class="fam-card-head">
            <h3>People we can reach</h3>
            <span class="fam-meta">Changes here go straight to JobTread.</span>
          </div>
          ${!contacts.length ? html`<p class="fam-meta fam-warn">Nobody on file yet. Add a parent with an email address, then email them their link.</p>` : null}
          ${contacts.map((c, i) => html`<div class="fam-contact" key=${c.id}>
            <div class="fam-contact__head">
              <div class="fam-contact__name">${c.name || '(no name)'}${c.main ? html`<span class="fam-chip">Main contact</span>` : null}</div>
              ${editing === c.id ? null : html`<div class="u-row">
                <button type="button" class="fam-linkbtn" onClick=${() => startEdit(c)} disabled=${!!busy}>Edit</button>
                ${c.main ? null : html`<button type="button" class="fam-linkbtn fam-linkbtn--danger" onClick=${() => removeOne(c)} disabled=${!!busy}>Take off</button>`}
              </div>`}
            </div>
            ${editing === c.id ? html`
              <${ContactForm} value=${draft} onChange=${setDraft} n=${i} />
              <div class="fam-actions">
                <button type="button" class="btn btn-primary btn-sm" onClick=${saveEdit} disabled=${!!busy}>${busy === 'save' ? 'Saving…' : 'Save to JobTread'}</button>
                <button type="button" class="btn btn-ghost btn-sm" onClick=${() => setEditing(null)} disabled=${!!busy}>Cancel</button>
              </div>` : html`
              <dl class="fam-contact__facts">
                <dt>Relationship</dt><dd>${c.title || html`<span class="fam-muted">Not given</span>`}</dd>
                <dt>Email</dt><dd>${c.email ? html`<a href=${`mailto:${c.email}`}>${c.email}</a>` : html`<span class="fam-warn">None</span>`}</dd>
                <dt>Phone</dt><dd>${c.phone ? html`<a href=${`tel:${c.phone}`}>${phoneText(c.phone)}</a>` : html`<span class="fam-muted">None</span>`}</dd>
              </dl>`}
          </div>`)}
          ${editing === 'new' ? html`<div class="fam-contact">
            <div class="fam-contact__name">Someone new</div>
            <${ContactForm} value=${draft} onChange=${setDraft} n="new" />
            <div class="fam-actions">
              <button type="button" class="btn btn-primary btn-sm" onClick=${saveEdit} disabled=${!!busy}>${busy === 'save' ? 'Adding…' : 'Add in JobTread'}</button>
              <button type="button" class="btn btn-ghost btn-sm" onClick=${() => setEditing(null)} disabled=${!!busy}>Cancel</button>
            </div>
          </div>` : html`<div class="fam-actions"><button type="button" class="btn btn-ghost btn-sm" onClick=${() => startEdit(null)} disabled=${!!busy || !!editing}>+ Add someone</button></div>`}
          <datalist id="fam-relationships">${RELATIONSHIPS.map((r) => html`<option value=${r} />`)}</datalist>
        </div>

        <div class="card">
          <div class="fam-card-head"><h3>What changed</h3></div>
          ${!f.updates?.length ? html`<p class="fam-meta">Nothing yet. Every confirm and change, the family’s or staff’s, shows here.</p>` : html`<ul class="fam-history">
            ${f.updates.map((u) => html`<li key=${u.id} class=${u.by === 'family' ? 'is-family' : ''}>
              <div><strong>${who(u.by)}</strong> ${u.kind === 'confirmed' ? 'said everything is still right' : 'made changes'} <span class="fam-history__when">${day(u.at)}, ${new Date(u.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span></div>
              ${changeLines(u).length ? html`<ul>${changeLines(u).map((l) => html`<li>${l}</li>`)}</ul>` : null}
              ${(u.problems || []).map((p) => html`<div class="fam-problem">${p}</div>`)}
            </li>`)}
          </ul>`}
        </div>
      </div>

      <div class="fam-col">
        <div class="card">
          <div class="fam-card-head"><h3>Their link</h3><span class=${`fam-chip fam-chip--${lw.tone}`}>${lw.text}</span></div>
          ${live ? html`<dl class="fam-facts">
            ${live.sentAt ? html`<dt>Emailed</dt><dd>${day(live.sentAt)} by ${who(live.sentBy)}, to ${(live.sentTo || []).join(', ')}</dd>` : html`<dt>Made</dt><dd>${day(live.createdAt)} by ${who(live.createdBy)}, to copy</dd>`}
            <dt>Opened</dt><dd>${live.openedAt ? when(live.openedAt) : 'Not yet'}</dd>
            <dt>Answered</dt><dd>${live.answeredAt ? `${when(live.answeredAt)}${live.submissions > 1 ? ` (${live.submissions} times)` : ''}` : 'Not yet'}</dd>
            <dt>Works until</dt><dd>${day(live.expiresAt)}</dd>
          </dl>` : html`<p class="fam-meta">${f.links?.length ? 'Their last link has expired or was replaced.' : 'They haven’t been sent a link yet.'} The link opens a page with what we have for them, where they can say it’s right, fix it, or add people.</p>`}
          <div class="fam-actions">
            <button type="button" class="btn btn-primary btn-sm" onClick=${() => setSending(true)} disabled=${!emailable || !!busy}>${live?.sentAt ? 'Email a new link…' : 'Email them their link…'}</button>
            <button type="button" class="btn btn-ghost btn-sm" onClick=${copyLink} disabled=${!!busy}>${busy === 'link' ? 'Making…' : 'Copy a link to text them'}</button>
          </div>
          ${!emailable ? html`<p class="fam-meta fam-warn">Nobody in this family has an email address. Add one, or copy a link and text it.</p>` : null}
          ${copied ? html`<div class="fam-copy"><input class="form-input" readonly value=${copied} aria-label="The family’s link" onFocus=${(e) => e.target.select()} /></div>` : null}
        </div>

        <div class="card">
          <div class="fam-card-head"><h3>Home</h3></div>
          ${f.mailing ? html`<div class="fam-callout">
            <strong>New address from the family</strong>
            ${addressText(f.mailing)}
            <div class="fam-meta">Sent ${when(f.mailing.at)}. It isn’t in JobTread: the home there is where the makeover was. Copy it where you need it, then clear this.</div>
            <div class="fam-actions"><button type="button" class="btn btn-ghost btn-sm" onClick=${clearMailing} disabled=${!!busy}>Done, clear it</button></div>
          </div>` : null}
          <dl class="fam-facts" style=${f.mailing ? 'margin-top:0.75rem' : ''}>
            <dt>In JobTread</dt><dd>${f.home ? addressText(f.home) : html`<span class="fam-muted">No address</span>`}</dd>
          </dl>
        </div>
      </div>
    </div>
    ${sending ? html`<${SendDialog} families=${[f]} addToast=${addToast} onClose=${() => setSending(false)} onSent=${() => { setSending(false); load(); }} />` : null}
  `;
}
