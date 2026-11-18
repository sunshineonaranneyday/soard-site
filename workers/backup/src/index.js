/**
 * soard-backup: SOARD's nightly backup, its own Worker, apart from the website so the two never share time,
 * limits or keys. Every 15 minutes the cron starts the night's run (a Workflow, ./flow.js) once it's past 2 AM
 * Eastern and no run is going.
 *
 * It has no public address (no workers.dev, no route), and its default entrypoint answers nothing. The website
 * reaches it only through its service binding (BACKUP, entrypoint BackupAPI), from the admin (Automations →
 * Hosting → Backup) and its own minute jobs, by calling the methods of BackupAPI below. The backup key leaves only
 * through recoverySheet, which records who asked. Its other entrypoint, Jobs (./flow.js), is the run's own: each
 * step's work, called through ctx.exports so every step has an invocation (and CPU time) of its own; no Worker is
 * bound to it.
 */
import { WorkerEntrypoint } from 'cloudflare:workers';
import { Night, Jobs, stateOf } from './flow.js';
import { BackupState } from './state.js';
import { checkSetup, config, drillPassed } from './jobs.js';

export { Night, Jobs, BackupState };

const START_HOUR = 2; // Eastern
// A run in one of these is still going: another must not start beside it
export const ACTIVE = new Set(['queued', 'running', 'paused', 'waiting', 'waitingForPause']);

/** The night's name (its Eastern date), the Eastern hour and minute, the weekday */
export function eastern(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(now).map((p) => [p.type, p.value]));
  return { night: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), hhmm: `${parts.hour}${parts.minute}`, weekday: parts.weekday };
}

/** A run's state ('running', 'complete', 'errored' …), 'gone' when Cloudflare has no such run, 'unknown' when it couldn't say */
export async function runStatus(env, id) {
  let instance = null;
  try {
    instance = await env.NIGHT.get(id);
    const st = await instance.status();
    const value = st.status;
    st?.[Symbol.dispose]?.();
    return value || 'unknown';
  } catch (e) {
    return /not[\s_.-]?found/i.test(String(e?.message || e)) ? 'gone' : 'unknown';
  } finally {
    instance?.[Symbol.dispose]?.();
  }
}

/**
 * Starts a run if one should start: the schedule's (`by` empty) once a night after 2 AM, tried again if it broke
 * (twice at most); or one someone asked for (`by` their name), now. Never while another run is going.
 * Only TEST_MODE may name the run or choose the drill.
 */
export async function startNight(env, { now = new Date(), by = null, run: named = null, drill: drillAsked = null } = {}) {
  const t = eastern(now);
  const scheduled = !by;
  if (scheduled && t.hour < START_HOUR) return { started: false, why: 'before 2 AM' };
  const state = stateOf(env);
  const ticket = crypto.randomUUID();
  // One starter at a time (the schedule and a person pressing "Back up now" in the same moment)
  if (!(await state.claimStart(ticket, 60_000))) return { started: false, why: 'another start is under way' };
  try {
    const latest = await state.get('started');
    if (latest?.id) {
      const st = await runStatus(env, latest.id);
      if (ACTIVE.has(st)) return { started: false, why: `a backup is running now (${latest.run})`, id: latest.id, status: st };
      if (st === 'unknown') return { started: false, why: 'Cloudflare couldn’t say whether the last run is still going; it’s asked again in 15 minutes' };
    }
    let restarts = 0;
    if (scheduled) {
      const last = await state.get('scheduled');
      if (last?.night === t.night) {
        const st = await runStatus(env, last.id);
        if (st === 'complete') return { started: false, why: 'tonight’s backup is done', id: last.id };
        if (st === 'unknown') return { started: false, why: 'Cloudflare couldn’t say how tonight’s run went; it’s asked again in 15 minutes' };
        if ((last.restarts || 0) >= 2) return { started: false, why: 'tonight’s run broke three times; it’s in the alerts', id: last.id };
        restarts = (last.restarts || 0) + 1;
      }
    }
    const test = env.TEST_MODE === '1';
    const run = test && /^\d{4}-\d{2}-\d{2}( \d{4})?$/.test(named || '') ? named : scheduled ? t.night : `${t.night} ${t.hhmm}`;
    const lastDrill = await state.get('drill');
    const drill = test && typeof drillAsked === 'boolean' ? drillAsked : (scheduled && t.weekday === 'Sun') || !drillPassed(lastDrill, config(env));
    const id = `${scheduled ? 'night' : 'run'}-${run.replace(' ', '-')}-${ticket.slice(0, 8)}`;
    const record = { run, id, at: now.toISOString(), drill, by: by || 'schedule', restarts };
    // Written down before it's made, so a run can never be going unrecorded (one that failed to start reads as gone)
    await state.set('started', record);
    if (scheduled) await state.set('scheduled', { night: t.night, id, restarts });
    const instance = await env.NIGHT.create({ id, params: { run, drill } });
    instance?.[Symbol.dispose]?.();
    // When the very first run started (the site says so if no run has finished a day and a half after it)
    if (!(await state.get('firstStarted'))) await state.set('firstStarted', record.at);
    return { started: true, ...record };
  } finally {
    await state.releaseStart(ticket);
  }
}

/** Everything the admin shows: never the backup key or the Stream key */
export async function status(env) {
  const state = stateOf(env);
  const [setup, night, drill, started, counts, needs, recovery, key, streamKey, firstStarted, setUpAt] = await Promise.all([
    state.get('setup'), state.get('night'), state.get('drill'), state.get('started'), state.counts(), state.get('needs'), state.get('recovery'), state.publicKey(), state.get('streamKey'), state.get('firstStarted'), state.get('setUpAt'),
  ]);
  const running = started?.id ? await runStatus(env, started.id) : null;
  const cfg = config(env);
  // The newest run as it stands, going or done: the files it has left and those it couldn't copy (each with why),
  // each home's refusal in its own words, and how many copies still wait for each home. A first run takes hours, and
  // its summary says all this only once it ends.
  // (never at the cost of the rest: the site takes a status that fails for the backup being unreachable; one that
  // can't be read says why)
  const progress = started?.run ? await state.progress(started.run).catch((e) => ({ run: started.run, error: String(e?.message || e).slice(0, 300) })) : null;
  return {
    setup, night, drill, started: started ? { ...started, status: running } : null, progress, firstStarted, setUpAt, counts, needs: needs || {},
    recovery: recovery || {}, key: { fingerprint: key.fingerprint, made: key.made }, streamKey: streamKey ? { id: streamKey.id, at: streamKey.at, refused: streamKey.refused || null } : null,
    databases: cfg.databases.map((d) => d.name), repos: cfg.repos,
  };
}

const who = (by) => String(by || '').slice(0, 200);

/** What the website calls, through its service binding (entrypoint BackupAPI) */
export class BackupAPI extends WorkerEntrypoint {
  status() { return status(this.env); }
  check() { return checkSetup(this.env, stateOf(this.env)); }
  /** "Back up now": { by } is who pressed it */
  run({ by, run, drill } = {}) {
    if (!who(by)) throw new Error('who asked is needed');
    return startNight(this.env, { by: who(by), run, drill });
  }
  /**
   * What the site should do for the backup, from the newest listing: ask Stream for an MP4 of each video waiting on
   * one, and hand over a Stream signing key when a private video waits and the backup has none Stream takes
   */
  async needs() {
    const state = stateOf(this.env);
    const [videos, privateWaiting, key] = await Promise.all([state.videosWaitingForMp4(), state.privateVideosWaiting(), state.get('streamKey')]);
    return { streamKey: privateWaiting > 0 && (!key || !!key.refused), videos };
  }
  /** The Stream signing key ({ id, jwk }): it opens private videos and does nothing else. Says which key it replaced, for the site to remove. */
  async setStreamKey({ id, jwk } = {}) {
    if (!id || !jwk) throw new Error('id and jwk are needed');
    const state = stateOf(this.env);
    const old = await state.get('streamKey');
    await state.set('streamKey', { id: String(id), jwk, at: new Date().toISOString() });
    return { ok: true, replaced: old && old.id !== String(id) ? old.id : null };
  }
  /** The backup key, to print: who asked and when is kept */
  async recoverySheet({ by } = {}) {
    if (!who(by)) throw new Error('who asked is needed');
    const state = stateOf(this.env);
    const [identity, key, r] = await Promise.all([state.secretKey(), state.publicKey(), state.get('recovery')]);
    await state.set('recovery', { ...(r || {}), shown: [...((r || {}).shown || []).slice(-19), { by: who(by), at: new Date().toISOString() }] });
    return { identity, fingerprint: key.fingerprint, made: key.made };
  }
  /** The sheet is printed and put away */
  async recoveryPrinted({ by } = {}) {
    if (!who(by)) throw new Error('who printed it is needed');
    const state = stateOf(this.env);
    const key = await state.publicKey();
    // The sheet printed is for this key: a new key (if one is ever made) needs its own
    const recovery = await state.merge('recovery', { printed: { by: who(by), at: new Date().toISOString(), fingerprint: key.fingerprint } });
    // The setup checked again at once, so the admin and the alert see the sheet printed now, not after the next run
    try { await checkSetup(this.env, state); } catch { /* the next check sees it */ }
    return recovery;
  }
}

/** The default entrypoint: the schedule, and nothing for anyone who knocks */
export default class extends WorkerEntrypoint {
  fetch() { return new Response('Not found', { status: 404 }); }
  scheduled(controller) { this.ctx.waitUntil(startNight(this.env, { now: new Date(controller.scheduledTime) })); }
}
