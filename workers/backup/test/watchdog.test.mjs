/**
 * The watchdog (../watchdog/Code.gs), run as Google would run it: its file in a sandbox with Apps Script's
 * services (UrlFetchApp, ScriptApp, MailApp, PropertiesService, Session, Utilities) stood in for, and a small
 * in-memory shared drive answering the very Drive calls it makes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const code = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../watchdog/Code.gs'), 'utf8');
const FOLDER = 'application/vnd.google-apps.folder';
const HOUR = 3600e3;

function google({ drives = [{ id: 'd1', name: 'Website backup' }], noteLocked = false } = {}) {
  const g = { drives, files: [], mail: [], props: new Map(), triggers: [], calls: [], n: 0, noteLocked };
  g.add = (f) => { const file = { id: `f${++g.n}`, modifiedTime: new Date().toISOString(), mimeType: 'application/octet-stream', ...f }; g.files.push(file); return file; };
  const answer = (code, data) => ({ getResponseCode: () => code, getContentText: () => (typeof data === 'string' ? data : JSON.stringify(data)) });
  const fetch = (url, opts = {}) => {
    const u = new URL(url);
    const method = (opts.method || 'get').toLowerCase();
    g.calls.push(`${method} ${u.pathname}`);
    assert.equal(opts.muteHttpExceptions, true, 'every call says what Google answered, never throws on it');
    if (u.pathname === '/drive/v3/drives') return answer(200, { drives: g.drives });
    if (u.pathname === '/drive/v3/files' && method === 'get') {
      const q = u.searchParams.get('q');
      const name = /name = '((?:\\'|[^'])*)'/.exec(q)?.[1];
      const parent = /'([^']+)' in parents/.exec(q)?.[1];
      const folder = /mimeType = '([^']+)'/.exec(q)?.[1];
      let found = g.files.filter((f) => (!name || f.name === name) && (!parent || f.parents[0] === parent) && (!folder || f.mimeType === folder) && f.driveId === u.searchParams.get('driveId'));
      const order = u.searchParams.get('orderBy');
      if (order === 'modifiedTime desc') found.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
      if (order === 'name desc') found.sort((a, b) => b.name.localeCompare(a.name));
      return answer(200, { files: found.slice(0, Number(u.searchParams.get('pageSize') || 100)) });
    }
    let m;
    if ((m = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname))) { const f = g.files.find((x) => x.id === m[1]); return f ? answer(200, f.text) : answer(404, 'no'); }
    if ((m = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname)) && method === 'patch') {
      const f = g.files.find((x) => x.id === m[1]);
      if (g.noteLocked) return answer(403, { error: { message: 'The user does not have sufficient permissions for this file.' } });
      f.text = opts.payload; f.modifiedTime = new Date().toISOString();
      return answer(200, { id: f.id });
    }
    if (u.pathname === '/upload/drive/v3/files' && method === 'post') {
      const meta = JSON.parse(/\r\n\r\n(\{.*\})\r\n/.exec(opts.payload)[1]);
      const text = /text\/plain\r\n\r\n([\s\S]*)\r\n--soard-watchdog--/.exec(opts.payload)[1];
      const f = g.add({ name: meta.name, parents: meta.parents, driveId: meta.parents[0], text, mine: true });
      return answer(200, { id: f.id });
    }
    throw new Error(`the watchdog asked for something unexpected: ${method} ${url}`);
  };
  const props = { getProperty: (k) => g.props.get(k) ?? null, setProperty: (k, v) => { g.props.set(k, String(v)); } };
  const trigger = () => { const t = { at: null }; const b = { timeBased: () => b, atHour: (h) => { t.at = h; return b; }, everyDays: () => b, inTimezone: () => b, create: () => { g.triggers.push(t); return t; } }; return b; };
  g.sandbox = {
    UrlFetchApp: { fetch },
    ScriptApp: { getOAuthToken: () => 'token', getProjectTriggers: () => g.triggers.slice(), deleteTrigger: (t) => { g.triggers = g.triggers.filter((x) => x !== t); }, newTrigger: () => trigger() },
    MailApp: { sendEmail: (m) => g.mail.push(m) },
    PropertiesService: { getScriptProperties: () => props },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'staff@example.org' }) },
    Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) },
    console, JSON, Date, Math, Object, String, Number, Error, encodeURIComponent,
  };
  runInNewContext(code, g.sandbox);
  return g;
}

function withRun(g, { name, finished, ok = true, problems = [], kinds = null, damagedNewer = false }) {
  let nights = g.files.find((f) => f.name === 'Nights');
  if (!nights) nights = g.add({ name: 'Nights', parents: ['d1'], driveId: 'd1', mimeType: FOLDER });
  let year = g.files.find((f) => f.name === name.slice(0, 4) && f.parents[0] === nights.id);
  if (!year) year = g.add({ name: name.slice(0, 4), parents: [nights.id], driveId: 'd1', mimeType: FOLDER });
  const at = new Date(Date.parse(finished) + 60e3).toISOString();
  g.add({ name: `${name}.json`, parents: [year.id], driveId: 'd1', modifiedTime: at, text: JSON.stringify({ run: name, finished, ok, problems, ...(kinds ? { problemKinds: kinds } : {}) }) });
  if (damagedNewer) g.add({ name: `${name}.json`, parents: [year.id], driveId: 'd1', modifiedTime: new Date(Date.parse(at) + 1000).toISOString(), text: '{"run": "dam' });
}
const note = (g) => g.files.filter((f) => f.name === 'Watchdog - last check.txt').sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime))[0]?.text || '';

test('a run that finished well: no email, and the note says so (twice a day)', () => {
  const g = google();
  withRun(g, { name: '2026-11-16', finished: new Date(Date.now() - 6 * HOUR).toISOString(), damagedNewer: true });
  g.sandbox.setUp();
  assert.deepEqual(g.triggers.map((t) => t.at).sort((a, b) => a - b), [9, 15]);
  assert.equal(g.mail.length, 0);
  assert.match(note(g), /The run of 2026-11-16 finished well/);
});

test('no run in a day and a half: one email a day, not one a check', () => {
  const g = google();
  withRun(g, { name: '2026-11-13', finished: new Date(Date.now() - 50 * HOUR).toISOString() });
  g.sandbox.check();
  g.sandbox.check();
  assert.equal(g.mail.length, 1);
  assert.equal(g.mail[0].subject, 'The website backup has stopped');
  assert.match(g.mail[0].body, /No backup run has finished since 2026-11-13/);
  assert.match(note(g), /since 2026-11-13/);
});

test('a run with problems: its own words, once; a newer run asked for by hand counts', () => {
  const g = google();
  withRun(g, { name: '2026-11-16', finished: new Date(Date.now() - 8 * HOUR).toISOString(), ok: false, problems: ['Backblaze isn’t set up or can’t be reached'] });
  g.sandbox.check();
  g.sandbox.check();
  assert.equal(g.mail.length, 1);
  assert.match(g.mail[0].body, /• Backblaze isn’t set up or can’t be reached/);
  withRun(g, { name: '2026-11-16 1004', finished: new Date(Date.now() - 1 * HOUR).toISOString() });
  g.sandbox.check();
  assert.equal(g.mail.length, 1);
  assert.match(note(g), /The run of 2026-11-16 1004 finished well/);
});

test('the drive is found the way the backup finds it, and a missing membership says what to do', () => {
  const g = google({ drives: [{ id: 'd1', name: 'SOARD Back-up' }, { id: 'd2', name: 'Staff' }] });
  withRun(g, { name: '2026-11-16', finished: new Date().toISOString() });
  g.sandbox.check();
  assert.equal(g.mail.length, 0);
  const none = google({ drives: [{ id: 'd2', name: 'Staff' }, { id: 'd3', name: 'Board' }] });
  none.sandbox.check();
  assert.equal(none.mail.length, 1);
  assert.match(none.mail[0].body, /staff@example\.org isn’t a member of a shared drive with “backup” in its name/);
});

test('a note it may not change: a new one beside it, and nothing else goes wrong', () => {
  const g = google({ noteLocked: true });
  g.add({ name: 'Watchdog - last check.txt', parents: ['d1'], driveId: 'd1', modifiedTime: '2026-01-01T00:00:00Z', text: 'old' });
  withRun(g, { name: '2026-11-16', finished: new Date().toISOString() });
  g.sandbox.check();
  assert.equal(g.mail.length, 0);
  assert.match(note(g), /finished well/);
  assert.equal(g.files.filter((f) => f.name === 'Watchdog - last check.txt').length, 2);
});

test('what was told is remembered, whatever else is told in between; a backup that never finishes is told after three days', () => {
  const g = google({ noteLocked: true });
  g.files.push({ id: 'n1', name: 'Watchdog - last check.txt', parents: ['d1'], driveId: 'd1', modifiedTime: '2026-01-01T00:00:00Z', text: 'old' });
  withRun(g, { name: '2026-11-16', finished: new Date().toISOString(), ok: false, problems: ['Backblaze isn’t set up or can’t be reached'] });
  // The note can't be changed and a new one can't be made either: two kinds of trouble, each told once
  g.sandbox.UrlFetchApp.fetch = ((orig) => (url, opts) => (String(url).includes('uploadType=multipart') ? { getResponseCode: () => 403, getContentText: () => 'no' } : orig(url, opts)))(g.sandbox.UrlFetchApp.fetch);
  for (let i = 0; i < 4; i++) g.sandbox.check();
  assert.deepEqual(g.mail.map((m) => m.subject), ['The website backup finished with problems', 'The website backup’s watchdog couldn’t leave its note']);

  const fresh = google();
  fresh.sandbox.setUp();
  assert.equal(fresh.mail.length, 0, 'just set up: nothing to say yet');
  fresh.props.set('setUpAt', new Date(Date.now() - 4 * 24 * 3600e3).toISOString());
  fresh.sandbox.check();
  fresh.sandbox.check();
  assert.equal(fresh.mail.length, 1);
  assert.equal(fresh.mail[0].subject, 'The website backup has never finished a run');
});

test('the same kind of trouble night after night is one email, a new kind is another', () => {
  const g = google();
  withRun(g, { name: '2026-11-15', finished: new Date(Date.now() - 30 * HOUR).toISOString(), ok: false, problems: ['videos couldn’t be listed'], kinds: ['list:videos'] });
  g.sandbox.check();
  withRun(g, { name: '2026-11-16', finished: new Date(Date.now() - 6 * HOUR).toISOString(), ok: false, problems: ['videos couldn’t be listed'], kinds: ['list:videos'] });
  g.sandbox.check();
  assert.equal(g.mail.length, 1, 'Stream off two nights running: one email');
  withRun(g, { name: '2026-11-16 1004', finished: new Date(Date.now() - 1 * HOUR).toISOString(), ok: false, problems: ['videos couldn’t be listed', 'Backblaze isn’t set up or can’t be reached'], kinds: ['list:videos', 'home:b2'] });
  g.sandbox.check();
  assert.equal(g.mail.length, 2, 'a new kind is told');
  assert.match(g.mail[1].body, /Backblaze/);
});

test('trouble that clears is forgotten: the same trouble coming back is told again', () => {
  const g = google();
  withRun(g, { name: '2026-11-14', finished: new Date(Date.now() - 30 * HOUR).toISOString(), ok: false, problems: ['Backblaze isn’t set up or can’t be reached'], kinds: ['home:b2'] });
  g.sandbox.check();
  withRun(g, { name: '2026-11-15', finished: new Date(Date.now() - 20 * HOUR).toISOString() });
  g.sandbox.check();
  withRun(g, { name: '2026-11-16', finished: new Date(Date.now() - 2 * HOUR).toISOString(), ok: false, problems: ['Backblaze isn’t set up or can’t be reached'], kinds: ['home:b2'] });
  g.sandbox.check();
  assert.equal(g.mail.length, 2, 'Backblaze down, well, down again: told twice');
});

test('an old summary sent to Drive again later never passes for the newest', () => {
  const g = google();
  withRun(g, { name: '2026-11-10', finished: new Date(Date.now() - 6 * 24 * HOUR).toISOString() });
  withRun(g, { name: '2026-11-16', finished: new Date(Date.now() - 5 * HOUR).toISOString() });
  // Nov 10's summary sent to Drive again just now (its copy had gone): its file is the newest changed
  const old = g.files.find((f) => f.name === '2026-11-10.json');
  old.modifiedTime = new Date().toISOString();
  g.sandbox.check();
  assert.equal(g.mail.length, 0);
  assert.match(note(g), /The run of 2026-11-16 finished well/);
});
