/**
 * Everything on SOARD's Cloudflare account that holds data, found fresh at the start of every run, so nothing new is
 * ever left out because nobody remembered to add it:
 *   - every D1 database, R2 bucket, KV namespace and Vectorize index is copied (the backup's own staging bucket and
 *     its spare drill database aside)
 *   - every Worker's deployed code is copied, whether or not it's in a repo
 *   - a Durable Object's data can only be read by its own Worker, so each one must be on NOT_COPIED below with the
 *     reason its data is safe elsewhere; one that isn't is a problem in the run's summary
 *   - Queues, Hyperdrive and Pipelines hold nothing of their own here (a message passes through; Hyperdrive points at
 *     a database outside Cloudflare; a pipeline writes into R2, which is copied): when there are any, it's said
 * A kind of thing the read-only key may not list is a problem too, naming the permission to add.
 */
import { SourceError } from './sources.js';

/** Durable Objects whose data needs no copy of its own, and why (checked Nov 16, 2026 against each one's code) */
export const NOT_COPIED = {
  'soard-backup:BackupState': 'the backup’s own records: every copy is in both homes, and the key is on the printed recovery sheet',
  'soard-live-hub:LiveHub': 'the live show’s working state: the site keeps each show and its reaction totals in its own database, which is copied',
  'soard-live-hub:PrintHub': 'only when the label printer last connected',
  'deploy-coordinator:DeployCoordinator': 'a publish timer and the address of the site’s Pages deploy hook, which Pages makes again if ever lost',
};

// What each listing is called in the run's words
const LABEL = { databases: 'databases', buckets: 'R2 buckets', regionBuckets: 'R2 buckets kept in a region', kv: 'KV namespaces', vectorize: 'Vectorize indexes', workers: 'Workers', durableObjects: 'Durable Objects', queues: 'queues', hyperdrive: 'Hyperdrive connections', pipelines: 'pipelines', pages: 'Pages projects' };

/** Workers that serve static files (assets), and where those files are kept (none on the account, Nov 16, 2026) */
export const ASSETS_KEPT = {};

/** The permission (as Cloudflare's token page names it) each listing needs */
export const PERMISSION = {
  databases: 'D1 Read', buckets: 'Workers R2 Storage Read', regionBuckets: 'Workers R2 Storage Read', pages: 'Pages Read', kv: 'Workers KV Storage Read', vectorize: 'Vectorize Read',
  workers: 'Workers Scripts Read', durableObjects: 'Workers Scripts Read', queues: 'Workers Scripts Read',
  hyperdrive: 'Hyperdrive Read', pipelines: 'Pipelines Read',
};

// Every page of a listing: by the total Cloudflare gives (pages or items) when it gives one, otherwise until a page
// comes back short; one with more pages than `max` is trouble, never a listing quietly cut off
export const pages = async (api, path, { perPage = 100, max = 200 } = {}) => {
  const out = [];
  for (let page = 1; page <= max; page++) {
    const body = await api(path, { query: { per_page: perPage, page } });
    const items = Array.isArray(body.result) ? body.result : [];
    out.push(...items);
    const totalPages = Number(body.result_info?.total_pages) || 0;
    const totalCount = body.result_info?.total_count;
    if (!items.length) return out;
    if (totalPages ? page >= totalPages : totalCount != null ? out.length >= Number(totalCount) : items.length < perPage) return out;
  }
  throw new Error(`${path} has more than ${max} pages`);
};

/**
 * The account's inventory: { databases, buckets, kv, vectorize, workers, durableObjects, queues, hyperdrive,
 * pipelines, notListed: [{ type, permission, why }] }. `skip` names the backup's own scratch database and bucket.
 */
export async function inventory(api, { skip = {} } = {}) {
  const inv = { databases: [], buckets: [], regionBuckets: [], kv: [], vectorize: [], workers: [], durableObjects: [], queues: [], hyperdrive: [], pipelines: [], pages: [], notListed: [] };
  // A listing the key isn't allowed to make names its permission; any other trouble (Cloudflare down, after the API
  // helper's own retries) is said as it is, never as a permission to add
  const take = async (type, fn) => {
    try { inv[type] = await fn(); } catch (e) {
      const refused = e instanceof SourceError && (e.status === 403 || e.status === 401);
      inv.notListed.push({ type, permission: refused ? PERMISSION[type] : null, why: refused ? 'the read-only key isn’t allowed to list them' : String(e?.message || e).slice(0, 200) });
    }
  };
  await take('databases', async () => (await pages(api, '/d1/database', { perPage: 1000 })).filter((d) => d.name !== skip.database).map((d) => ({ name: d.name, id: d.uuid, size: d.file_size ?? null })));
  await take('buckets', async () => {
    const out = [];
    let cursor = null;
    for (let i = 0; i < 50; i++) {
      const body = await api('/r2/buckets', { query: { per_page: 1000, cursor } });
      for (const b of body.result?.buckets || body.result || []) if (b.name !== skip.bucket) out.push(b.name);
      cursor = body.result_info?.cursor;
      if (!cursor) break;
    }
    return out.sort();
  });
  // Buckets kept in a region of their own (EU, US) are listed only when asked for by region
  await take('regionBuckets', async () => {
    const out = [];
    for (const region of ['eu', 'us']) for (const b of (await api('/r2/buckets', { headers: { 'cf-r2-jurisdiction': region } })).result?.buckets || []) out.push({ name: b.name, region });
    return out;
  });
  // Each Pages project and where it's built from: its code is copied only if that repository is in REPOS
  await take('pages', async () => (await pages(api, '/pages/projects', { perPage: 10 })).map((p) => ({ name: p.name, source: p.source?.type || null, repo: p.source?.config ? `${p.source.config.owner}/${p.source.config.repo_name}` : null })));
  await take('kv', async () => (await pages(api, '/storage/kv/namespaces')).map((n) => ({ id: n.id, title: n.title })));
  await take('vectorize', async () => ((await api('/vectorize/v2/indexes')).result || []).map((x) => ({ name: x.name, dimensions: x.config?.dimensions ?? null, metric: x.config?.metric ?? null })));
  await take('workers', async () => ((await api('/workers/scripts')).result || []).map((w) => ({ name: w.id, modified: w.modified_on || null, assets: !!w.has_assets })));
  await take('durableObjects', async () => (await pages(api, '/workers/durable_objects/namespaces')).map((n) => ({ script: n.script || null, class: n.class || n.name, id: n.id })));
  await take('queues', async () => (await pages(api, '/queues')).map((q) => q.queue_name));
  await take('hyperdrive', async () => (await pages(api, '/hyperdrive/configs')).map((h) => h.name));
  // Pipelines has a newer listing and an older one; each lists what was made through it
  await take('pipelines', async () => {
    const names = new Set();
    for (const path of ['/pipelines/v1/pipelines', '/pipelines']) {
      try { for (const p of await pages(api, path, { perPage: 25 })) names.add(p.name); } catch (e) { if (!(e instanceof SourceError && e.status === 404)) throw e; }
    }
    return [...names];
  });
  return inv;
}

/**
 * What the inventory means for the run's summary: problems [{ kind, text, plain }], notes, and notCopied [{ what, why }]
 * (everything on the account that has no copy of its own, and why that's safe). A Durable Object not on NOT_COPIED,
 * and anything that couldn't be listed (unless the setup check already names its permission), is a problem.
 */
export function coverage(inv, { permissionsNamed = [], repos = null } = {}) {
  const problems = [];
  const notes = [];
  const notCopied = [];
  if (!inv) return { problems: [{ kind: 'coverage:inventory', text: 'the account’s inventory couldn’t be read, so only the databases and buckets set in the backup’s settings were copied', plain: 'the account’s inventory couldn’t be read' }], notes, notCopied };
  // Said every night it isn't copied, even while the setup check names the permission (so a run that copied less is
  // never taken for a run that was well): only the words point to the setup check then
  for (const n of inv.notListed || []) {
    const what = LABEL[n.type] || n.type;
    const text = !n.permission ? `the backup couldn’t list the account’s ${what}, so they weren’t copied tonight: ${n.why}`
      : permissionsNamed.includes(n.permission) ? `the account’s ${what} weren’t copied tonight: the read-only key needs “${n.permission}” (as the setup check says)`
        : `the backup couldn’t list the account’s ${what} (${n.why}), so they weren’t copied tonight: give the read-only key “${n.permission}”`;
    problems.push({ kind: `coverage:list:${n.type}`, text, plain: `the account’s ${what} weren’t copied tonight` });
  }
  // A Worker's static files (assets) can't be read back from Cloudflare: each must be on ASSETS_KEPT, naming where
  // they're kept, or it's a problem
  for (const w of inv.workers || []) {
    if (!w.assets) continue;
    if (ASSETS_KEPT[w.name]) notCopied.push({ what: `the static files of the Worker ${w.name}`, why: ASSETS_KEPT[w.name] });
    else problems.push({ kind: `coverage:assets:${w.name}`, text: `the Worker ${w.name} serves static files, which Cloudflare can’t give back to copy: they need to be in a repository the backup copies, and then on the list in workers/backup/src/inventory.js`, plain: `a Worker’s static files no one has checked (${w.name})` });
  }
  // A bucket kept in a region: the copy reads buckets without a region, so it isn't copied
  for (const b of inv.regionBuckets || []) problems.push({ kind: `coverage:region:${b.name}`, text: `the R2 bucket ${b.name} is kept in the ${b.region.toUpperCase()} region, which the backup doesn’t copy yet: it needs adding to the backup`, plain: `an R2 bucket in a region the backup doesn’t copy (${b.name})` });
  // A Pages project built from a repository the backup doesn't copy (or uploaded directly, with no repository)
  if (repos) for (const p of inv.pages || []) if (!p.repo || !repos.includes(p.repo)) problems.push({ kind: `coverage:pages:${p.name}`, text: p.repo ? `the Pages project ${p.name} is built from ${p.repo}, which the backup doesn’t copy: add it to REPOS in workers/backup/wrangler.toml` : `the Pages project ${p.name} isn’t built from a repository, so its code is nowhere the backup copies`, plain: `a Pages project whose code isn’t copied (${p.name})` });
  for (const d of inv.durableObjects || []) {
    const key = `${d.script}:${d.class}`;
    if (NOT_COPIED[key]) notCopied.push({ what: `Durable Object ${d.class} (Worker ${d.script})`, why: NOT_COPIED[key] });
    else problems.push({ kind: `coverage:do:${key}`, text: `the Durable Object ${d.class} in the Worker ${d.script} holds data only that Worker can read, and nothing says where else its data is kept: it needs checking, and then copying or adding to the list of ones that needn’t be (workers/backup/src/inventory.js)`, plain: `a Durable Object no one has checked (${key})` });
  }
  const also = [
    [inv.queues, 'queue', 'a message only passes through (its sender has it); the queue itself is in the settings copy'],
    [inv.hyperdrive, 'Hyperdrive connection', 'it points at a database outside Cloudflare, backed up where it lives; the connection is in the settings copy'],
    [inv.pipelines, 'pipeline', 'what it writes lands in R2, which is copied; the pipeline is in the settings copy'],
  ];
  for (const [list, what, why] of also) {
    if (!list?.length) continue;
    notes.push(`${list.length} ${what}${list.length === 1 ? '' : 's'}: ${why}`);
    for (const name of list) notCopied.push({ what: `${what[0].toUpperCase()}${what.slice(1)} ${name}`, why });
  }
  return { problems, notes, notCopied };
}
