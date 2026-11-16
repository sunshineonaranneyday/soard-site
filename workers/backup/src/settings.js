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
// Two the link can't fill in: the dashboard's checkboxes for them
export const KEY_EXTRAS = ['Single Redirect Read', 'Email Routing Rules Read'];

// Never copied: anything that looks like a secret (whatever its shape), every environment value (only their names
// and kinds), a binding's value, a header's value (a rule can set an Authorization header) and a rewritten query
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
      if ((k === 'env_vars' || k === 'environment_variables') && x && typeof x === 'object' && !Array.isArray(x)) {
        out[k] = Object.fromEntries(Object.entries(x).map(([name, e]) => [name, { type: e?.type || null }]));
        continue;
      }
      if (k === 'bindings' && Array.isArray(x)) { out[k] = x.map(({ text, value, json, ...rest }) => redact(rest, [...path, k])); continue; }
      if (k === 'value' && x != null && (inHeaders || key === 'query')) { out[k] = NOT; continue; }
      out[k] = redact(x, [...path, k]);
    }
    return out;
  }
  return v;
}

/** Everything it can read: { json, zoneFiles: [{ name, text }], problems: [{ what, why }], zones, records } */
export async function readSettings(env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const acct = env.CF_ACCOUNT_ID;
  const main = env.CF_BACKUP_TOKEN || null;
  const problems = [];
  const get = async (what, token, path, { text = false } = {}) => {
    if (!token) { problems.push({ what, why: 'needs the read-only backup key (CF_BACKUP_TOKEN)' }); return null; }
    try {
      const res = await fetchImpl(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
      if (text && res.ok) return await res.text();
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success !== false) return data?.result ?? data;
      problems.push({ what, why: res.status === 403 || res.status === 401 ? 'the key isn’t allowed to read it' : `Cloudflare ${res.status}${data?.errors?.[0]?.message ? `: ${data.errors[0].message}` : ''}` });
    } catch (e) {
      problems.push({ what, why: String(e?.message || e).slice(0, 200) });
    }
    return null;
  };
  const a = `/accounts/${acct}`;
  const access = main;
  const pages = main;
  const [members, apps, policies, groups, idps, pagesProjects, scripts, buckets, zones] = await Promise.all([
    get('Who can sign in to Cloudflare', main, `${a}/members?per_page=50`),
    get('Admin sign-in: Access applications', access, `${a}/access/apps`),
    get('Admin sign-in: Access policies', access, `${a}/access/policies`),
    get('Admin sign-in: Access groups', access, `${a}/access/groups`),
    get('Admin sign-in: sign-in methods', access, `${a}/access/identity_providers`),
    get('Pages projects', pages, `${a}/pages/projects`),
    get('Workers', main, `${a}/workers/scripts`),
    get('R2 buckets', main, `${a}/r2/buckets`),
    get('Domains', main, `/zones?account.id=${acct}&per_page=50`),
  ]);
  const databases = await get('D1 databases', main, `${a}/d1/database?per_page=100`);
  const workers = await Promise.all((scripts || []).map(async (w) => ({ name: w.id, created: w.created_on, modified: w.modified_on, settings: await get(`Worker ${w.id}: settings and bindings`, main, `${a}/workers/scripts/${encodeURIComponent(w.id)}/settings`) })));
  const r2 = await Promise.all(((buckets?.buckets || buckets) || []).map(async (b) => ({
    name: b.name, created: b.creation_date, location: b.location || null,
    domains: await get(`R2 ${b.name}: addresses`, main, `${a}/r2/buckets/${encodeURIComponent(b.name)}/domains/custom`),
    cors: await get(`R2 ${b.name}: CORS`, main, `${a}/r2/buckets/${encodeURIComponent(b.name)}/cors`),
  })));
  const zoneFiles = [];
  let records = 0;
  const zoneOut = await Promise.all((zones || []).map(async (z) => {
    const [bind, settings, rulesets, pagerules, email, emailRules] = await Promise.all([
      get(`${z.name}: DNS records`, main, `/zones/${z.id}/dns_records/export`, { text: true }),
      get(`${z.name}: settings`, main, `/zones/${z.id}/settings`),
      get(`${z.name}: rules`, main, `/zones/${z.id}/rulesets`),
      get(`${z.name}: page rules`, main, `/zones/${z.id}/pagerules`),
      get(`${z.name}: email forwarding`, main, `/zones/${z.id}/email/routing`),
      get(`${z.name}: email forwarding rules`, main, `/zones/${z.id}/email/routing/rules`),
    ]);
    if (bind) {
      zoneFiles.push({ name: `${z.name} DNS records.txt`, text: bind });
      records += bind.split('\n').filter((l) => l.trim() && !l.trim().startsWith(';') && !/^\$/.test(l.trim())).length;
    }
    // Each rule set the zone itself owns (redirects, transforms, cache, config), in full
    const own = (rulesets || []).filter((r) => r.kind === 'zone');
    const rules = await Promise.all(own.map((r) => get(`${z.name}: ${r.phase} rules`, main, `/zones/${z.id}/rulesets/${r.id}`)));
    return { name: z.name, id: z.id, status: z.status, plan: z.plan?.name || null, nameServers: z.name_servers || [], settings, rulesets: rules.filter(Boolean), pageRules: pagerules, emailRouting: email, emailRules };
  }));
  const json = redact({
    what: 'SOARD’s Cloudflare settings, the website’s and the store’s (read only; no keys or passwords). DNS records are beside this file as zone files any DNS host imports.',
    made: new Date(now).toISOString(), account: acct,
    members: (members || []).map((m) => ({ email: m.user?.email || m.email || null, status: m.status, roles: (m.roles || []).map((r) => r.name), policies: (m.policies || []).length })),
    access: { applications: apps, policies, groups, signInMethods: idps },
    pages: pagesProjects, workers, r2, zones: zoneOut,
    databases: (databases || []).map((d) => ({ name: d.name, id: d.uuid, created: d.created_at, size: d.file_size, tables: d.num_tables, readReplication: d.read_replication || null })),
    notRead: problems,
  });
  return { json, zoneFiles, problems, zones: (zones || []).length, records };
}
