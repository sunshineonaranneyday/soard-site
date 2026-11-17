/**
 * One backup run as a Cloudflare Workflow: each job (./jobs.js) is a step, so a step cut off part way is tried again
 * with backoff (and picks up where it stopped, as every job does), and a job that keeps failing is written down and
 * the run goes on to the next one. Nothing here shares time or limits with the website.
 *
 * Every step talks to the backup's records through a stub of its own: a stub that saw an error can stay broken, and
 * a step tried again must not inherit one.
 */
import { WorkflowEntrypoint } from 'cloudflare:workers';
import * as jobs from './jobs.js';
import * as extra from './extra.js';

export const stateOf = (env) => env.STATE.get(env.STATE.idFromName('backup'));
const stepOptions = (env) => ({ retries: { limit: 5, delay: env.STEP_DELAY || '2 minutes', backoff: 'exponential' }, timeout: '30 minutes' });
const drillOptions = (env) => ({ retries: { limit: 2, delay: env.STEP_DELAY || '5 minutes', backoff: 'linear' }, timeout: '30 minutes' });
export const MAX_FILE_STEPS = 5000;
export const MAX_SHIP_STEPS = 400;

export class Night extends WorkflowEntrypoint {
  async run(event, step) {
    const env = this.env;
    const { run, drill } = event.payload;
    const errors = [];
    const sections = { run, started: new Date(event.timestamp || Date.now()).toISOString(), drill: !!drill };
    const STEP = stepOptions(env);
    const safe = async (name, fn, opts = STEP) => {
      try { return await step.do(name, opts, fn); } catch (e) { errors.push({ step: name, error: String(e?.message || e).slice(0, 300) }); return null; }
    };
    // Each step attempt: its own stub, the homes as they are right now, and its own name for the copies it ships (so
    // an attempt Cloudflare gave up on that is somehow still going never ships the same copy beside its retry)
    const job = (fn) => async () => { const state = stateOf(env); return fn(state, await jobs.homes(env, state), `${event.instanceId}:${crypto.randomUUID().slice(0, 8)}`); };
    const cfg = jobs.config(env);
    // A run copies files for 20 hours at most, so the next night's databases are never held up behind a long run
    const until = new Date(event.timestamp || Date.now()).getTime() + Number(env.FILES_HOURS || 20) * 3600_000;

    const setup = await safe('check setup', async () => {
      const state = stateOf(env);
      await state.resetTries();
      await state.set('shipTrouble', null);
      const s = await jobs.checkSetup(env, state);
      // A home that's up now and wasn't last run: what's been waiting for it starts its wait now (not "stuck")
      const up = s.homes || {};
      const was = (await state.get('homesUp')) || {};
      for (const home of ['drive', 'b2']) if (up[home] && !was[home]) await state.requeueUnshipped(home);
      await state.set('homesUp', { drive: !!up.drive, b2: !!up.b2 });
      return { ready: s.ready, problems: s.problems.length };
    });
    sections.ready = !!setup?.ready;
    if (setup?.ready) {
      // What's on the account right now: every database, bucket, KV namespace, Vectorize index and Worker is copied
      const inv = await safe('inventory', job((state) => extra.inventoryJob(env, state)));
      const t = extra.targets(env, inv);
      // What this run copies by name (the admin checks each database against it, found later or not)
      sections.targets = { databases: t.databases.map((d) => d.name), buckets: t.buckets };
      sections.inventory = inv ? { pages: inv.pages.length, databases: inv.databases.length, buckets: inv.buckets.length, kv: inv.kv.length, vectorize: inv.vectorize.length, workers: inv.workers.length, durableObjects: inv.durableObjects.length, notListed: inv.notListed.map((n) => ({ type: n.type, permission: n.permission, why: n.permission ? null : n.why })) } : null;
      sections.databases = [];
      for (const db of t.databases) sections.databases.push(await safe(`database ${db.name}`, job((state, h, by) => jobs.databaseJob(env, state, h, db, run, { by }))));
      sections.settings = await safe('cloudflare settings', job((state, h, by) => jobs.settingsJob(env, state, h, run, { by })));
      sections.code = [];
      for (const repo of cfg.repos) sections.code.push(await safe(`code ${repo}`, job((state, h, by) => jobs.codeJob(env, state, h, repo, run, { by }))));
      // KV namespaces, a part a step; a part unchanged since its last copy isn't sent again, and the manifest says
      // which file holds each part
      sections.kv = [];
      for (const ns of t.kv) {
        const l = await safe(`kv ${ns.title} list`, job((state) => extra.kvListJob(env, state, ns, run)));
        if (!l) { sections.kv.push({ namespace: ns.title, ok: false }); continue; }
        let ok = true;
        let changed = false;
        let gone = 0;
        for (let p = 1; p <= l.parts; p++) {
          const r = await safe(`kv ${ns.title} part ${p}`, job((state, h, by) => extra.kvPartJob(env, state, h, ns, run, p, l, { by })));
          if (!r) ok = false; else { if (!r.unchanged) changed = true; gone += r.gone || 0; }
        }
        const done = ok ? await safe(`kv ${ns.title} manifest`, job((state, h, by) => extra.kvDoneJob(env, state, h, ns, run, l, { by }))) : null;
        sections.kv.push({ namespace: ns.title, listed: l.count, keys: done?.keys ?? null, gone, parts: l.parts, changed, ok: ok && !!done });
      }
      // Vectorize indexes, a part a step, when the index has changed; the manifest names every file of the copy
      sections.vectorize = [];
      for (const ix of t.vectorize) {
        const l = await safe(`vectorize ${ix.name} list`, job((state) => extra.vectorizeListJob(env, state, ix, run)));
        if (!l) { sections.vectorize.push({ index: ix.name, ok: false }); continue; }
        let ok = true;
        if (!l.unchanged) for (let p = 1; p <= l.parts; p++) if (!(await safe(`vectorize ${ix.name} part ${p}`, job((state, h, by) => extra.vectorizePartJob(env, state, h, ix, run, p, l, { by }))))) ok = false;
        const done = ok ? await safe(`vectorize ${ix.name} manifest`, job((state, h, by) => extra.vectorizeDoneJob(env, state, h, ix, run, l, { by }))) : null;
        sections.vectorize.push({ index: ix.name, vectors: l.unchanged ? l.count : done?.vectors ?? null, parts: l.parts ?? null, unchanged: !!l.unchanged, ok: ok && !!done });
      }
      // Every Worker's deployed code, when it has changed
      sections.workers = await safe('workers code', job((state, h, by) => extra.workersCodeJob(env, state, h, t.workers, run, { by })));
      sections.listed = await safe('list files', async () => jobs.listJob(env, stateOf(env), run, { buckets: t.buckets }));
      sections.files = { copied: 0, failed: 0, steps: 0, left: null };
      // A step that fails (all its tries) charges what it was on and the next step carries on with the rest; three
      // in a row means a home or Cloudflare is down, and the next run carries on
      // and three batches in a row that no home took (one batch could be one video and one busy moment) stop it too
      let failedSteps = 0;
      let noHomeSteps = 0;
      for (let n = 1; n <= MAX_FILE_STEPS; n++) {
        const r = await safe(`files ${n}`, job((state, h, by) => jobs.filesJob(env, state, h, run, { by, until })));
        if (!r) { if (++failedSteps >= 3) break; continue; }
        failedSteps = 0;
        sections.files.copied += r.copied;
        sections.files.failed += r.failed;
        sections.files.steps = n;
        sections.files.left = r.left;
        sections.files.gaveUp = r.gaveUp;
        if (r.outOfTime) { sections.files.outOfTime = true; break; }
        if (r.noHome && r.left) { if (++noHomeSteps >= 3) { sections.files.noHome = true; break; } } else noHomeSteps = 0;
        if (!r.left) break;
      }
      // What Drive still holds; anything gone is shipped again just below
      sections.audit = await safe('drive audit', job((state, h) => jobs.auditJob(env, state, h)));
      // Ends when nothing is left, or every copy that could go has been tried since a home last took one (each one
      // tried goes behind the rest, so batches cycle through them all: one home refusing never stops the other)
      let triedSinceGain = 0;
      for (let n = 1; n <= MAX_SHIP_STEPS; n++) {
        const r = await safe(`ship ${n}`, job((state, h, by) => jobs.shipJob(env, state, h, { by })));
        if (!r || !r.left || !r.tried) break;
        triedSinceGain = r.gained ? 0 : triedSinceGain + r.tried;
        if (triedSinceGain >= r.shippable) break;
      }
      sections.list = await safe('files list', job((state, h, by) => jobs.fileListJob(env, state, h, run, { by })));
      if (drill) {
        for (const db of t.databases) await safe(`drill ${db.name}`, job((state, h, by) => jobs.drillDatabaseJob(env, state, h, db, run)), drillOptions(env));
        await safe('drill files', job((state, h, by) => jobs.drillFilesJob(env, state, h, run)), drillOptions(env));
        for (const repo of cfg.repos) await safe(`drill code ${repo}`, job((state, h, by) => jobs.drillCodeJob(env, state, h, repo, run)), drillOptions(env));
        sections.drill = await safe('drill report', job((state, h, by) => jobs.drillReportJob(env, state, h, run, { by, databases: t.databases.map((d) => d.name) })), drillOptions(env)) || { ok: false, problems: 'its report couldn’t be written' };
      }
    }
    sections.errors = errors;
    await safe('finish', job((state, h, by) => jobs.finishJob(env, state, h, run, sections, { by })));
  }
}
