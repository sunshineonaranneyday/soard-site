/**
 * The backup's watchdog, outside Cloudflare: a Google Apps Script in SOARD's Google account, so it still speaks
 * up if Cloudflare (and with it the backup and the website's alerts) is down or gone.
 *
 * Every morning at 9 and every afternoon at 3 (Eastern) it looks in the backup's shared drive (the one with
 * "backup" in its name) for the newest run's summary (Nights/<year>/<run>.json), which the backup writes last,
 * after everything else is in. If no run has finished in a day and a half, or the newest says something isn't
 * right, it emails the person who set this up (and anyone in the ALSO_TELL script property, commas between
 * addresses), once for each new summary or each day it stays missing. Each check also updates "Watchdog - last
 * check.txt" in the drive, which the backup reads, so the admin can see the watchdog itself is alive.
 *
 * Set up (once), signed in as someone who is a member of the backup shared drive (Contributor or more):
 * script.google.com → New project → paste this file as Code.gs; Project Settings → tick "Show appsscript.json"
 * and paste appsscript.json; then pick setUp in the toolbar and press Run (Google asks to allow it once). That's
 * all: it runs by itself from then on.
 */
const NAMED = /back\s*-?\s*up/i;
const TZ = 'America/New_York';
const NOTE = 'Watchdog - last check.txt';
const FOLDER = 'application/vnd.google-apps.folder';
const STALE_MS = 36 * 3600 * 1000;

function setUp() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('setUpAt')) props.setProperty('setUpAt', new Date().toISOString());
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('check').timeBased().atHour(9).everyDays(1).inTimezone(TZ).create();
  ScriptApp.newTrigger('check').timeBased().atHour(15).everyDays(1).inTimezone(TZ).create();
  check();
}

function call_(method, url, options) {
  const res = UrlFetchApp.fetch(url, Object.assign({ method, headers: { Authorization: `Bearer ${ScriptApp.getOAuthToken()}` }, muteHttpExceptions: true }, options || {}));
  return { code: res.getResponseCode(), text: res.getContentText() };
}

function api_(path) {
  const r = call_('get', `https://www.googleapis.com/drive/v3${path}`);
  if (r.code >= 300) throw new Error(`Google Drive answered ${r.code}: ${r.text.slice(0, 200)}`);
  return JSON.parse(r.text);
}

const q_ = (s) => encodeURIComponent(s);
const esc_ = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const inDrive_ = (driveId) => `corpora=drive&driveId=${driveId}&includeItemsFromAllDrives=true&supportsAllDrives=true`;

/** The backup's shared drive, chosen the way the backup chooses it: the one with "backup" in its name, or the only one */
function backupDrive_() {
  const drives = [];
  let token = '';
  do {
    const page = api_(`/drives?pageSize=100${token ? `&pageToken=${q_(token)}` : ''}`);
    drives.push(...(page.drives || []));
    token = page.nextPageToken || '';
  } while (token);
  const named = drives.filter((d) => NAMED.test(d.name || ''));
  if (named.length === 1) return named[0];
  if (!named.length && drives.length === 1) return drives[0];
  if (named.length > 1) throw new Error(`there are ${named.length} shared drives with “backup” in their name (${named.map((d) => d.name).join(', ')}); the backup uses only one`);
  throw new Error(`${Session.getEffectiveUser().getEmail()} isn’t a member of a shared drive with “backup” in its name: in Google Drive, open the backup's shared drive → Manage members, and add this account (Contributor or more)`);
}

function child_(driveId, parentId, name, folder) {
  const q = `name = '${esc_(name)}' and '${esc_(parentId)}' in parents and trashed = false${folder ? ` and mimeType = '${FOLDER}'` : ''}`;
  return api_(`/files?${inDrive_(driveId)}&q=${q_(q)}&orderBy=${q_('modifiedTime desc')}&fields=${q_('files(id,name,modifiedTime)')}`).files || [];
}

/** The newest run's summary: { name, at, summary } or null when no run has finished yet */
function newestRun_(driveId) {
  const nights = child_(driveId, driveId, 'Nights', true)[0];
  if (!nights) return null;
  const q = `'${esc_(nights.id)}' in parents and mimeType = '${FOLDER}' and trashed = false`;
  const years = (api_(`/files?${inDrive_(driveId)}&q=${q_(q)}&orderBy=${q_('name desc')}&fields=${q_('files(id,name)')}`).files || []).filter((f) => /^\d{4}$/.test(f.name));
  for (const year of years) {
    const fq = `'${esc_(year.id)}' in parents and trashed = false`;
    // The newest runs by name (runs are named by date), read, and the one that finished last is the newest: an old
    // summary sent to Drive again later never passes for the newest, and a damaged copy (it won't read) is skipped
    const files = (api_(`/files?${inDrive_(driveId)}&q=${q_(fq)}&orderBy=${q_('name desc')}&pageSize=10&fields=${q_('files(id,name,modifiedTime)')}`).files || []).filter((f) => /^\d{4}-\d{2}-\d{2}( \d{4})?\.json$/.test(f.name));
    let best = null;
    for (const f of files) {
      const r = call_('get', `https://www.googleapis.com/drive/v3/files/${f.id}?alt=media&supportsAllDrives=true`);
      if (r.code >= 300) continue;
      let summary;
      try { summary = JSON.parse(r.text); } catch (e) { continue; }
      const at = Date.parse(summary.finished) || Date.parse(f.modifiedTime);
      if (!best || at > best.at) best = { name: f.name.replace(/\.json$/, ''), at, summary };
    }
    if (best) return best;
  }
  return null;
}

function tell_(subject, lines) {
  const also = (PropertiesService.getScriptProperties().getProperty('ALSO_TELL') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const to = [Session.getEffectiveUser().getEmail(), ...also].join(',');
  MailApp.sendEmail({ to, subject, body: `${lines.join('\n\n')}\n\nAdmin → Automations → Hosting → Backup shows where it stands. The READ ME FIRST at the top of the backup's shared drive says how to put everything back.\n\n(This is the backup's watchdog, a Google Apps Script outside Cloudflare.)` });
}

// Each trouble is told once: the same missing day, or the same kind of problem night after night (Stream off for a
// week is one email, not seven), isn't emailed twice, whatever else is told in between. What was told is kept for
// two weeks, so trouble that lasts is told again after that.
function once_(keys, send) {
  keys = [].concat(keys);
  const props = PropertiesService.getScriptProperties();
  let told = {};
  try { told = JSON.parse(props.getProperty('told') || '{}') || {}; } catch (e) { told = {}; }
  if (typeof told !== 'object' || Array.isArray(told)) told = {};
  if (keys.every((k) => told[k])) return;
  send();
  const keep = Date.now() - 14 * 24 * 3600 * 1000;
  Object.keys(told).forEach((k) => { if (Date.parse(told[k]) < keep) delete told[k]; });
  keys.forEach((k) => { told[k] = new Date().toISOString(); });
  props.setProperty('told', JSON.stringify(told));
}

// Kinds of trouble the newest run no longer has are forgotten, so the same trouble coming back later is told again
function forgetCleared_(current) {
  const props = PropertiesService.getScriptProperties();
  let told = {};
  try { told = JSON.parse(props.getProperty('told') || '{}') || {}; } catch (e) { return; }
  const keep = new Set(current.map((k) => `kind:${k}`));
  let changed = false;
  Object.keys(told).forEach((k) => { if (k.startsWith('kind:') && !keep.has(k)) { delete told[k]; changed = true; } });
  if (changed) props.setProperty('told', JSON.stringify(told));
}

function check() {
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  let drive;
  let result;
  try {
    drive = backupDrive_();
    const run = newestRun_(drive.id);
    const age = run ? Date.now() - (Date.parse(run.summary.finished) || run.at) : Infinity;
    if (!run) {
      result = 'No backup run has finished yet.';
      // While it's being set up there's nothing to say; three days after this watchdog was set up, there is
      const since = Date.parse(PropertiesService.getScriptProperties().getProperty('setUpAt') || '');
      if (since && Date.now() - since > 3 * 24 * 3600 * 1000) once_(`never:${today}`, () => tell_('The website backup has never finished a run', [`This watchdog was set up on ${new Date(since).toDateString()}, and no backup run has finished since: there's no summary in the "${drive.name}" shared drive. Admin → Automations → Hosting → Backup says what's left to set up.`]));
    } else if (age > STALE_MS) {
      result = `No backup run has finished since ${run.name}.`;
      once_(`stale:${today}`, () => tell_('The website backup has stopped', [`No backup run has finished since ${run.name} (the newest summary in the "${drive.name}" shared drive), more than a day and a half ago. The backup runs every night from 2 AM.`]));
    } else if (run.summary.ok) {
      result = `The run of ${run.name} finished well.`;
      forgetCleared_([]);
    } else {
      const why = (run.summary.problems || []).slice(0, 8);
      result = `The run of ${run.name} finished with ${why.length || 'some'} problem(s).`;
      const kinds = run.summary.problemKinds || [];
      forgetCleared_(kinds);
      once_(kinds.length ? kinds.map((k) => `kind:${k}`) : [`run:${run.name}`], () => tell_('The website backup finished with problems', [`The run of ${run.name}:`, ...(why.length ? why.map((p) => `• ${p}`) : ['(its summary in the drive says what)'])]));
    }
  } catch (e) {
    result = `Couldn’t check: ${e.message}`;
    once_(`error:${today}`, () => tell_('The website backup’s watchdog couldn’t check', [`It couldn't look at the backup: ${e.message}`]));
  }
  if (drive) {
    try { writeNote_(drive.id, `${new Date().toISOString()} ${result}`); } catch (e) {
      once_(`note:${today}`, () => tell_('The website backup’s watchdog couldn’t leave its note', [`It checked (${result}) but couldn't update "${NOTE}" in the "${drive.name}" shared drive: ${e.message}. The admin will say the watchdog has stopped until it can.`]));
    }
  }
}

function writeNote_(driveId, text) {
  const found = child_(driveId, driveId, NOTE, false)[0];
  if (found) {
    const r = call_('patch', `https://www.googleapis.com/upload/drive/v3/files/${found.id}?uploadType=media&supportsAllDrives=true`, { contentType: 'text/plain', payload: text });
    if (r.code < 300) return;
    // A note this script may not change (made by an earlier copy of the watchdog): a new one beside it, which the backup reads as the newest
    if (r.code !== 403 && r.code !== 404) throw new Error(`Google Drive answered ${r.code}: ${r.text.slice(0, 200)}`);
  }
  const boundary = 'soard-watchdog';
  const body = `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ name: NOTE, parents: [driveId] })}\r\n--${boundary}\r\nContent-Type: text/plain\r\n\r\n${text}\r\n--${boundary}--`;
  const r = call_('post', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true', { contentType: `multipart/related; boundary=${boundary}`, payload: body });
  if (r.code >= 300) throw new Error(`Google Drive answered ${r.code}: ${r.text.slice(0, 200)}`);
}
