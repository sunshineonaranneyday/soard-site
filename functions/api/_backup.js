/**
 * The website's side of SOARD's backup. The backup itself is its own Worker, soard-backup (workers/backup), so it
 * never shares time, limits or keys with the site. The site reaches it only through the BACKUP service binding,
 * which opens the backup's one door (its BackupAPI entrypoint; it has no public address), by calling its methods.
 *
 * From here the site:
 *   - shows what the backup reports, in Automations → Hosting → Backup (backupFacts)
 *   - every 15 minutes (maybeBackupChores), first: reads how the backup is and raises an alert when it needs
 *     attention (no finished run in 36 hours, a run that left something out, a failed restore drill, a home it
 *     can't reach, or the site not reaching it twice in a row), again only when a new kind of trouble appears,
 *     and an all-clear when it's well
 *   - then does what only the site may do, with its own Stream key (which the backup never gets): asks Stream for
 *     an MP4 of a video the backup is waiting on (an MP4 is as public or private as its video, and costs nothing
 *     more to keep, so it stays), and, only when a private video waits, hands the backup a Stream signing key
 *     (it opens videos and can't change or delete anything). A key the backup never got, or no longer uses, is
 *     removed from Stream.
 */

const KEY = 'backup_chores'; // site_config
const EVERY_MS = 15 * 60_000;
const CLAIM_MS = 5 * 60_000;
const STALE_MS = 36 * 3600_000;
const DAY = 24 * 3600_000;
const API = 'https://api.cloudflare.com/client/v4';
const MAX_LINES = 8;
const MAX_STREAM_CALLS = 30; // a round's share of the minute hook's time
const ACTIVE = new Set(['queued', 'running', 'paused', 'waiting', 'waitingForPause']);
const iso = (t) => new Date(t).toISOString();
const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const enc = encodeURIComponent;
const short = (e, n = 200) => String(e?.message || e).slice(0, n);

/** One of the backup's methods (BackupAPI), through the binding */
export async function askBackup(env, method, arg) {
  if (!env.BACKUP) throw new Error('the backup isn’t connected to the site yet (the BACKUP service binding)');
  return env.BACKUP[method](arg);
}

async function readChores(DB) {
  const row = await DB.prepare('SELECT data FROM site_config WHERE key = ?').bind(KEY).first();
  return { row, data: parse(row?.data, {}) };
}
const writeChores = (DB, data, now) => DB.prepare('INSERT INTO site_config (key, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at').bind(KEY, JSON.stringify(data), iso(now)).run();

// Only one runner every 15 minutes, however many minute jobs overlap
async function claim(DB, now) {
  const { row, data } = await readChores(DB);
  if (data.at && now - Date.parse(data.at) < EVERY_MS) return null;
  if (data.runningUntil && Date.parse(data.runningUntil) > now) return null;
  const held = JSON.stringify({ ...data, runningUntil: iso(now + CLAIM_MS) });
  const r = row
    ? await DB.prepare('UPDATE site_config SET data = ?, updated_at = ? WHERE key = ? AND data = ?').bind(held, iso(now), KEY, row.data).run()
    : await DB.prepare('INSERT OR IGNORE INTO site_config (key, data, updated_at) VALUES (?, ?, ?)').bind(KEY, held, iso(now)).run();
  return (r?.meta?.changes ?? r?.changes ?? 1) > 0 ? data : null;
}

class StreamError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}
async function stream(env, method, path, fetchImpl) {
  const res = await fetchImpl(`${API}/accounts/${env.CF_ACCOUNT_ID}/stream${path}`, { method, headers: { Authorization: `Bearer ${env.CF_STREAM_TOKEN}` }, signal: AbortSignal.timeout(15_000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new StreamError(`Stream ${res.status}: ${data.errors?.[0]?.message || 'no answer'}`, res.status);
  return data.result;
}

const sentence = (s) => { const t = String(s).trim(); return t.charAt(0).toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? '' : '.'); };
// The same as the backup's own (workers/backup/src/jobs.js setupKind), so a run's setup problem and the setup checked since are one
const setupKind = (p) => (p.missing?.length ? `setup:${p.home}:needs ${[...p.missing].sort().join(', ')}` : `setup:${p.home}:${String(p.why).split(':')[0].replace(/\d+/g, '#')}`);

/**
 * Whether the backup's trouble is alerted yet: once every piece of its setup is in place (`setUpAt`), or a week
 * after its first run whatever is left (a setup half done mustn't silence it for good). Before, the admin's setup
 * steps say what's left, and each step done isn't an alert.
 */
export const alerting = (status, now = Date.now()) => !!(status?.setUpAt || (status?.firstStarted && now - Date.parse(status.firstStarted) > 7 * DAY));

/** What's wrong with the backup now: [{ kind, text }] (empty when it's well); `kind` stays the same while the trouble does */
export function backupProblems(status, now = Date.now(), { siteStream = null } = {}) {
  const out = new Map();
  const add = (kind, text) => { if (!out.has(kind)) out.set(kind, { kind, text: sentence(text) }); };
  if (!alerting(status, now)) return [];
  const n = status.night;
  // The newest run ended (or broke for good) three hours ago without writing its summary: its last step never ran
  const s = status.started;
  if (s && ['complete', 'errored', 'terminated'].includes(s.status) && n?.run !== s.run && now - Date.parse(s.at) > 3 * 3600_000) add('no-summary', `The run of ${s.run} ${s.status === 'complete' ? 'ended' : 'broke'} without writing its summary, so what it copied can’t be told`);
  if (!n) {
    // Never finished a run: worth saying only once its first run started a day and a half ago
    const first = status.firstStarted || s?.at;
    if (first && now - Date.parse(first) > STALE_MS) add('first-run', `The backup’s first run, started ${first.slice(0, 10)}, hasn’t finished`);
  } else {
    if (now - Date.parse(n.finished) > STALE_MS) add('stale', `No backup run has finished since ${n.run}${ACTIVE.has(s?.status) ? ' (one is going now)' : ''}`);
    // The run's own list: everything it found not right (its drill, its homes, files it couldn't copy). Its setup
    // problems only while no check is newer than the run: a step fixed since is fixed.
    const setupNewer = status.setup?.at && Date.parse(status.setup.at) > Date.parse(n.finished);
    (n.problems || []).forEach((text, i) => {
      const kind = n.problemKinds?.[i] || `run:${String(text).split(':')[0].replace(/\d+/g, '#')}`;
      if (!(setupNewer && kind.startsWith('setup:'))) add(kind, text);
    });
  }
  // The setup as checked last (a home that broke since, the recovery sheet still not printed)
  for (const p of status.setup?.problems || []) add(setupKind(p), p.why);
  // The site's own part (its Stream key) failing for six hours
  if (siteStream) add('site-stream', siteStream);
  return [...out.values()];
}

const lines = (texts) => [...texts.slice(0, MAX_LINES), ...(texts.length > MAX_LINES ? [`And ${texts.length - MAX_LINES} more.`] : [])].join('\n');
// An alert counts as sent unless it said it reached nobody
const reached = (r) => !r || r.slack?.ok !== false || (r.email?.sent || 0) > 0;
const SITE_STREAM_MS = 6 * 3600_000;

/**
 * The site's share of the backup's upkeep, every 15 minutes. `alert(card)` posts to Slack (alertAdmins).
 * Never throws: a backup that can't be reached is itself something to alert about.
 */
export async function maybeBackupChores(env, { now = Date.now(), fetchImpl = fetch, alert = null, deadline = Infinity, clock = Date.now } = {}) {
  if (!env.DB || !env.BACKUP) return null;
  let before;
  try { before = await claim(env.DB, now); } catch { return null; }
  if (!before) return null;
  const next = { ...before, at: iso(now), runningUntil: null, done: [], error: null };
  // Kept as it goes: a round cut off part way loses nothing it did
  const save = async () => { try { await writeChores(env.DB, next, now); } catch { /* the claim runs out in 5 minutes and the next round goes again */ } };
  // (an alert a round was sending when it was cut off isn't in here, so it's sent again: a rare repeat, threaded
  // under the open post in Slack, is better than trouble nobody hears of)
  const alerted = new Set(before.alertedKinds || []);

  // 1. How the backup is, and the alert
  let status = null;
  try {
    status = await askBackup(env, 'status');
    next.reached = true;
    next.setUp = alerting(status, now);
    next.misses = 0;
  } catch (e) {
    next.error = short(e);
    next.misses = (before.misses || 0) + 1;
  }
  await save();
  const siteStream = before.choreErrorSince && now - Date.parse(before.choreErrorSince) > SITE_STREAM_MS ? `The site hasn’t been able to do its part for the backup with Stream since ${before.choreErrorSince.slice(0, 16).replace('T', ' ')} UTC: ${before.choreError}` : null;
  // One miss is a redeploy or a blip; two in a row (half an hour) is trouble, once the backup has been set up
  const problems = status ? backupProblems(status, now, { siteStream })
    : before.setUp && next.misses >= 2 ? [{ kind: 'unreachable', text: `The site hasn’t been able to reach the backup for half an hour: ${next.error}.` }]
      : null;
  if (status) next.lastRun = status.night?.run || null;
  if (problems) {
    next.problems = problems.map((p) => p.text);
    const fresh = problems.filter((p) => !alerted.has(p.kind));
    // While the backup can't be read, what was alerted before still stands
    const keep = (kinds) => (status ? kinds : [...new Set([...alerted, ...kinds])]);
    const send = async (card, onSent) => {
      try { if (reached(await alert(card))) onSent(); } catch { /* not sent: tried again in 15 minutes */ }
    };
    if (fresh.length && alert) {
      const wasOpen = !!next.open;
      const order = wasOpen ? [...fresh, ...problems.filter((p) => alerted.has(p.kind))] : problems;
      await send({ level: 'warn', icon: '💾', title: wasOpen ? 'The website backup has new trouble' : 'The website backup needs attention', detail: lines(order.map((p) => p.text)), fix: 'Admin → Automations → Hosting → Backup shows where it stands.', url: 'https://sunshineonaranneyday.com/admin/#automations', issue: 'backup' },
        () => { next.open = true; next.openedAt = wasOpen ? (before.openedAt || iso(now)) : iso(now); next.alertedKinds = keep(problems.map((p) => p.kind)); });
      if (!next.alertedKinds || next.alertedKinds === before.alertedKinds) next.alertedKinds = keep(problems.map((p) => p.kind).filter((k) => alerted.has(k)));
    } else if (problems.length) {
      next.alertedKinds = keep(problems.map((p) => p.kind).filter((k) => alerted.has(k)));
      // Reached again after it couldn't be: said once, with what still isn't right
      if (status && alerted.has('unreachable') && alert) {
        await send({ level: 'info', title: 'The site reaches the website backup again', detail: lines(problems.map((p) => p.text)) }, () => {});
      }
    } else if (next.open && alert) {
      await send({ level: 'info', title: 'The website backup is well again', detail: next.lastRun ? `The run of ${next.lastRun} found nothing wrong.` : 'It answers again.', resolves: 'backup' },
        () => { next.open = false; next.alertedKinds = []; });
    } else {
      next.alertedKinds = [];
    }
  } else {
    next.alertedKinds = [...alerted];
  }
  await save();

  // 2. What only the site may do, with its own Stream key, in the time left
  if (status) {
    next.choreError = null;
    try { await streamChores(env, before, next, { status, fetchImpl, deadline, clock, save, now }); } catch (e) { next.choreError = short(e); }
    next.choreErrorSince = next.choreError ? (before.choreErrorSince || iso(now)) : null;
    await save();
  }
  return next;
}

async function streamChores(env, before, next, { status, fetchImpl, deadline, clock, save, now }) {
  const needs = await askBackup(env, 'needs');
  if (!env.CF_STREAM_TOKEN || !env.CF_ACCOUNT_ID) {
    if (needs.streamKey || needs.videos?.length) throw new Error('the site has no Stream key (CF_STREAM_TOKEN), so it can’t ask Stream for MP4s or a signing key');
    return;
  }
  let calls = 0;
  // Room for `n` more calls to Stream in this round
  const room = (n = 1) => calls + n <= MAX_STREAM_CALLS && clock() < deadline;
  const call = (method, path) => { calls++; return stream(env, method, path, fetchImpl); };
  const keys = { pending: null, made: [], toRemove: [], ...(before.keys || {}) };
  next.keys = keys;
  let holds = status.streamKey?.id || null;
  const problems = [];

  // A round cut off between asking Stream for a key and writing its id down: nothing else on the site makes
  // signing keys, so a key Stream made around then that the backup doesn't hold is that one
  if (keys.pending?.making && room()) {
    const from = Date.parse(keys.pending.making) - 60_000;
    for (const k of (await call('GET', '/keys')) || []) {
      const t = Date.parse(k.created);
      if (t >= from && t <= from + 5 * 60_000 && k.id !== holds) keys.made.push(k.id);
    }
    keys.pending = null;
    await save();
  }
  keys.pending = null;

  // A signing key, when the backup needs one; a handoff that fails doesn't stop the rest
  let unsure = null;
  if (needs.streamKey && room()) {
    let made = null;
    try {
      keys.pending = { making: iso(clock()) };
      await save();
      const k = await call('POST', '/keys');
      made = k.id;
      keys.made.push(made);
      keys.pending = null;
      await save();
      await askBackup(env, 'setStreamKey', { id: k.id, jwk: k.jwk });
      holds = made;
      next.done.push('handed the backup a Stream signing key');
    } catch (e) {
      // Whether the backup kept it can't be told from here (its answer may be what was lost): the next round reads
      // which key it holds, and only then is this one removed if it isn't that
      unsure = made;
      problems.push(`handing the backup a Stream signing key: ${short(e, 160)}`);
    }
    await save();
  }

  // Every key the site made that the backup doesn't hold goes from Stream: one it replaced, one it never got
  const keep = (id) => id === holds || id === unsure;
  keys.toRemove = [...new Set([...(keys.toRemove || []), ...keys.made])].filter((id) => !keep(id));
  keys.made = keys.made.filter(keep);
  for (const id of [...keys.toRemove]) {
    if (!room()) break;
    try {
      await call('DELETE', `/keys/${enc(id)}`);
      next.done.push(`removed the Stream signing key ${id}, which the backup doesn’t use`);
    } catch (e) {
      if (e.status !== 404) { problems.push(`removing the Stream signing key ${id}: ${short(e, 120)}`); continue; }
    }
    keys.toRemove = keys.toRemove.filter((x) => x !== id);
    await save();
  }

  // MP4s the backup is waiting on: each asked for at most once a day; one Stream failed to make is asked for again
  const waiting = needs.videos || [];
  const asked = Object.fromEntries(Object.entries(before.askedMp4 || {}).filter(([uid]) => waiting.includes(uid)));
  next.askedMp4 = asked;
  for (const uid of waiting) {
    if (asked[uid] && now - Date.parse(asked[uid]) < DAY) continue;
    if (!room(3)) break; // a look, and if need be a clearing and an ask
    try {
      const have = (await call('GET', `/${enc(uid)}/downloads`))?.default;
      if (have?.status === 'error') await call('DELETE', `/${enc(uid)}/downloads`);
      if (!have || have.status === 'error') {
        await call('POST', `/${enc(uid)}/downloads`);
        next.done.push(`asked Stream for an MP4 of video ${uid}${have ? ' again (it failed to make one)' : ''}`);
      }
      asked[uid] = iso(now);
    } catch (e) {
      if (e.status === 404) asked[uid] = iso(now); // gone from Stream: the backup's next listing drops it
      else problems.push(`asking Stream for an MP4 of video ${uid}: ${short(e, 120)}`);
    }
    await save();
  }
  if (problems.length) throw new Error(problems.slice(0, 3).join('; '));
}

/** What Automations shows: the backup's own report, and the site's last upkeep (no keys, no file contents) */
export async function backupFacts(env, { now = Date.now() } = {}) {
  let chores = {};
  try { if (env.DB) chores = (await readChores(env.DB)).data; } catch { /* shown without the upkeep */ }
  const upkeep = { at: chores.at || null, done: chores.done || [], open: !!chores.open, error: chores.error || null, choreError: chores.choreError || null, choreErrorSince: chores.choreErrorSince || null, reached: !!chores.reached };
  if (!env.BACKUP) return { connected: false, reachable: false, chores: upkeep };
  try {
    const status = await askBackup(env, 'status');
    return { connected: true, reachable: true, ...status, problems: backupProblems(status, now).map((p) => p.text), chores: upkeep };
  } catch (e) {
    return { connected: true, reachable: false, error: short(e, 300), chores: upkeep };
  }
}
