/**
 * Automations → Hosting → Backup → "Setup and the key": what the backup Worker (soard-backup) still needs, a check
 * and a run on demand, and the recovery sheet (the key that opens every backup) to print. Talks to
 * /api/backup-admin, which reaches the backup through the site's BACKUP binding.
 */
import { h, htm, useState, render } from './vendor.js';

const html = htm.bind(h);
const URL_ = '/api/backup-admin';

const CSS = `
.bk-panel { display: grid; gap: 0.6rem; }
.bk-panel ol { margin: 0; padding-left: 1.2rem; }
.bk-panel li { margin: 0 0 0.35rem; }
.bk-row { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; }
.bk-note { font-size: 0.85rem; color: var(--text-muted, #555); }
@media screen { #bk-print-root { display: none; } }
@media print {
  body.bk-printing > *:not(#bk-print-root) { display: none !important; }
  body.bk-printing { background: #fff; padding: 0; }
  #bk-print-root { display: block; color: #1A1B1F; font: 11pt/1.5 Inter, system-ui, sans-serif; }
  .bk-sheet { break-after: page; padding: 0.4in 0; }
  .bk-sheet h1 { margin: 0 0 0.2rem; font-size: 18pt; }
  .bk-sheet .bk-sub { margin: 0 0 1rem; color: #555; font-size: 9.5pt; }
  .bk-key { font: 13pt/1.6 ui-monospace, Menlo, Consolas, monospace; letter-spacing: 0.02em; border: 1.5pt solid #1A1B1F; padding: 0.6rem 0.8rem; word-break: break-all; margin: 0.6rem 0 1rem; }
  .bk-sheet ol { padding-left: 1.2rem; }
}
`;
if (typeof document !== 'undefined' && !document.getElementById('bk-panel-css')) {
  const s = document.createElement('style');
  s.id = 'bk-panel-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

async function call(action) {
  const res = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.error || `The backup answered ${res.status}`);
  return data;
}

const day = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

function Sheet({ identity, fingerprint, made, copy }) {
  return html`<div class="bk-sheet">
    <h1>SOARD backup recovery key</h1>
    <p class="bk-sub">Copy ${copy} of 2 · printed ${day(new Date().toISOString())} · key made ${made ? day(made) : 'when the backup started'} · check code ${fingerprint}</p>
    <p>This key opens every backup of Sunshine on a Ranney Day’s website and store: the copies in the “Website backup” Google shared drive and in the Backblaze bucket. Nothing else can open them. Keep this page somewhere safe and private (the two copies in two different places), never in a photo or an email.</p>
    <div class="bk-key">${identity}</div>
    <p><b>To use it:</b> install age (age-encryption.org, version 1.3 or newer), type the line above into a file named key.txt, then follow the “READ ME FIRST” file at the top of the backup drive. Its check code is ${fingerprint}, the same as on this page.</p>
    <p class="bk-sub">Print it on paper only. Never save it as a PDF or take a picture of it: a file of it on a computer or phone is a copy of the key anyone with that device could use.</p>
  </div>`;
}

const KEY_ON_PAGE_MS = 5 * 60_000;
function printSheet(props) {
  let root = document.getElementById('bk-print-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'bk-print-root';
    document.body.appendChild(root);
  }
  render(html`<${Sheet} ...${props} copy=${1} /><${Sheet} ...${props} copy=${2} />`, root);
  document.body.classList.add('bk-printing');
  let timer = null;
  // The key leaves the page as soon as it's printed, if printing fails, and in any case after five minutes
  const done = () => {
    clearTimeout(timer);
    window.removeEventListener('afterprint', done);
    document.body.classList.remove('bk-printing');
    render(null, root);
  };
  window.addEventListener('afterprint', done);
  timer = setTimeout(done, KEY_ON_PAGE_MS);
  try { window.print(); } catch (e) { done(); throw e; }
}

/** The steps still to do, in order, in plain words (from the backup's own check) */
const DEPLOY = 'Put the backup Worker on Cloudflare first: in workers/backup run npm ci, then npx wrangler r2 bucket create soard-backup-staging (once), then npx wrangler deploy (it asks you to sign in to Cloudflare once). Then connect the site to it: the BACKUP service binding in the site’s wrangler.toml, under “SOARD’s nightly backup”, and publish.';
function steps(b) {
  if (b?.error && b.connected === undefined) return [{ text: `The admin couldn’t read the backup’s report just now (${b.error}). Reload the page.` }];
  if (!b?.connected) return [{ text: DEPLOY }];
  if (b.reachable && !b.setup) return [{ text: 'The backup is on Cloudflare. Press Check the setup now: it looks at every piece and lists what’s left, a step at a time.' }];
  if (!b.reachable) return [{ text: b.chores?.reached ? `The site can’t reach the backup right now (${b.error || 'no answer'}). If it was taken off Cloudflare, put it back: ${DEPLOY.replace('Put the backup Worker on Cloudflare first: ', '')}` : `${DEPLOY}${b.error ? ` (The site says: ${b.error}.)` : ''}` }];
  const s = b.setup || {};
  const out = [];
  const home = (h) => (s.problems || []).filter((p) => p.home === h).map((p) => p.why);
  if (home('cloudflare').length) out.push({ text: `Cloudflare: ${home('cloudflare').join('; ')}. Make the key with the button here (it opens Cloudflare with every read-only permission it needs filled in), under Zone Resources pick All zones, also tick ${(s.cloudflare?.extras || ['Single Redirect Read', 'Email Routing Rules Read']).join(' and ')}, create it, then in Workers & Pages → soard-backup → Settings → Variables and secrets add it as a Secret named CF_BACKUP_TOKEN.`, link: s.cloudflare?.link ? { label: 'Make the read-only key', href: s.cloudflare.link } : null });
  if (home('drive').length) out.push({ text: `Google Drive: ${home('drive').join('; ')}. ${s.google?.account ? `In Google Drive make a shared drive named Website backup, and in its Manage members add ${s.google.account} as a Contributor. If Google won’t add it (the address is outside SOARD): in admin.google.com go to Apps → Google Workspace → Drive and Docs → Sharing settings → Shared drive creation, tick “Allow users outside your organization to access files in shared drives”, save, and add it again.` : 'In Google Cloud (console.cloud.google.com) make a project named soard-backup, and in it turn on the Google Drive API (APIs & Services → Library → Google Drive API → Enable). Then in IAM & Admin → Service accounts make a service account named soard-backup with no roles, and under Keys add a JSON key. If Google says key creation is turned off by a policy: in IAM & Admin → Organization Policies open “Disable service account key creation” (iam.disableServiceAccountKeyCreation), and for this project only choose Override parent’s policy → Not enforced, then add the key. Add the whole downloaded file in soard-backup → Settings → Variables and secrets as a Secret named GOOGLE_BACKUP_KEY, and delete the downloaded file. Then make the shared drive Website backup and add that account’s address as a Contributor.'}` });
  if (home('b2').length) {
    const canDelete = (s.problems || []).some((p) => p.home === 'b2' && /can delete/.test(p.why));
    out.push({ text: `Backblaze: ${home('b2').join('; ')}. ${canDelete
      ? `Make a key that can't delete with Backblaze’s command-line tool (on a Mac: brew install b2-tools, then b2 account authorize with your master key), then run: b2 key create --bucket ${s.b2?.bucket || '<the bucket>'} soard-backup listBuckets,listFiles,readFiles,writeFiles,readBucketRetentions,readFileRetentions. Put the two values it prints in soard-backup → Settings → Variables and secrets as B2_KEY_ID and B2_APPLICATION_KEY, and delete the old key in Backblaze.`
      : 'At backblaze.com make a B2 account (with two-step sign-in), a private bucket with Object Lock on and a default retention of 90 days in Compliance mode, and an application key for that bucket only, with Read and Write. Add its keyID and applicationKey in soard-backup → Settings → Variables and secrets as Secrets named B2_KEY_ID and B2_APPLICATION_KEY. The check then reads what the key may do, and asks for a stricter one if it can delete.'}` });
  }
  if (home('github').length) out.push({ text: `GitHub: ${home('github').join('; ')}. In GitHub → Settings → Developer settings → Fine-grained tokens, make a token for the Sunshine on a Ranney Day organization, all repositories, Contents read-only, and add it in soard-backup → Settings → Variables and secrets as a Secret named GITHUB_BACKUP_TOKEN.` });
  if (s.google?.ok && !s.watchdog?.at) out.push({ text: 'The watchdog, outside Cloudflare: signed in as someone who is a member of the Website backup shared drive (a Contributor or more), at script.google.com make a New project, paste in the code from workers/backup/watchdog/Code.gs (and, after ticking Show appsscript.json in Project Settings, the file appsscript.json), then pick setUp and press Run, and allow it. Every morning at 9 and every afternoon at 3 it checks a backup run finished in the last day and a half, and emails you if not.', link: { label: 'Open Apps Script', href: 'https://script.google.com/home/projects/create' } });
  if (home('watchdog').length && s.watchdog?.at) out.push({ text: `The watchdog: ${home('watchdog').join('; ')}. Open it at script.google.com and press Run on setUp again.`, link: { label: 'Apps Script', href: 'https://script.google.com/home' } });
  if (home('key').length) out.push({ text: 'Print the recovery sheet (below) and keep its two copies in two safe places.' });
  return out;
}

export function BackupPanel({ facts }) {
  const b = facts?.backup;
  const [busy, setBusy] = useState('');
  const [said, setSaid] = useState('');
  const [check, setCheck] = useState(null);
  // Printed counts only for this very key: a sheet printed for an earlier key doesn't open the new copies
  const sheet = b?.recovery?.printed;
  const [printed, setPrinted] = useState(!!sheet && (!sheet.fingerprint || sheet.fingerprint === b?.key?.fingerprint));
  const go = async (action, after) => {
    setBusy(action);
    setSaid('');
    try { await after(await call(action)); } catch (e) { setSaid(e.message); }
    setBusy('');
  };
  const todo = steps(check ? { connected: true, reachable: true, setup: check } : b);
  const live = b?.connected && b?.reachable;
  const shown = (b?.recovery?.shown || []).slice(-3).reverse();
  return html`<div class="bk-panel">
    ${todo.length > 0
      ? html`<div><b>Still to do</b><ol>${todo.map((t) => html`<li key=${t.text}>${t.text}${t.link && html` <a class="btn btn-ghost btn-sm" href=${t.link.href} target="_blank" rel="noopener noreferrer">${t.link.label} ↗</a>`}</li>`)}</ol></div>`
      : html`<div>Everything is set up.</div>`}
    ${live && html`<div class="bk-row">
      <button type="button" class="btn btn-ghost btn-sm" disabled=${!!busy} onClick=${() => go('check', (r) => { setCheck(r); setSaid(r.problems?.length ? `Checked: ${r.problems.length} thing${r.problems.length === 1 ? '' : 's'} left.` : 'Checked: everything is in place.'); })}>${busy === 'check' ? 'Checking…' : 'Check the setup now'}</button>
      <button type="button" class="btn btn-ghost btn-sm" disabled=${!!busy} onClick=${() => go('run', (r) => setSaid(r.started ? 'Started. The databases, settings and code are copied fresh; photos, videos and files carry on from what’s already copied. This page shows it as it goes.' : `Not started: ${r.why}.`))}>${busy === 'run' ? 'Starting…' : 'Back up now'}</button>
    </div>`}
    ${live && html`<div>
      <b>Recovery sheet</b>
      <p class="bk-note">The key that opens every backup, printed twice. ${printed ? `Printed${sheet?.by ? ` by ${sheet.by}` : ''}${sheet?.at ? ` on ${day(sheet.at)}` : ''}; print it again only if a copy is lost.` : sheet ? 'The key has changed since the sheet was printed: print the new one, and keep the old sheet too (it still opens the older copies).' : 'Not printed yet: until it is, the only copy of the key is inside Cloudflare.'} Check code ${b?.key?.fingerprint || '…'}.${shown.length ? ` Last opened by ${shown.map((x) => `${x.by} on ${day(x.at)}`).join(', ')}.` : ''} Opening it tells the admins in Slack. Print it on paper; never save it as a PDF.</p>
      <div class="bk-row">
        <button type="button" class="btn btn-ghost btn-sm" disabled=${!!busy} onClick=${() => { if (window.confirm('Print the backup key now? It shows on the printed page only and leaves the page as soon as it prints. Print to a printer, not to a PDF. The admins are told in Slack that you opened it.')) go('recovery-sheet', (r) => printSheet(r)); }}>Print the recovery sheet</button>
        ${!printed && html`<button type="button" class="btn btn-ghost btn-sm" disabled=${!!busy} onClick=${() => go('recovery-printed', () => { setPrinted(true); setSaid('Noted: the sheet is printed and put away.'); })}>I’ve printed it and put both copies away</button>`}
      </div>
    </div>`}
    ${said && html`<p class="bk-note" role="status">${said}</p>`}
  </div>`;
}
