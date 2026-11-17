/**
 * The rest of what's on the account, as the inventory finds it (./inventory.js), so nothing is left out:
 *   - each KV namespace, in parts of KV_PART keys, as the very file `wrangler kv bulk put` takes back
 *   - each Vectorize index, in parts of VEC_PART vectors, as the very file `wrangler vectorize insert` takes back;
 *     only when the index has changed since its last copy
 *   - each Worker's deployed code (whether or not it's in a repo), when it has changed
 * A part is a step of its own, so a namespace or an index of any size fits, and a part cut off is tried again on
 * its own. What the parts are drawn from is kept in the staging bucket between steps (work/…), never in a step's
 * output, which has to stay small.
 *
 * Each part copy is tied to the very listing it was cut from (a code of the names in it, in its id and its file
 * name): a night started again after it broke lists afresh, and a part cut from the first listing is never put
 * beside parts cut from the second. A manifest beside the parts names exactly the files that make up the copy, so
 * putting one back never means working that out.
 */
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { cfApi, SourceError } from './sources.js';
import { inventory } from './inventory.js';
import { stageEncrypted } from './stage.js';
import { config, ship, stageCopy, stagePlain, stageKey, record, year, errText } from './jobs.js';

export const KV_PART = 500;
export const VEC_PART = 1000;
// (smaller in the tests, so a few keys or vectors make several parts)
const kvPart = (env) => Number(env.KV_PART_KEYS) || KV_PART;
const vecPart = (env) => Number(env.VECTORIZE_PART) || VEC_PART;
const VEC_BATCH = 20; // Cloudflare's most per get_by_ids (checked Nov 16, 2026)
const enc = new TextEncoder();
const pathSafe = (s) => String(s).replace(/[\u0000-\u001f/\\]/g, ' ').trim() || 'unnamed';
const workKey = (run, kind, id) => `work/${kind}/${encodeURIComponent(run)}/${encodeURIComponent(id)}.json`;
const apiOf = (env, fetchImpl) => cfApi(env, { fetchImpl, pace: config(env).pace, retryMs: config(env).retryMs });
// A short code for a list of names: which listing (or which slice of it) a copy was made from
const codeOf = (names) => createHash('sha256').update(JSON.stringify(names)).digest('hex').slice(0, 10);
// The run's listing of a namespace or an index, kept in staging between its steps: { items, info }
const keptListing = async (env, run, kind, id) => {
  const work = await env.STAGING.get(workKey(run, kind, id));
  return work ? JSON.parse(await work.text()) : null;
};
async function workList(env, run, kind, id, want, what) {
  const kept = await keptListing(env, run, kind, id);
  if (!kept) throw new Error(`the list of ${what} is gone from staging`);
  // The listing this step's parts were counted from, and no other
  if (kept.info?.list !== want || codeOf(kept.items.map((x) => x.name ?? x)) !== want) throw new Error(`the list of ${what} changed under this run`);
  return kept.items;
}
/**
 * The next manifest's file name for this run: one per run as a rule; a run that writes a second (a night started
 * again after it broke, whose parts changed in between) numbers it, so no two files have one name
 */
async function manifestName(state, key, run, base) {
  const n = ((await state.get(key)) || 0) + 1;
  return { n, path: `${base}${n > 1 ? ` ${n}` : ''}.json` };
}

/** The account's inventory, kept for the run's summary; the backup's own drill database and staging bucket left out */
export async function inventoryJob(env, state, { fetchImpl = fetch } = {}) {
  const inv = await inventory(apiOf(env, fetchImpl), { skip: { database: env.DRILL_DATABASE || 'soard-backup-drill', bucket: env.STAGING_BUCKET || 'soard-backup-staging' } });
  await state.set('inventory', { ...inv, at: new Date().toISOString() });
  return inv;
}

/**
 * What this run copies, from the inventory: every database (the ones set in DATABASES keep their label and quiet
 * second; one found later is copied as it is) and every bucket; and if the inventory couldn't list them, the ones set
 * in the backup's settings. One set but no longer listed is still tried, so its trouble is said.
 */
export function targets(env, inv) {
  const cfg = config(env);
  const listed = (type) => inv && !(inv.notListed || []).some((n) => n.type === type);
  let databases = cfg.databases;
  if (listed('databases')) {
    const byId = new Map(cfg.databases.map((d) => [d.id, d]));
    databases = inv.databases.map((d) => byId.get(d.id) || { name: d.name, id: d.id, label: d.name, quiet: false });
    for (const d of cfg.databases) if (!databases.some((x) => x.id === d.id)) databases.push(d);
  }
  const buckets = listed('buckets') ? [...new Set([...inv.buckets, ...cfg.buckets])] : cfg.buckets;
  return { databases, buckets, kv: inv?.kv || [], vectorize: inv?.vectorize || [], workers: inv?.workers || [] };
}

// ── KV ──

/** A namespace's keys (with their metadata and expiry), kept for its parts: { count, parts, list } */
export async function kvListJob(env, state, ns, run, { fetchImpl = fetch } = {}) {
  // A night started again after it broke goes on from the listing it made, so its parts all come from one listing
  const kept = await keptListing(env, run, 'kv', ns.id);
  if (kept?.info?.list) return kept.info;
  const api = apiOf(env, fetchImpl);
  const keys = [];
  let cursor = null;
  for (let i = 0; i < 100_000; i++) {
    const body = await api(`/storage/kv/namespaces/${encodeURIComponent(ns.id)}/keys`, { query: { limit: 1000, cursor } });
    for (const k of body.result || []) keys.push({ name: k.name, expiration: k.expiration ?? null, metadata: k.metadata ?? null });
    cursor = body.result_info?.cursor || null;
    if (!cursor) break;
  }
  const info = { count: keys.length, parts: Math.ceil(keys.length / kvPart(env)), list: codeOf(keys.map((k) => k.name)) };
  await env.STAGING.put(workKey(run, 'kv', ns.id), JSON.stringify({ items: keys, info }));
  return info;
}

/**
 * One part of a namespace, as `wrangler kv bulk put` takes it back: [{ key, value (base64), base64: true,
 * expiration, metadata }]. A part exactly as it was last copied (the same keys, values, expiries and metadata)
 * isn't sent again: the manifest names the file it's already in.
 */
export async function kvPartJob(env, state, h, ns, run, part, l, { by, fetchImpl = fetch } = {}) {
  const keys = (await workList(env, run, 'kv', ns.id, l.list, `${ns.title}’s keys`)).slice((part - 1) * kvPart(env), part * kvPart(env));
  const slice = codeOf(keys.map((k) => k.name));
  const id = `kv:${ns.id}:${run}:${part}:${slice}`;
  const title = pathSafe(ns.title);
  let result = null;
  if (!(await state.copy(id))) {
    const api = apiOf(env, fetchImpl);
    const base = `/storage/kv/namespaces/${encodeURIComponent(ns.id)}`;
    let gone = 0;
    let n = 0;
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const produce = (async () => {
      try {
        await writer.write(enc.encode('['));
        for (const k of keys) {
          // "." and ".." can't be asked for on a URL (it would read the namespace, not the key); KV doesn't allow them
          if (k.name === '.' || k.name === '..') throw new Error(`a key in ${ns.title} has a name Cloudflare’s API can’t read`);
          let res;
          try { res = await api(`${base}/values/${encodeURIComponent(k.name)}`, { raw: true }); } catch (e) {
            if (!(e instanceof SourceError && e.status === 404)) throw e;
            // Not there: gone since the listing (removed, or expired) only if the key list agrees. One still listed
            // that can't be read is trouble, never a key quietly left out (its name is never in the words: it's data)
            const still = await api(`${base}/keys`, { query: { prefix: k.name, limit: 10 } });
            if ((still.result || []).some((x) => x.name === k.name)) throw new Error(`a key in ${ns.title} is listed but Cloudflare won’t give its value (404)`);
            gone++;
            continue;
          }
          const value = Buffer.from(await res.arrayBuffer()).toString('base64');
          const item = { key: k.name, value, base64: true, ...(k.expiration ? { expiration: k.expiration } : {}), ...(k.metadata != null ? { metadata: k.metadata } : {}) };
          await writer.write(enc.encode(`${n++ ? ',' : ''}\n${JSON.stringify(item)}`));
        }
        await writer.write(enc.encode('\n]\n'));
        await writer.close();
      } catch (e) { await writer.abort(e).catch(() => {}); throw e; }
    })();
    produce.catch(() => {});
    const { recipient } = await state.publicKey();
    const key = stageKey(id);
    let r;
    try { r = await stageEncrypted(env, key, readable, { recipient, gzip: true }); } finally { await produce.catch(() => {}); }
    await produce;
    const last = await state.get(`kvpart:${ns.id}:${part}`);
    if (last?.path && last.sha === r.plain.sha256 && last.parts === l.parts) {
      // The very bytes of the last copy of this part: confirmed for this listing, not sent again
      await env.STAGING.delete(key);
      await state.set(`kvpart:${ns.id}:${part}`, { ...last, list: l.list });
      return { part, unchanged: true, keys: last.keys ?? n, gone };
    }
    await record(env, state, { id, kind: 'kv', night: run, path: `KV/${title}/${year(run)}/${run} ${title} part ${part} of ${l.parts} (${slice}).json.gz.age`, staged: key, size: r.stored.size, md5: r.stored.md5, sha1: r.stored.sha1, sha256: r.stored.sha256, plain_sha256: r.plain.sha256, plain_size: r.plain.size, meta: { namespace: ns.title, id: ns.id, part, parts: l.parts, keys: n, gone } });
    result = { gone };
  }
  const c = await ship(env, h, state, id, by);
  await state.set(`kvpart:${ns.id}:${part}`, { sha: c.plain_sha256, parts: l.parts, run, path: c.path, keys: c.meta?.keys ?? null, list: l.list });
  return { part, keys: c.meta?.keys ?? null, gone: result?.gone ?? c.meta?.gone ?? 0, shipped: !!c.shipped_at };
}

/**
 * The namespace's manifest: the file that holds each part (an unchanged part stays in the file of the run that last
 * changed it), written whenever that changes, and in each new year's folder and under a new name once, so the newest
 * manifest in the namespace's own folder always says how to put it back. Every part must have been confirmed for
 * this very listing, or there's no manifest.
 */
export async function kvDoneJob(env, state, h, ns, run, l, { by } = {}) {
  const files = [];
  for (let part = 1; part <= l.parts; part++) {
    const p = await state.get(`kvpart:${ns.id}:${part}`);
    if (!p?.path || p.parts !== l.parts || p.list !== l.list) throw new Error(`${ns.title} part ${part} has no copy from this run’s listing`);
    // (openedSha256: of the part once opened with age, before gunzip)
    files.push({ part, file: p.path, copiedIn: p.run, openedSha256: p.sha, keys: p.keys });
  }
  const title = pathSafe(ns.title);
  const sig = JSON.stringify(files.map((f) => [f.file, f.openedSha256]));
  const keys = files.reduce((t, f) => t + (f.keys || 0), 0);
  const last = await state.get(`kvman:${ns.id}`);
  if (last && last.sig === sig && last.title === title && last.year === year(run) && last.run !== run) return { parts: files.length, keys, unchanged: true };
  const id = `kvman:${ns.id}:${run}:${codeOf(sig)}`;
  const named = (await state.copy(id)) ? { n: null, path: null } : await manifestName(state, `kvmanN:${ns.id}:${run}`, run, `KV/${title}/${year(run)}/${run} ${title} manifest`);
  // (the number is kept first: a step cut off after the manifest never lets a later one take the same name)
  if (named.n) await state.set(`kvmanN:${ns.id}:${run}`, named.n);
  const m = await stagePlain(env, state, { id, kind: 'manifest', run, path: named.path, bytes: enc.encode(JSON.stringify({ namespace: ns.title, id: ns.id, run, written: new Date().toISOString(), keys, parts: files, howToPutBack: 'For each part: node scripts/restore.mjs kv "<the download folder>/<its file>" --key "<the download folder>/key.txt", then npx wrangler kv bulk put "<the ready file it writes>" --namespace-id <the new namespace> --remote (the READ ME FIRST says each step)' }, null, 1)) });
  await ship(env, h, state, m.id, by);
  await state.set(`kvman:${ns.id}`, { sig, title, year: year(run), run });
  return { parts: files.length, keys };
}

// ── Vectorize ──

/**
 * An index's vector ids (kept for its parts) and its metadata indexes, unless it hasn't changed since its last whole
 * copy: { unchanged, count } | { count, parts, list, mutation, dimensions, metric, metadataIndexes }
 */
export async function vectorizeListJob(env, state, index, run, { fetchImpl = fetch } = {}) {
  const kept = await keptListing(env, run, 'vectorize', index.name);
  if (kept?.info?.list) return kept.info;
  const api = apiOf(env, fetchImpl);
  const base = `/vectorize/v2/indexes/${encodeURIComponent(index.name)}`;
  const info = (await api(`${base}/info`)).result || {};
  const last = await state.get(`vec:${index.name}`);
  if (last?.mutation && info.processedUpToMutation && last.mutation === info.processedUpToMutation) return { unchanged: true, count: info.vectorCount ?? null };
  // Made before any vector goes in when it's put back (a vector put in before its metadata index isn't in it)
  const metadataIndexes = ((await api(`${base}/metadata_index/list`)).result?.metadataIndexes || []).map((m) => ({ propertyName: m.propertyName, indexType: m.indexType }));
  const ids = [];
  let cursor = null;
  for (let i = 0; i < 100_000; i++) {
    const page = (await api(`${base}/list`, { query: { count: 1000, cursor } })).result || {};
    for (const v of page.vectors || []) ids.push(v.id);
    cursor = page.isTruncated ? page.nextCursor : null;
    if (!cursor) break;
  }
  if (new Set(ids).size !== ids.length) throw new Error(`${index.name}’s listing named a vector twice`);
  // Every vector the index says it holds, or the index changed while it was listed (then the next night copies it again)
  if (info.vectorCount != null && ids.length !== info.vectorCount) {
    const now = (await api(`${base}/info`)).result || {};
    if (!info.processedUpToMutation || now.processedUpToMutation === info.processedUpToMutation) throw new Error(`${index.name} listed ${ids.length} vectors, though it holds ${info.vectorCount} and hasn’t changed`);
  }
  const out = { count: ids.length, parts: Math.ceil(ids.length / vecPart(env)), list: codeOf(ids), mutation: info.processedUpToMutation || null, dimensions: info.dimensions ?? index.dimensions ?? null, metric: index.metric ?? null, metadataIndexes };
  await env.STAGING.put(workKey(run, 'vectorize', index.name), JSON.stringify({ items: ids, info: out }));
  return out;
}

/** One part of an index, one vector a line ({ id, values, metadata, namespace }), as `wrangler vectorize insert` takes it */
export async function vectorizePartJob(env, state, h, index, run, part, l, { by, fetchImpl = fetch } = {}) {
  const ids = (await workList(env, run, 'vectorize', index.name, l.list, `${index.name}’s vectors`)).slice((part - 1) * vecPart(env), part * vecPart(env));
  const slice = codeOf(ids);
  const id = `vec:${index.name}:${run}:${part}:${slice}`;
  const name = pathSafe(index.name);
  if (!(await state.copy(id))) {
    const api = apiOf(env, fetchImpl);
    let got = 0;
    await stageCopy(env, state, {
      id, kind: 'vectorize', run, gzip: true, path: `Vectorize/${name}/${year(run)}/${run} ${name} part ${part} of ${l.parts} (${slice}).ndjson.gz.age`,
      open: async () => {
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        (async () => {
          try {
            const seen = new Set();
            for (let i = 0; i < ids.length; i += VEC_BATCH) {
              const asked = ids.slice(i, i + VEC_BATCH);
              const vectors = (await api(`/vectorize/v2/indexes/${encodeURIComponent(index.name)}/get_by_ids`, { method: 'POST', body: { ids: asked } })).result || [];
              for (const v of vectors) {
                // Only what was asked, once each, and every vector whole (as many numbers as the index has dimensions)
                if (!asked.includes(v.id) || seen.has(v.id)) throw new Error(`${index.name} gave back a vector it wasn’t asked for`);
                seen.add(v.id);
                if (!Array.isArray(v.values) || (l.dimensions && v.values.length !== l.dimensions)) throw new Error(`a vector of ${index.name} came back with ${Array.isArray(v.values) ? v.values.length : 'no'} values, not ${l.dimensions}`);
                await writer.write(enc.encode(`${JSON.stringify({ id: v.id, values: v.values, ...(v.metadata ? { metadata: v.metadata } : {}), ...(v.namespace ? { namespace: v.namespace } : {}) })}\n`));
                got++;
              }
            }
            // A vector listed but not given back is gone only if the index has changed since its listing (it was
            // removed); with no change at all, it's trouble, never a vector quietly left out
            if (got < ids.length) {
              const now = (await api(`/vectorize/v2/indexes/${encodeURIComponent(index.name)}/info`)).result || {};
              if (!l.mutation || now.processedUpToMutation === l.mutation) throw new Error(`${index.name} didn’t give back ${ids.length - got} vector(s) it listed, though it hasn’t changed`);
            }
            await writer.close();
          } catch (e) { await writer.abort(e).catch(() => {}); }
        })().catch(() => {});
        return readable;
      },
      meta: async () => ({ index: index.name, part, parts: l.parts, asked: ids.length, vectors: got }),
    });
  }
  const c = await ship(env, h, state, id, by);
  await state.set(`vecpart:${index.name}:${part}`, { list: l.list, parts: l.parts, path: c.path, sha256: c.plain_sha256, vectors: c.meta?.vectors ?? null, run });
  return { part, vectors: c.meta?.vectors ?? null, shipped: !!c.shipped_at };
}

/**
 * The index's manifest: its size and measure, its metadata indexes and exactly the files of this copy (none for an
 * empty index). Then the index is remembered, so it isn't copied again until it changes. An unchanged index gets
 * its manifest again once in each new year's folder.
 */
export async function vectorizeDoneJob(env, state, h, index, run, l, { by } = {}) {
  const name = pathSafe(index.name);
  const last = await state.get(`vecman:${index.name}`);
  let man;
  if (l.unchanged) {
    if (!last || last.year === year(run)) return { unchanged: true };
    man = { ...last.manifest, run };
  } else {
    const files = [];
    for (let part = 1; part <= l.parts; part++) {
      const p = await state.get(`vecpart:${index.name}:${part}`);
      if (!p?.path || p.parts !== l.parts || p.list !== l.list) throw new Error(`${index.name} part ${part} has no copy from this run’s listing`);
      files.push({ part, file: p.path, openedSha256: p.sha256, vectors: p.vectors });
    }
    man = { index: index.name, run, dimensions: l.dimensions, metric: l.metric, metadataIndexes: l.metadataIndexes || [], vectors: files.reduce((t, f) => t + (f.vectors || 0), 0), parts: files, howToPutBack: 'make the index (its dimensions and metric), then each metadata index, then insert every part: the READ ME FIRST says each step' };
  }
  const id = `vecman:${index.name}:${run}:${codeOf(man.parts.map((f) => [f.file, f.openedSha256]))}`;
  const named = (await state.copy(id)) ? { n: null, path: null } : await manifestName(state, `vecmanN:${index.name}:${run}`, run, `Vectorize/${name}/${year(run)}/${run} ${name} manifest`);
  if (named.n) await state.set(`vecmanN:${index.name}:${run}`, named.n);
  const m = await stagePlain(env, state, { id, kind: 'manifest', run, path: named.path, bytes: enc.encode(JSON.stringify({ ...man, written: new Date().toISOString() }, null, 1)) });
  await ship(env, h, state, m.id, by);
  await state.set(`vecman:${index.name}`, { year: year(run), run, manifest: man });
  if (!l.unchanged && l.mutation) await state.set(`vec:${index.name}`, { mutation: l.mutation, at: new Date().toISOString() });
  return { vectors: man.vectors, parts: man.parts.length };
}

// ── Workers' code ──

/**
 * Each Worker's deployed code, when it has changed: Cloudflare gives it as one multipart file of its modules (or one
 * plain file, for a Worker in the older single-file form), and names its main module (cf-entrypoint), kept in a
 * small plain file beside it. A Worker with no code of its own (one that only serves static files) has nothing to copy.
 * One Worker that can't be copied is its own trouble, named in the summary; it never holds up the others.
 */
export async function workersCodeJob(env, state, h, workers, run, { by, fetchImpl = fetch } = {}) {
  const api = apiOf(env, fetchImpl);
  const failed = [];
  const noCode = [];
  let copied = 0;
  let unchanged = 0;
  let tried = 0;
  for (const w of workers) {
    const last = await state.get(`worker:${w.name}`);
    if (last?.modified && w.modified && last.modified === w.modified) { unchanged++; if (last.noCode) noCode.push(w.name); continue; }
    tried++;
    try {
      const id = `worker:${w.name}:${w.modified || run}`;
      const name = pathSafe(w.name);
      const path = `Workers/${name}/${year(run)}/${run} ${name} code (${codeOf([w.modified || run])})`;
      let c = await state.copy(id);
      if (!c) {
        const res = await api(`/workers/scripts/${encodeURIComponent(w.name)}/content/v2`, { raw: true });
        if (res.status === 204) {
          await res.body?.cancel();
          await state.set(`worker:${w.name}`, { modified: w.modified, run, noCode: true });
          noCode.push(w.name);
          continue;
        }
        const type = res.headers.get('content-type') || '';
        const info = { worker: w.name, modified: w.modified, mainModule: res.headers.get('cf-entrypoint') || (type.startsWith('multipart') ? null : 'index.js'), form: type.startsWith('multipart') ? 'modules' : 'one file (index.js)', contentType: type.split(';')[0] };
        c = await stageCopy(env, state, { id, kind: 'worker', run, path: `${path}.age`, open: async () => res.body, meta: info });
      }
      await stagePlain(env, state, { id: `${id}:info`, kind: 'manifest', run: c.night, path: c.path.replace(/\.age$/, '.json'), bytes: enc.encode(JSON.stringify({ ...c.meta, file: c.path.split('/').pop(), howToPutBack: 'node scripts/restore.mjs worker <the opened code file> <a new folder>, then a wrangler.toml with main = the mainModule here: the READ ME FIRST says each step' }, null, 1)) });
      c = await ship(env, h, state, id, by);
      await ship(env, h, state, `${id}:info`, by);
      await state.set(`worker:${w.name}`, { modified: w.modified, run: c.night, copy: id, shipped: !!c.shipped_at });
      copied++;
    } catch (e) { failed.push({ worker: w.name, error: errText(e) }); }
  }
  // Every one failing is Cloudflare's trouble (the step waits and tries again); one or two are their own
  if (tried && failed.length === tried) throw new Error(`no Worker’s code could be copied: ${failed[0].error}`);
  return { copied, unchanged, noCode, failed };
}
