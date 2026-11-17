/**
 * Cloudflare's own settings, copied every night: what would have to be built again by hand if the account were
 * ever lost (for the website and the Sunny & Ranney store alike, as they share the account). Read only, never a
 * key or password:
 *   - each domain's DNS records as a zone file (any DNS host imports it, Cloudflare too), its settings, its rules
 *     (redirects and the rest), page rules and email forwarding
 *   - the admin's sign-in (Access apps, policies, groups, sign-in methods), the Pages projects, the Workers and
 *     their bindings, the R2 buckets with their addresses and CORS, and who can sign in to Cloudflare
 * The backup's one read-only key, CF_BACKUP_TOKEN, reads all of it (KEY_LINK makes it in a click); anything it
 * isn't allowed to read is listed in the copy as not read, never silently left out.
 */

const API = 'https://api.cloudflare.com/client/v4';
// The backup's whole key: read-only, and nothing else (Cloudflare's short keys for an account token). The
// databases, photos, videos and R2 files are read with it too (./db.js, ./sources.js).
const KEYS = ['d1', 'images', 'stream', 'workers_r2', 'dns', 'zone', 'zone_settings', 'page_rules', 'access', 'access_acct', 'page', 'workers_scripts', 'account_settings'].map((key) => ({ key, type: 'read' }));
export const KEY_NAME = 'SOARD backup (read only)';
export const KEY_LINK = `https://dash.cloudflare.com/?to=/:account/api-tokens&permissionGroupKeys=${encodeURIComponent(JSON.stringify(KEYS))}&name=${encodeURIComponent(KEY_NAME)}`;
// The ones the link can't fill in: the dashboard's checkboxes for them
export const KEY_EXTRAS = ['Single Redirect Read', 'Email Routing Rules Read', 'Email Routing Addresses Read', 'Workers KV Storage Read', 'Vectorize Read', 'Workers Routes Read', 'AI Gateway Read', 'Hyperdrive Read', 'Pipelines Read', 'Account Rulesets Read', 'Account Filter Lists Read', 'Notifications Read', 'Zone WAF Read', 'Zone Transform Rules Read'];

// Never copied: anything that looks like a secret (whatever its shape), a secret's value (Cloudflare never gives one
// back anyway), a header's value (a rule can set an Authorization header) and a rewritten query. A plain setting's
// value (a Worker's plain-text variable, an address) is kept, unless its name looks like a secret: putting a Worker
// back exactly needs it, and the copy is encrypted like the rest
const SECRETISH = /secret|password|passphrase|private|token|api_?key|client_key|credential/i;
const NOT = '(not copied)';
export function redact(v, path = []) {
  const key = path[path.length - 1] || '';
  if (Array.isArray(v)) return v.map((x) => redact(x, path));
  if (v && typeof v === 'object') {
    const out = {};
    const inHeaders = path.includes('headers') || path.includes('request_headers') || path.includes('response_headers');
    for (const [k, x] of Object.entries(v)) {
      if (SECRETISH.test(k) && x != null && typeof x !== 'boolean') { out[k] = NOT; continue; }
      const plain = (type, name) => (type === 'plain_text' || type === 'json') && !SECRETISH.test(String(name || ''));
      if ((k === 'env_vars' || k === 'environment_variables') && x && typeof x === 'object' && !Array.isArray(x)) {
        out[k] = Object.fromEntries(Object.entries(x).map(([name, e]) => [name, { type: e?.type || null, ...(plain(e?.type, name) && e?.value != null ? { value: e.value } : {}) }]));
        continue;
      }
      if (k === 'bindings' && Array.isArray(x)) {
        out[k] = x.map(({ text, value, json, ...rest }) => ({ ...redact(rest, [...path, k]), ...(plain(rest.type, rest.name) ? { ...(text != null ? { text } : {}), ...(json !== undefined ? { json } : {}) } : {}) }));
        continue;
      }
      if (k === 'value' && x != null && (inHeaders || key === 'query')) { out[k] = NOT; continue; }
      out[k] = redact(x, [...path, k]);
    }
    return out;
  }
  return v;
}

// The permission each read needs, as the setup check names them (jobs.js PROBES): a read refused while its
// permission is named as missing there is said once, there
const PERM = { rulesets: 'Account Rulesets Read', lists: 'Account Filter Lists Read', notifications: 'Notifications Read', workers: 'Workers Scripts Read', r2: 'Workers R2 Storage Read', d1: 'D1 Read', kv: 'Workers KV Storage Read', vectorize: 'Vectorize Read', ai: 'AI Gateway Read', hyperdrive: 'Hyperdrive Read', pipelines: 'Pipelines Read', email: 'Email Routing Addresses Read', turnstile: 'Account Settings Read', access: 'Access: Apps and Policies Read', images: 'Images Read', stream: 'Stream Read', routes: 'Workers Routes Read' };
// The permission a zone's own rule set needs to be read, by its kind (phase): from Cloudflare's permission list
export const PHASE_PERMISSION = {
  http_request_dynamic_redirect: 'Single Redirect Read', http_request_firewall_custom: 'Zone WAF Read', http_ratelimit: 'Zone WAF Read', http_request_firewall_managed: 'Zone WAF Read',
  http_request_transform: 'Zone Transform Rules Read', http_request_late_transform: 'Zone Transform Rules Read', http_response_headers_transform: 'Zone Transform Rules Read',
  http_request_cache_settings: 'Cache Settings Read', http_config_settings: 'Config Settings Read', http_request_origin: 'Origin Read', http_custom_errors: 'Custom Errors Read', http_response_compression: 'Response Compression Read',
};
// Where each permission is on Cloudflare's token page: [Account or Zone, the name in its second box] (the API's names
// and the page's differ for some zone rules)
export const PERMISSION_BOX = {
  'Workers Routes Read': ['Zone', 'Workers Routes'], 'Single Redirect Read': ['Zone', 'Single Redirect'], 'Email Routing Rules Read': ['Zone', 'Email Routing Rules'],
  'Zone WAF Read': ['Zone', 'Zone WAF'], 'Zone Transform Rules Read': ['Zone', 'Transform Rules'], 'Cache Settings Read': ['Zone', 'Cache Rules'], 'Config Settings Read': ['Zone', 'Config Rules'],
  'Origin Read': ['Zone', 'Origin Rules'], 'Custom Errors Read': ['Zone', 'Custom Error Rules'], 'Response Compression Read': ['Zone', 'Response Compression'],
};
export const boxOf = (name) => PERMISSION_BOX[name] || ['Account', name.replace(/ Read$/, '')];
// A Stream live input, without its keys: what it's called and how it records, to make it again (a new one gets new keys)
const liveInput = (x) => (x ? { uid: x.uid, name: x.meta?.name ?? null, created: x.created, modified: x.modified, enabled: x.enabled ?? null, recording: x.recording ? { mode: x.recording.mode, timeoutSeconds: x.recording.timeoutSeconds, requireSignedURLs: x.recording.requireSignedURLs, allowedOrigins: x.recording.allowedOrigins ?? null, hideLiveViewerCount: x.recording.hideLiveViewerCount ?? null } : null, deleteRecordingAfterDays: x.deleteRecordingAfterDays ?? null } : null);

/**
 * Everything it can read: { json, zoneFiles: [{ name, text }], problems: [{ what, why, permission }], off: [{ what }],
 * zones, records }. A setting that isn't set (no CORS on a bucket, no Stream webhook) is copied as { none: true },
 * never counted as unread; a product Cloudflare has switched off on its side (Stream, as in Sept and Nov 2026) is in
 * `off`, not taken for a missing permission.
 */
export async function readSettings(env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const acct = env.CF_ACCOUNT_ID;
  const main = env.CF_BACKUP_TOKEN || null;
  const problems = [];
  const off = [];
  // (`whole`: the answer with its result_info, for a listing that pages by cursor)
  const get = async (what, token, path, { text = false, none404 = false, perm = null, whole = false } = {}) => {
    if (!token) { problems.push({ what, why: 'needs the read-only backup key (CF_BACKUP_TOKEN)', permission: null }); return null; }
    try {
      const res = await fetchImpl(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
      if (text && res.ok) return await res.text();
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success !== false) return whole ? data : data?.result ?? data;
      // Nothing set (Cloudflare answers 404: "The CORS configuration does not exist", "No active webhook found")
      if (none404 && res.status === 404) return { none: true };
      const words = [...(data?.errors || []), ...(data?.messages || [])].map((e) => e?.message ?? e).join(' ');
      if ((res.status === 403 || res.status === 401) && /not enabled|not entitled|subscription/i.test(words)) { off.push({ what: `${what} (switched off on Cloudflare’s side)` }); return null; }
      problems.push({ what, why: res.status === 403 || res.status === 401 ? 'the key isn’t allowed to read it' : `Cloudflare ${res.status}${data?.errors?.[0]?.message ? `: ${data.errors[0].message}` : ''}`, permission: perm, refused: res.status === 403 || res.status === 401 });
    } catch (e) {
      problems.push({ what, why: String(e?.message || e).slice(0, 200), permission: null });
    }
    return null;
  };
  // Every page of a listing: by page number (to its total_pages or total_count, or a short page) or by cursor. One
  // with more pages than any of SOARD's could have is said, never cut off quietly.
  const getAll = async (what, token, path, opts = {}) => {
    const all = [];
    let cursor = null;
    // (a cursor as Cloudflare gives it, sent once encoded: some come encoded already, as the account rule sets' do)
    const asParam = (c) => { try { return encodeURIComponent(decodeURIComponent(c)); } catch { return encodeURIComponent(c); } };
    for (let page = 1; page <= 200; page++) {
      const sep = path.includes('?') ? '&' : '?';
      const body = await get(page === 1 ? what : `${what} (page ${page})`, token, `${path}${sep}${cursor ? `cursor=${asParam(cursor)}` : `page=${page}`}`, { ...opts, whole: true });
      if (!body || body.none) return page === 1 ? body : all;
      const items = Array.isArray(body.result) ? body.result : null;
      if (!items) return page === 1 ? body.result ?? null : all;
      all.push(...items);
      const info = body.result_info || {};
      // A listing that pages by cursor ends when the cursor does (it may ignore page numbers altogether)
      if ('cursor' in info || 'cursors' in info) {
        cursor = info.cursor || info.cursors?.after || null;
        if (!cursor) return all;
        continue;
      }
      const pages = Number(info.total_pages) || 0;
      if (!items.length || !Object.keys(info).length) return all;
      if (pages ? page >= pages : info.total_count != null ? all.length >= Number(info.total_count) : !info.per_page || items.length < Number(info.per_page)) return all;
    }
    problems.push({ what, why: 'it has more pages than the backup reads (200)', permission: null });
    return all;
  };
  const a = `/accounts/${acct}`;
  const [members, apps, policies, groups, idps, pagesProjects, scripts, buckets, zones] = await Promise.all([
    getAll('Who can sign in to Cloudflare', main, `${a}/members?per_page=50`),
    getAll('Admin sign-in: Access applications', main, `${a}/access/apps`, { perm: PERM.access }),
    getAll('Admin sign-in: Access policies', main, `${a}/access/policies`),
    getAll('Admin sign-in: Access groups', main, `${a}/access/groups`),
    getAll('Admin sign-in: sign-in methods', main, `${a}/access/identity_providers`),
    (async () => {
      // Every page of them (Cloudflare gives 10 a page)
      const all = [];
      for (let page = 1; page <= 100; page++) {
        const got = await get(`Pages projects (page ${page})`, main, `${a}/pages/projects?per_page=10&page=${page}`);
        if (!Array.isArray(got)) return page === 1 ? got : all;
        all.push(...got);
        if (got.length < 10) return all;
      }
      return all;
    })(),
    get('Workers', main, `${a}/workers/scripts`, { perm: PERM.workers }),
    get('R2 buckets', main, `${a}/r2/buckets`, { perm: PERM.r2 }),
    getAll('Domains', main, `/zones?account.id=${acct}&per_page=50`),
  ]);
  const databases = await getAll('D1 databases', main, `${a}/d1/database?per_page=100`, { perm: PERM.d1 });
  const workers = await Promise.all((scripts || []).map(async (w) => ({
    name: w.id, created: w.created_on, modified: w.modified_on,
    settings: await get(`Worker ${w.id}: settings and bindings`, main, `${a}/workers/scripts/${encodeURIComponent(w.id)}/settings`, { perm: PERM.workers }),
    schedules: await get(`Worker ${w.id}: schedules`, main, `${a}/workers/scripts/${encodeURIComponent(w.id)}/schedules`, { perm: PERM.workers }),
    // Its workers.dev address on or off (wrangler turns it on unless told)
    workersDev: await get(`Worker ${w.id}: workers.dev address`, main, `${a}/workers/scripts/${encodeURIComponent(w.id)}/subdomain`, { perm: PERM.workers }),
    hasAssets: !!w.has_assets,
  })));
  // Each Pages project's own addresses (sunshineonaranneyday.com on soard-site): added again by hand after a loss
  const pagesDomains = await Promise.all((pagesProjects || []).map(async (pr) => ({ project: pr.name, domains: await get(`Pages ${pr.name}: custom domains`, main, `${a}/pages/projects/${encodeURIComponent(pr.name)}/domains`) })));
  // The rest of the account's setup (each read with the same key; one it may not read is listed, never left out quietly)
  const [kvNamespaces, vectorize, workerDomains, workflows, queues, durableObjects, aiGateways, turnstile, emailAddresses, imageVariants, streamWebhook, streamWatermarks, liveInputList, hyperdrive, pipelines] = await Promise.all([
    getAll('KV namespaces', main, `${a}/storage/kv/namespaces?per_page=100`, { perm: PERM.kv }),
    get('Vectorize indexes', main, `${a}/vectorize/v2/indexes`, { perm: PERM.vectorize }),
    get('Workers custom domains', main, `${a}/workers/domains`, { perm: PERM.workers }),
    getAll('Workflows', main, `${a}/workflows`, { perm: PERM.workers }),
    getAll('Queues', main, `${a}/queues`, { perm: PERM.workers }),
    getAll('Durable Object namespaces', main, `${a}/workers/durable_objects/namespaces`, { perm: PERM.workers }),
    getAll('AI Gateway', main, `${a}/ai-gateway/gateways`, { perm: PERM.ai }),
    getAll('Turnstile widgets', main, `${a}/challenges/widgets`, { perm: PERM.turnstile }),
    getAll('Email forwarding destination addresses', main, `${a}/email/routing/addresses`, { perm: PERM.email }),
    get('Images variants', main, `${a}/images/v1/variants`, { perm: PERM.images }),
    get('Stream webhook', main, `${a}/stream/webhook`, { none404: true, perm: PERM.stream }),
    get('Stream watermarks', main, `${a}/stream/watermarks`, { perm: PERM.stream }),
    get('Stream live inputs', main, `${a}/stream/live_inputs`, { perm: PERM.stream }),
    getAll('Hyperdrive', main, `${a}/hyperdrive/configs`, { perm: PERM.hyperdrive }),
    getAll('Pipelines', main, `${a}/pipelines`, { perm: PERM.pipelines }),
  ]);
  // Pipelines has a newer listing beside the older one; each lists what was made through it
  const pipelinesV1 = await getAll('Pipelines (newer listing)', main, `${a}/pipelines/v1/pipelines`, { perm: PERM.pipelines, none404: true });
  const liveInputs = await Promise.all((Array.isArray(liveInputList) ? liveInputList : liveInputList?.liveInputs || []).map(async (li) => liveInput(await get(`Stream live input ${li.uid}`, main, `${a}/stream/live_inputs/${encodeURIComponent(li.uid)}`, { perm: PERM.stream }))));
  // The account's own rules (the www to sunshineonaranneyday.com redirect is one: a redirect list and the rule using it)
  const accountRulesetList = await getAll('Account rules', main, `${a}/rulesets`, { perm: PERM.rulesets });
  const accountRulesets = await Promise.all((accountRulesetList || []).filter((r) => r.kind !== 'managed').map((r) => get(`Account rules: ${r.phase}`, main, `${a}/rulesets/${encodeURIComponent(r.id)}`, { perm: PERM.rulesets })));
  const lists = await getAll('Account lists (redirect lists and the rest)', main, `${a}/rules/lists`, { perm: PERM.lists });
  const listItems = await Promise.all((lists || []).map(async (l) => {
    const items = [];
    let cursor = null;
    for (let i = 0; i < 1000; i++) {
      const got = await get(`List ${l.name}: its items`, main, `${a}/rules/lists/${encodeURIComponent(l.id)}/items?per_page=500${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { perm: PERM.lists, whole: true });
      if (!Array.isArray(got?.result)) return { ...l, items: null };
      items.push(...got.result);
      cursor = got.result_info?.cursors?.after || null;
      if (!cursor) break;
    }
    return { ...l, items };
  }));
  // Notifications: the live broadcast's Stream events reach the site through one (a webhook destination and its policy)
  const [alertPolicies, alertWebhooks] = await Promise.all([
    get('Notifications', main, `${a}/alerting/v3/policies`, { perm: PERM.notifications }),
    get('Notification webhooks', main, `${a}/alerting/v3/destinations/webhooks`, { perm: PERM.notifications }),
  ]);
  // The domains as registered at Cloudflare (when each ends, auto-renew, its name servers): no contact details, only ids
  // (the newer listing, paged by cursor; Cloudflare names no permission for it, so one the key may not read is a note
  // in the summary, not trouble every night: the READ ME says the domains come first either way)
  const before = problems.length;
  const registrations = await getAll('Domain registrations', main, `${a}/registrar/registrations`);
  // Only the key being refused is a note; any other trouble (Cloudflare down, a listing too long) stays a problem
  const refusedRegistrar = problems.slice(before).filter((p) => p.refused && p.what.startsWith('Domain registrations'));
  for (const p of refusedRegistrar) problems.splice(problems.indexOf(p), 1);
  if (refusedRegistrar.length) off.push({ what: 'the domain registrations (the key isn’t allowed to read them, and Cloudflare names no permission for it)' });
  const registrar = Array.isArray(registrations) ? registrations.map((d) => ({ name: d.domain_name, status: d.status ?? null, createdAt: d.created_at ?? null, expiresAt: d.expires_at ?? null, autoRenew: d.auto_renew ?? null, privacyMode: d.privacy_mode ?? null, locked: d.locked ?? null })) : null;
  // Each index's metadata indexes: made again before any vector goes back in
  const vectorizeOut = await Promise.all((vectorize || []).map(async (x) => ({ ...x, metadataIndexes: (await get(`Vectorize ${x.name}: metadata indexes`, main, `${a}/vectorize/v2/indexes/${encodeURIComponent(x.name)}/metadata_index/list`, { perm: PERM.vectorize }))?.metadataIndexes ?? null })));
  const r2 = await Promise.all(((buckets?.buckets || buckets) || []).map(async (b) => ({
    name: b.name, created: b.creation_date, location: b.location || null,
    domains: await get(`R2 ${b.name}: addresses`, main, `${a}/r2/buckets/${encodeURIComponent(b.name)}/domains/custom`, { perm: PERM.r2 }),
    publicAddress: await get(`R2 ${b.name}: its r2.dev address`, main, `${a}/r2/buckets/${encodeURIComponent(b.name)}/domains/managed`, { perm: PERM.r2 }),
    cors: await get(`R2 ${b.name}: CORS`, main, `${a}/r2/buckets/${encodeURIComponent(b.name)}/cors`, { none404: true, perm: PERM.r2 }),
    lifecycle: await get(`R2 ${b.name}: lifecycle rules`, main, `${a}/r2/buckets/${encodeURIComponent(b.name)}/lifecycle`, { perm: PERM.r2 }),
  })));
  const zoneFiles = [];
  let records = 0;
  const zoneOut = await Promise.all((zones || []).map(async (z) => {
    const [bind, settings, rulesets, pagerules, email, emailRules, catchAll, dnssec, workerRoutes] = await Promise.all([
      get(`${z.name}: DNS records`, main, `/zones/${z.id}/dns_records/export`, { text: true }),
      get(`${z.name}: settings`, main, `/zones/${z.id}/settings`),
      get(`${z.name}: rules`, main, `/zones/${z.id}/rulesets`),
      get(`${z.name}: page rules`, main, `/zones/${z.id}/pagerules`),
      get(`${z.name}: email forwarding`, main, `/zones/${z.id}/email/routing`),
      getAll(`${z.name}: email forwarding rules`, main, `/zones/${z.id}/email/routing/rules`),
      get(`${z.name}: email forwarding catch-all`, main, `/zones/${z.id}/email/routing/rules/catch_all`),
      get(`${z.name}: DNSSEC`, main, `/zones/${z.id}/dnssec`),
      get(`${z.name}: Workers routes`, main, `/zones/${z.id}/workers/routes`, { perm: PERM.routes }),
    ]);
    if (bind) {
      zoneFiles.push({ name: `${z.name} DNS records.txt`, text: bind });
      records += bind.split('\n').filter((l) => l.trim() && !l.trim().startsWith(';') && !/^\$/.test(l.trim())).length;
    }
    // Each rule set the zone itself owns (redirects, transforms, cache, config), in full
    const own = (rulesets || []).filter((r) => r.kind === 'zone');
    const rules = await Promise.all(own.map((r) => get(`${z.name}: ${r.phase} rules`, main, `/zones/${z.id}/rulesets/${r.id}`, { perm: PHASE_PERMISSION[r.phase] || null })));
    return { name: z.name, id: z.id, status: z.status, plan: z.plan?.name || null, nameServers: z.name_servers || [], settings, rulesets: rules.filter(Boolean), pageRules: pagerules, emailRouting: email, emailRules, emailCatchAll: catchAll, dnssec, workerRoutes };
  }));
  const json = redact({
    what: 'SOARD’s Cloudflare settings, the website’s and the store’s (read only; no keys or passwords). DNS records are beside this file as zone files any DNS host imports.',
    made: new Date(now).toISOString(), account: acct,
    members: (members || []).map((m) => ({ email: m.user?.email || m.email || null, status: m.status, roles: (m.roles || []).map((r) => r.name), policies: (m.policies || []).length })),
    access: { applications: apps, policies, groups, signInMethods: idps },
    pages: pagesProjects, pagesDomains, workers, r2, zones: zoneOut, registrar, accountRulesets: accountRulesets.filter(Boolean), lists: listItems, notifications: { policies: alertPolicies, webhooks: alertWebhooks },
    kvNamespaces, vectorize: vectorize ? vectorizeOut : null, workerDomains, workflows, queues, durableObjects, aiGateways, turnstile, emailAddresses,
    images: { variants: imageVariants }, stream: { webhook: streamWebhook, watermarks: streamWatermarks, liveInputs }, hyperdrive, pipelines, pipelinesV1,
    databases: (databases || []).map((d) => ({ name: d.name, id: d.uuid, created: d.created_at, size: d.file_size, tables: d.num_tables, readReplication: d.read_replication || null })),
    notRead: problems, switchedOff: off,
  });
  return { json, zoneFiles, problems, off, zones: (zones || []).length, records };
}
