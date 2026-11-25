/**
 * Past makeovers and community projects as closed JobTread jobs
 * ===========================================================================
 * Peter, Nov 23 2026: "why dont we create a job in jobtread for all of our
 * projects too? so that jobtread has the complete histyr of projects?"; the
 * list of 191 past projects (182 kid makeovers, 9 community projects) was
 * OK'd on Nov 24 ("yes to both, start the documents"), and on Nov 25: "build
 * the JobTread jobs".
 *
 * Each finished kid page and community project page with no JobTread job gets
 * one, closed on its reveal date, so JobTread holds every project SOARD has
 * done and each project's old photos and papers have a job to land on.
 *
 *   - The list: one row per page, loaded once from the Drive cleanup's
 *     reviewed list (Admin → Kids → Past makeovers in JobTread): the page,
 *     its year, and its reveal date (the day most of its Reveal photos were
 *     taken, with how that was decided). Rows live only in D1 (past_jobs).
 *   - The reveal date: used when it falls in the page's year or the first
 *     three months after (a December build revealed in January); anything
 *     else, or none, closes the job on Dec 31 of its year.
 *   - Already in JobTread: a page the kid status sync already links to a job
 *     (by name and year, or the job a profile is pinned to) is left alone. A
 *     job no page is linked to that makeover costs' loose matcher gives to a
 *     page (a job named for another year, "Emery Smith (2024)" for a 2025
 *     page, or with another name, "Marie Surprenant (2024)" for Marie &
 *     Alondra) makes that page a question for a person: its job, or a new one.
 *   - The customer: the family's or organization's JobTread customer when
 *     exactly one fits (every word of the page's name in the customer's name,
 *     and the page's year in the customer's Makeover Year or a job's name);
 *     more than one is a question for a person in the admin; none, and the
 *     site makes one: named "<page name> (<year>)" (an organization by its
 *     name), with no Status, Makeover Year or contact, so it is never an
 *     applicant and nobody is emailed (notify off), and a location with no
 *     address.
 *   - The job: named by the approval's namer ("Mathew (2012)", 30 characters),
 *     which the kid status sync then links to the page by name and year;
 *     closed on the reveal date, Status Closed Done.
 *   - Before anything is made: the plan is read again from JobTread and shown
 *     in the admin with what differs from the reviewed list; nothing is made
 *     while a row waits on a person. The first job is made alone (Make one),
 *     so JobTread's workflows, QuickBooks and DataX can be checked; then
 *     "Make the rest" queues every ready row and the application sweep makes
 *     a few each run (./_applications.js, every 2 minutes).
 *   - Each row records what it made as it goes (customer, location, job), so
 *     a run that stops part way picks up where it left off and never makes a
 *     second customer or job.
 *
 * Read-only planning never writes to JobTread. Only founders (People → Team)
 * can load the list, answer a row or make jobs (./past-jobs-admin.js).
 */

import { pave, SOARD_ORG_ID, parseJobName, matchProject, todayEastern } from './_reveals.js';
import { fetchJobs, linkJobs, keyOf, loadAllKids, loadAllProjects, saveRecord, FIELD_STATUS as JOB_FIELD_STATUS } from './_kid-status.js';
import { jobNameFor } from './_applicant-approved.js';
import { looseMatch } from './_makeover-costs.js';

const FIELD_YEAR = '22P52xmCz3cx'; // customer: *Makeover Year
export const DONE_STATUS = 'Closed Done';
const ACCOUNT_PAGE = 50;
const ACCOUNT_PAGES_MAX = 60;
const PER_RUN = 6;
const CLAIM_STALE_MS = 10 * 60 * 1000;
const iso = (t = Date.now()) => new Date(t).toISOString();

export const SCHEMA = `CREATE TABLE IF NOT EXISTS past_jobs (
  key TEXT PRIMARY KEY, kind TEXT NOT NULL, slug TEXT NOT NULL, name TEXT NOT NULL, year INTEGER NOT NULL,
  draft_date TEXT, draft_how TEXT, draft_flag TEXT,
  close_on TEXT, close_how TEXT,
  plan TEXT, plan_note TEXT, plan_at TEXT, plan_account_id TEXT, plan_account_name TEXT, plan_candidates TEXT, account_how TEXT, job_name TEXT,
  answer TEXT, answered_by TEXT,
  plan_pin INTEGER NOT NULL DEFAULT 0, pinned_at TEXT,
  account_id TEXT, account_name TEXT, location_id TEXT, job_id TEXT, made_job_name TEXT,
  state TEXT NOT NULL DEFAULT 'listed', error TEXT, attempts INTEGER NOT NULL DEFAULT 0,
  claimed_at TEXT, made_at TEXT, made_by TEXT, updated_at TEXT NOT NULL)`;
export const STATE_SCHEMA = 'CREATE TABLE IF NOT EXISTS past_jobs_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)';

const _ready = new WeakSet();
export async function ensurePastJobs(DB) {
  if (_ready.has(DB)) return;
  await DB.prepare(SCHEMA).run();
  await DB.prepare(STATE_SCHEMA).run();
  _ready.add(DB);
}

// ── Pure rules ────────────────────────────────────────────────────────

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** A name's words for matching: "TA & Alissa" → ['ta', 'alissa'] */
export const wordsOf = (s) => fold(s).replace(/['’]/g, '').split(/[^a-z0-9]+/).filter((w) => w && w !== 'and' && !/^\d+$/.test(w));
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

/**
 * The day the job closes, and how it was decided: the reviewed reveal date when it falls in the page's year or the
 * first three months after it (a December build revealed in January), else Dec 31 of the page's year
 */
export function closeDateFor(year, date, how = '') {
  const y = Number(year);
  if (isDate(date) && date >= `${y}-01-01` && date <= `${y + 1}-03-31`) return { closeOn: date, how: how || 'reveal date' };
  return {
    closeOn: `${y}-12-31`,
    how: isDate(date) ? `the reviewed date, ${date}, isn’t in ${y}, so Dec 31 of the year` : 'no reveal date found, so Dec 31 of the year',
  };
}

/** The new customer's name: a family's "<page name> (<year>)", an organization's own name */
export const accountNameFor = (row) => (row.kind === 'community' ? String(row.name).trim() : `${String(row.name).trim()} (${row.year})`);

/** The job's name, by the approval's namer: "Mathew (2012)", "Camp Twin Lakes (2018)" */
export const jobNameForRow = (row) => jobNameFor(row.name, row.year, { organization: row.kind === 'community' });

/** A JobTread account's custom field values by field id */
function fieldValues(a) {
  const out = {};
  for (const n of a?.customFieldValues?.nodes || []) out[n.customField?.id] = n.value;
  return out;
}

/**
 * The JobTread customers that could be this page's: every word of the page's name is in the customer's name, and the
 * page's year is the customer's Makeover Year, in the customer's name ("Mathew (2012)") or in one of its jobs' names.
 * An organization's customer is one with exactly the project's name (any year: a school can have several projects).
 */
export function customersFor(row, accounts) {
  const want = wordsOf(row.name);
  if (!want.length) return [];
  const y = Number(row.year);
  return accounts.filter((a) => {
    if (a.archivedAt) return false;
    const have = new Set(wordsOf(a.name));
    if (row.kind === 'community') return have.size === want.length && want.every((w) => have.has(w));
    if (!want.every((w) => have.has(w))) return false;
    if (Number(fieldValues(a)[FIELD_YEAR]) === y) return true;
    if (parseJobName(a.name).year === y) return true;
    return (a.jobs?.nodes || []).some((j) => parseJobName(j.name).year === y);
  });
}

/**
 * One row's plan, from what JobTread and the site hold now:
 *   { plan: 'has-job' | 'make' | 'ask' | 'made', note, accountId, accountName, accountHow, jobName, closeOn, closeHow }
 * links: linkJobs' map (page key → job) over every page; records: every kid and project (for the name check);
 * answer: a person's pick for a row that had more than one customer ({ accountId } or { account: 'new' })
 */
export function planRow(row, { accounts, links, records, loose = new Map(), answer = null }) {
  const { closeOn, how: closeHow } = closeDateFor(row.year, row.draft_date, row.draft_how);
  const jobName = jobNameForRow(row);
  const base = { jobName, closeOn, closeHow, accountId: null, accountName: null, accountHow: null };
  if (row.job_id) return { ...base, plan: 'made', note: `made ${row.made_at ? String(row.made_at).slice(0, 10) : ''}`.trim(), jobName: row.made_job_name || jobName, accountId: row.account_id, accountName: row.account_name, accountHow: row.account_how };
  // A row an earlier try started (its customer is saved): finished on that customer, where the maker finds a job a lost
  // answer already made (the kid status sync may link that job by now, so the link can't say "already has a job")
  if (row.account_id) return { ...base, plan: 'make', note: 'started earlier: finishing', accountId: row.account_id, accountName: row.account_name, accountHow: row.account_how || 'started earlier' };
  const key = row.kind === 'community' ? `community/${row.slug}` : row.slug;
  const linked = links.get(key);
  if (linked) return { ...base, plan: 'has-job', note: `already has “${linked.name}”`, jobId: linked.id };
  if (answer?.jobId) return { ...base, plan: 'has-job', note: 'a person said JobTread already has its job', jobId: answer.jobId };
  // A job no page claims that may well be this one (named for another year, or another name): a person says
  const maybe = loose.get(key) || [];
  if (maybe.length && !answer) {
    return { ...base, plan: 'ask', note: `JobTread may already have its job: ${maybe.slice(0, 3).map((j) => `“${j.name}”`).join(', ')}`,
      candidates: maybe.slice(0, 4).map((j) => ({ id: j.id, name: j.name, kind: 'job' })) };
  }
  const record = records.find((r) => keyOf(r) === key);
  if (!record) return { ...base, plan: 'ask', note: 'no page with this name any more' };
  // The kid status sync links a job to its page by name and year. When the job's name can't carry the page alone (an
  // organization's long name cut to JobTread's 30 characters, two pages with one name and year), the page is linked
  // to the job by its id once it's made, as an approval links the pages it makes
  const fits = matchProject(jobName, records);
  const pin = !fits || keyOf(fits) !== key;
  const pinNote = pin ? `its page is linked to the job by id (“${jobName}” can’t name ${record.name} alone)` : null;
  const make = (extra) => ({ ...base, plan: 'make', pin, note: pinNote, ...extra });
  if (answer?.account === 'new') return make({ accountName: accountNameFor(row), accountHow: 'new (a person said so)' });
  if (answer?.accountId) {
    const a = accounts.find((x) => x.id === answer.accountId);
    if (!a) return { ...base, plan: 'ask', note: 'the customer a person picked is gone from JobTread' };
    return make({ accountId: a.id, accountName: a.name, accountHow: 'picked by a person' });
  }
  const hits = customersFor(row, accounts);
  if (hits.length > 1) return { ...base, plan: 'ask', pin, note: `${hits.length} customers fit: ${hits.slice(0, 4).map((a) => a.name).join(', ')}`, candidates: hits.slice(0, 6).map((a) => ({ id: a.id, name: a.name, kind: 'customer' })) };
  if (hits.length === 1) return make({ accountId: hits[0].id, accountName: hits[0].name, accountHow: 'name and year match' });
  return make({ accountName: accountNameFor(row), accountHow: 'new customer' });
}

/** The reviewed list's rows, checked → { ok, rows, errors } */
export function checkImport(body) {
  const list = Array.isArray(body?.rows) ? body.rows : null;
  if (!list) return { ok: false, error: 'No rows.' };
  const rows = [], errors = [];
  const seen = new Set();
  list.forEach((r, i) => {
    const kind = r?.kind === 'community' ? 'community' : r?.kind === 'kid' ? 'kid' : null;
    const slug = String(r?.slug || '').trim();
    const name = String(r?.name || '').trim().slice(0, 120);
    const year = Number(r?.year);
    if (!kind || !/^[a-z0-9-]{1,120}$/.test(slug) || !name || !(year >= 2005 && year <= 2035)) { errors.push(`row ${i + 1}: needs kind, slug, name and year`); return; }
    const key = kind === 'community' ? `community/${slug}` : slug;
    if (seen.has(key)) { errors.push(`row ${i + 1}: ${key} twice`); return; }
    seen.add(key);
    rows.push({
      key, kind, slug, name, year,
      draft_date: isDate(r.date) ? r.date : null,
      draft_how: String(r.how || '').slice(0, 200) || null,
      draft_flag: String(r.flag || '').slice(0, 60) || null,
    });
  });
  return { ok: errors.length === 0, rows, errors };
}

// ── JobTread reads ────────────────────────────────────────────────────

const ACCOUNT = {
  id: {}, name: {}, archivedAt: {},
  customFieldValues: { $: { size: 1, where: [['customField', 'id'], '=', FIELD_YEAR] }, nodes: { value: {}, customField: { id: {} } } },
  primaryLocation: { id: {} },
  jobs: { $: { size: 5, sortBy: [{ field: 'createdAt', order: 'desc' }] }, nodes: { id: {}, name: {}, closedOn: {}, createdAt: {} } },
};

/** Every SOARD customer, with its Makeover Year, primary location and newest jobs */
export async function readCustomers(grant, fetchImpl = fetch) {
  const out = [];
  let page = null;
  for (let i = 0; i < ACCOUNT_PAGES_MAX; i++) {
    const body = await pave(grant, {
      organization: { $: { id: SOARD_ORG_ID }, accounts: { $: { size: ACCOUNT_PAGE, where: ['type', '=', 'customer'], ...(page ? { page } : {}) }, nextPage: {}, nodes: ACCOUNT } },
    }, fetchImpl);
    const conn = body?.organization?.accounts;
    if (!conn) throw new Error('JobTread’s answer had no customers');
    out.push(...(conn.nodes || []));
    page = conn.nextPage || null;
    if (!page) return out;
  }
  throw new Error(`more than ${ACCOUNT_PAGE * ACCOUNT_PAGES_MAX} customers: read stopped`);
}

/**
 * Whether new jobs would make QuickBooks projects, if JobTread says: { known, creatingProjects, connected, error }.
 * JobTread's public schema doesn't list the setting, so a refusal is "not known" and the first job is checked in
 * QuickBooks itself.
 */
export async function readQuickBooks(grant, fetchImpl = fetch) {
  try {
    const body = await pave(grant, { organization: { $: { id: SOARD_ORG_ID }, qboIntegration: { isConnected: {}, isCreatingProjects: {} } } }, fetchImpl);
    const q = body?.organization?.qboIntegration;
    if (q === null) return { known: true, connected: false, creatingProjects: false };
    if (!q) return { known: false, error: 'JobTread didn’t say' };
    return { known: true, connected: !!q.isConnected, creatingProjects: !!q.isCreatingProjects };
  } catch (e) {
    return { known: false, error: String(e.message || e).slice(0, 200) };
  }
}

/** JobTread's active workflows (what could run when a job or customer is made): [{ id, name, trigger }] */
export async function readWorkflows(grant, fetchImpl = fetch) {
  try {
    const body = await pave(grant, {
      organization: { $: { id: SOARD_ORG_ID }, workflows: { $: { size: 100 }, nodes: { id: {}, name: {}, isActive: {}, triggerTypeId: {} } } },
    }, fetchImpl);
    return { ok: true, list: (body?.organization?.workflows?.nodes || []).filter((w) => w.isActive).map((w) => ({ id: w.id, name: w.name, trigger: w.triggerTypeId })) };
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 200), list: [] };
  }
}

/** Every SOARD job with when it was made and closed and its customer's name (what the loose matcher reads) */
export async function readJobsWithCustomers(grant, fetchImpl = fetch) {
  const out = [];
  let page = null;
  for (let i = 0; i < 20; i++) {
    const body = await pave(grant, {
      organization: { $: { id: SOARD_ORG_ID }, jobs: { $: { size: 100, ...(page ? { page } : {}) }, nextPage: {},
        nodes: { id: {}, name: {}, createdAt: {}, closedOn: {}, location: { account: { id: {}, name: {} } } } } },
    }, fetchImpl);
    const conn = body?.organization?.jobs;
    if (!conn) throw new Error('JobTread’s answer had no jobs');
    out.push(...(conn.nodes || []));
    page = conn.nextPage || null;
    if (!page) return out;
  }
  throw new Error('more than 2,000 jobs: read stopped');
}

/**
 * Page key → the jobs no page is linked to that makeover costs' loose matcher gives to that page (the customer's name
 * and the job's own words, against pages filed in the years the job ran). Office test jobs never count.
 */
export function looseJobs(jobs, links, records) {
  const claimed = new Set([...links.values()].map((j) => j.id));
  const pages = records.map((r) => ({ ...r, jobtreadJobId: r.jobtreadJobId || r.data?.jobtreadJobId || null }));
  const out = new Map();
  for (const job of jobs) {
    if (claimed.has(job.id) || /^\s*test\b/i.test(job.name || '') || /^\s*test\b/i.test(job.location?.account?.name || '')) continue;
    const page = looseMatch(job, pages);
    if (!page) continue;
    const key = keyOf(page);
    out.set(key, [...(out.get(key) || []), { id: job.id, name: job.name || '' }]);
  }
  return out;
}

// ── D1 ────────────────────────────────────────────────────────────────

export async function listRows(DB) {
  await ensurePastJobs(DB);
  const { results } = await DB.prepare('SELECT * FROM past_jobs ORDER BY year, name').all();
  return results || [];
}

async function getState(DB, key) {
  await ensurePastJobs(DB);
  const row = await DB.prepare('SELECT value FROM past_jobs_state WHERE key = ?').bind(key).first();
  try { return row ? JSON.parse(row.value) : null; } catch { return null; }
}
async function setState(DB, key, value) {
  await ensurePastJobs(DB);
  await DB.prepare('INSERT OR REPLACE INTO past_jobs_state (key, value) VALUES (?, ?)').bind(key, JSON.stringify(value)).run();
}

/** Loads the reviewed list: new rows are added, a row not made yet takes the list's date; made rows are never touched */
export async function importRows(DB, rows, { by = null, now = Date.now() } = {}) {
  await ensurePastJobs(DB);
  const stmts = rows.map((r) => DB.prepare(`INSERT INTO past_jobs (key, kind, slug, name, year, draft_date, draft_how, draft_flag, state, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'listed', ?)
      ON CONFLICT(key) DO UPDATE SET name = excluded.name, year = excluded.year, draft_date = excluded.draft_date,
        draft_how = excluded.draft_how, draft_flag = excluded.draft_flag, updated_at = excluded.updated_at
      WHERE past_jobs.job_id IS NULL`)
    .bind(r.key, r.kind, r.slug, r.name, r.year, r.draft_date, r.draft_how, r.draft_flag, iso(now)));
  for (let i = 0; i < stmts.length; i += 50) await DB.batch(stmts.slice(i, i + 50));
  await setState(DB, 'imported', { at: iso(now), by, rows: rows.length });
  return { rows: rows.length };
}


/** Everything planning needs from JobTread and the site, read once */
async function readWorld(env, fetchImpl) {
  const grant = env.JOBTREAD_GRANT_KEY;
  if (!grant) throw new Error('JOBTREAD_GRANT_KEY is not set');
  const [kids, projects] = await Promise.all([loadAllKids(env.DB), loadAllProjects(env.DB)]);
  const records = [...kids, ...projects];
  const jobs = await fetchJobs(grant, { fetchImpl });
  const accounts = await readCustomers(grant, fetchImpl);
  const links = linkJobs(jobs, records);
  return { grant, records, jobs, links, accounts, loose: looseJobs(await readJobsWithCustomers(grant, fetchImpl), links, records) };
}

const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

/**
 * Reads JobTread and the site again and saves every row's plan (JobTread is only read). A queued row stays queued
 * while its plan is still 'make'; a made row is never re-planned. → { rows, summary }
 */
export async function planAll(env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const { DB } = env;
  const rows = await listRows(DB);
  const world = await readWorld(env, fetchImpl);
  const out = [];
  const stmts = [];
  for (const row of rows) {
    const p = planRow(row, { ...world, answer: parse(row.answer) });
    const state = row.job_id ? 'made' : p.plan !== 'make' ? p.plan : (['queued', 'failed'].includes(row.state) ? row.state : 'ready');
    stmts.push(DB.prepare(`UPDATE past_jobs SET plan = ?, plan_note = ?, plan_at = ?, close_on = ?, close_how = ?, plan_account_id = ?,
        plan_account_name = ?, plan_candidates = ?, plan_pin = ?, account_how = ?, job_name = ?, state = ?, updated_at = ? WHERE key = ? AND job_id IS NULL`)
      .bind(p.plan, p.note || null, iso(now), p.closeOn, p.closeHow, p.accountId || null, p.accountName || null,
        p.candidates?.length ? JSON.stringify(p.candidates) : null, p.pin ? 1 : 0, p.accountHow || null, p.jobName, state, iso(now), row.key));
    out.push({ ...row, plan: p.plan, plan_note: p.note || null, plan_pin: row.job_id ? row.plan_pin : (p.pin ? 1 : 0), close_on: p.closeOn, close_how: p.closeHow, plan_account_id: p.accountId || null,
      plan_account_name: p.accountName || null, account_how: p.accountHow || row.account_how || null, job_name: p.jobName, state,
      candidates: p.candidates || [], linked_job: p.jobId || null });
  }
  for (let i = 0; i < stmts.length; i += 50) await DB.batch(stmts.slice(i, i + 50));
  await setState(DB, 'planned', { at: iso(now), rows: out.length, jobs: world.jobs.length, customers: world.accounts.length });
  return { rows: out, summary: summarize(out) };
}

/** Counts by state, and what differs from the reviewed list (a date moved to Dec 31, a page that already has a job) */
export function summarize(rows) {
  const by = {};
  for (const r of rows) by[r.state] = (by[r.state] || 0) + 1;
  const newCustomers = rows.filter((r) => r.state !== 'made' && r.plan === 'make' && !r.plan_account_id).length;
  const differs = rows.filter((r) => r.draft_date && r.close_on && r.close_on !== r.draft_date).map((r) => ({ key: r.key, name: r.name, year: r.year, was: r.draft_date, now: r.close_on, why: r.close_how }));
  return { total: rows.length, by, newCustomers, existingCustomers: rows.filter((r) => r.plan === 'make' && r.plan_account_id).length, differs };
}

/**
 * A person's answer for a question row: { key, jobId } (JobTread already has its job), { key, job: 'none' } (it has
 * none: make one, the customer found as usual), { key, accountId } (this customer), { key, account: 'new' } (a new
 * customer) or { key, clear: true }
 */
export async function answerRow(DB, body, { by = null, now = Date.now() } = {}) {
  await ensurePastJobs(DB);
  const key = String(body?.key || '');
  const row = await DB.prepare('SELECT * FROM past_jobs WHERE key = ?').bind(key).first();
  if (!row) return { ok: false, error: 'That row isn’t on the list. Reload.' };
  if (row.job_id) return { ok: false, error: 'Its job is already made.' };
  const id = (v) => /^[A-Za-z0-9]{6,32}$/.test(String(v || ''));
  const answer = body?.clear ? null : body?.account === 'new' ? { account: 'new' } : body?.job === 'none' ? { job: 'none' }
    : id(body?.jobId) ? { jobId: String(body.jobId) } : id(body?.accountId) ? { accountId: String(body.accountId) } : undefined;
  if (answer === undefined) return { ok: false, error: 'Pick its job, one of the customers, or a new one.' };
  await DB.prepare('UPDATE past_jobs SET answer = ?, answered_by = ?, updated_at = ? WHERE key = ?').bind(answer ? JSON.stringify(answer) : null, by, iso(now), key).run();
  return { ok: true };
}

// ── Making ────────────────────────────────────────────────────────────

async function claimRow(DB, key, now) {
  const r = await DB.prepare('UPDATE past_jobs SET claimed_at = ? WHERE key = ? AND job_id IS NULL AND (claimed_at IS NULL OR claimed_at < ?)')
    .bind(iso(now), key, iso(now - CLAIM_STALE_MS)).run();
  return (r?.meta?.changes ?? 0) === 1;
}
const release = (DB, key) => DB.prepare('UPDATE past_jobs SET claimed_at = NULL WHERE key = ?').bind(key).run();
const saveMade = (DB, key, cols, now) => {
  const names = Object.keys(cols);
  return DB.prepare(`UPDATE past_jobs SET ${names.map((n) => `${n} = ?`).join(', ')}, updated_at = ? WHERE key = ?`).bind(...names.map((n) => cols[n]), iso(now), key).run();
};

/** A customer's primary location and its jobs (to find a job a lost answer already made) */
async function readAccount(grant, id, fetchImpl) {
  const body = await pave(grant, { account: { $: { id }, id: {}, name: {}, organization: { id: {} }, primaryLocation: { id: {} },
    locations: { $: { size: 5 }, nodes: { id: {} } }, jobs: { $: { size: 20, sortBy: [{ field: 'createdAt', order: 'desc' }] }, nodes: { id: {}, name: {}, closedOn: {} } } } }, fetchImpl);
  const a = body?.account;
  if (!a || a.organization?.id !== SOARD_ORG_ID) throw new Error('that JobTread customer isn’t SOARD’s');
  return a;
}

/** A customer this run made already, found by its exact name (an answer JobTread sent that never arrived) */
async function customerNamed(grant, name, fetchImpl) {
  const body = await pave(grant, { organization: { $: { id: SOARD_ORG_ID }, accounts: { $: { size: 2, where: { and: [['type', '=', 'customer'], ['name', '=', name]] } }, nodes: { id: {}, name: {} } } } }, fetchImpl);
  const nodes = body?.organization?.accounts?.nodes || [];
  return nodes.length === 1 ? nodes[0] : null;
}

/**
 * Makes one row's customer (if new), location and closed job, saving each id as it goes, so a second try picks up
 * where the first stopped and never makes a second customer or job. → { key, jobId, jobName, accountId, madeAccount }
 */
export async function makeRow(env, row, { fetchImpl = fetch, now = Date.now(), by = 'site' } = {}) {
  const { DB } = env;
  const grant = env.JOBTREAD_GRANT_KEY;
  if (row.plan !== 'make' || !row.job_name || !row.close_on) throw new Error('not ready: plan it again first');
  const retry = (row.attempts || 0) > 0;
  let accountId = row.account_id || null;
  let madeAccount = false;
  if (!accountId && row.plan_account_id) {
    accountId = row.plan_account_id;
    await saveMade(DB, row.key, { account_id: accountId, account_name: row.plan_account_name }, now);
  }
  if (!accountId) {
    const name = row.plan_account_name || accountNameFor(row);
    const found = retry ? await customerNamed(grant, name, fetchImpl) : null;
    if (found) accountId = found.id;
    else {
      const out = await pave(grant, { createAccount: { $: { organizationId: SOARD_ORG_ID, type: 'customer', name, notify: false, suffixIfNecessary: true }, createdAccount: { id: {}, name: {} } } }, fetchImpl);
      accountId = out?.createAccount?.createdAccount?.id;
      if (!accountId) throw new Error('JobTread didn’t return the new customer');
      madeAccount = true;
    }
    await saveMade(DB, row.key, { account_id: accountId, account_name: name }, now);
  }
  const acct = await readAccount(grant, accountId, fetchImpl);
  const already = (acct.jobs?.nodes || []).find((j) => j.name === row.job_name);
  if (already) {
    // Made by an earlier try whose answer never came back (or by hand, by that exact name): use it, never a second
    await saveMade(DB, row.key, { job_id: already.id, made_job_name: already.name, location_id: row.location_id || acct.primaryLocation?.id || null, state: 'made', made_at: iso(now), made_by: by, error: null, claimed_at: null }, now);
    if (row.plan_pin) await pinPage(env, { ...row, job_id: already.id }, now);
    return { key: row.key, jobId: already.id, jobName: already.name, accountId, madeAccount: false, found: true };
  }
  let locationId = row.location_id || acct.primaryLocation?.id || acct.locations?.nodes?.[0]?.id || null;
  if (!locationId) {
    const out = await pave(grant, { createLocation: { $: { accountId, name: row.kind === 'community' ? row.name : `${row.name} (${row.year})`, address: null }, createdLocation: { id: {} } } }, fetchImpl);
    locationId = out?.createLocation?.createdLocation?.id;
    if (!locationId) throw new Error('JobTread didn’t return the new location');
  }
  await saveMade(DB, row.key, { location_id: locationId }, now);
  const out = await pave(grant, {
    createJob: { $: { locationId, name: row.job_name, closedOn: row.close_on, customFieldValues: { [JOB_FIELD_STATUS]: DONE_STATUS } }, createdJob: { id: {}, name: {} } },
  }, fetchImpl);
  const job = out?.createJob?.createdJob;
  if (!job?.id) throw new Error('JobTread didn’t return the new job');
  await saveMade(DB, row.key, { job_id: job.id, made_job_name: job.name || row.job_name, state: 'made', made_at: iso(now), made_by: by, error: null, claimed_at: null }, now);
  if (row.plan_pin) await pinPage(env, { ...row, job_id: job.id }, now);
  return { key: row.key, jobId: job.id, jobName: job.name || row.job_name, accountId, madeAccount };
}

/**
 * Links the page to its made job by id (data.jobtreadJobId, saved the way an admin save is), for a job whose name can't
 * name the page alone. A page already linked to that job is done; one a person linked to another job is left as it is
 * and said. A save someone else beat is tried again on the next run (pinned_at stays empty). → true when linked
 */
export async function pinPage(env, row, now = Date.now()) {
  const { DB } = env;
  const collection = row.kind === 'community' ? 'community' : 'kids';
  const cur = await DB.prepare(`SELECT data FROM ${collection} WHERE slug = ?`).bind(row.slug).first();
  if (!cur) { await saveMade(DB, row.key, { error: 'made, but its page is gone, so nothing links to the job' }, now); return false; }
  let data = {};
  try { data = JSON.parse(cur.data || '{}'); } catch { /* an unreadable record is left alone */ return false; }
  if (data.jobtreadJobId && data.jobtreadJobId !== row.job_id) {
    await saveMade(DB, row.key, { pinned_at: iso(now), error: `made; its page was already linked to another job (${data.jobtreadJobId}), left as it was` }, now);
    return false;
  }
  if (data.jobtreadJobId !== row.job_id) {
    const saved = await saveRecord(env, collection, row.slug, data, { ...data, jobtreadJobId: row.job_id },
      `Linked to its past JobTread job: ${row.name} (${row.year})`, iso(now), { expect: cur.data, by: 'Past jobs (automatic)' });
    if (!saved) return false;
  }
  await saveMade(DB, row.key, { pinned_at: iso(now) }, now);
  return true;
}

/** One row, claimed, made, its failure recorded → the result, or { key, error } */
async function makeClaimed(env, row, { fetchImpl, now, by }) {
  const { DB } = env;
  if (!(await claimRow(DB, row.key, now))) return { key: row.key, error: 'another run has it' };
  try {
    return await makeRow(env, row, { fetchImpl, now, by });
  } catch (e) {
    const attempts = (row.attempts || 0) + 1;
    await saveMade(DB, row.key, { attempts, error: String(e.message || e).slice(0, 300), state: attempts >= 3 ? 'failed' : row.state, claimed_at: null }, now);
    return { key: row.key, error: String(e.message || e) };
  } finally {
    await release(DB, row.key).catch(() => null);
  }
}

/**
 * The first job, made alone so JobTread's workflows, QuickBooks and DataX can be checked before the rest: the first
 * ready row with a new customer (no contacts, so nobody can be emailed), oldest year first. Plans again first.
 */
export async function makeFirst(env, { fetchImpl = fetch, now = Date.now(), by = null } = {}) {
  const { DB } = env;
  if (await getState(DB, 'first')) return { ok: false, error: 'The first job is already made.' };
  const { rows } = await planAll(env, { fetchImpl, now });
  // A row an earlier try started comes first (its customer may be made already); else a kid with a new customer
  const row = rows.find((r) => r.state === 'ready' && r.attempts > 0) || rows.find((r) => r.state === 'ready' && !r.plan_account_id && r.kind === 'kid');
  if (!row) return { ok: false, error: 'No row is ready to make.' };
  const fresh = await DB.prepare('SELECT * FROM past_jobs WHERE key = ?').bind(row.key).first();
  const made = await makeClaimed(env, fresh, { fetchImpl, now, by: by || 'site' });
  if (made.error) return { ok: false, error: made.error, key: row.key };
  await setState(DB, 'first', { at: iso(now), by, ...made });
  return { ok: true, made };
}

/** "Make the rest": plans again, then queues every ready row for the sweep. Only after the first job was made */
export async function queueRest(env, { fetchImpl = fetch, now = Date.now(), by = null } = {}) {
  const { DB } = env;
  if (!(await getState(DB, 'first'))) return { ok: false, error: 'Make the first job and check it first.' };
  const { rows, summary } = await planAll(env, { fetchImpl, now });
  const ready = rows.filter((r) => r.state === 'ready' || (r.state === 'failed' && r.plan === 'make'));
  const stmts = ready.map((r) => DB.prepare("UPDATE past_jobs SET state = 'queued', attempts = 0, error = NULL, updated_at = ? WHERE key = ? AND job_id IS NULL").bind(iso(now), r.key));
  for (let i = 0; i < stmts.length; i += 50) await DB.batch(stmts.slice(i, i + 50));
  await setState(DB, 'queued', { at: iso(now), by, rows: ready.length });
  return { ok: true, queued: ready.length, summary };
}

/** On the application sweep: a few queued rows a run, oldest year first → { made, errors } or null when none wait */
export async function runPastJobs(env, { fetchImpl = fetch, now = Date.now(), limit = PER_RUN } = {}) {
  const { DB } = env;
  if (!DB || !env.JOBTREAD_GRANT_KEY) return null;
  await ensurePastJobs(DB);
  // Made jobs whose page still waits to be linked to them (a save someone else beat) come round first
  const { results: unpinned } = await DB.prepare("SELECT * FROM past_jobs WHERE job_id IS NOT NULL AND plan_pin = 1 AND pinned_at IS NULL LIMIT 5").all();
  for (const row of unpinned || []) await pinPage(env, row, now).catch(() => null);
  const { results } = await DB.prepare("SELECT * FROM past_jobs WHERE state = 'queued' AND job_id IS NULL ORDER BY year, name LIMIT ?").bind(limit).all();
  if (!results?.length) return null;
  const out = { made: [], errors: [] };
  for (const row of results) {
    const r = await makeClaimed(env, row, { fetchImpl, now, by: 'site (Make the rest)' });
    if (r.error) out.errors.push(r); else out.made.push(r);
  }
  await setState(DB, 'lastRun', { at: iso(now), made: out.made.length, errors: out.errors.length });
  return out;
}

/** For the admin: every row, the counts, and when it was last loaded, planned, started and run */
export async function pastJobsStatus(DB) {
  const rows = await listRows(DB);
  const [imported, planned, first, queued, lastRun] = await Promise.all(['imported', 'planned', 'first', 'queued', 'lastRun'].map((k) => getState(DB, k)));
  return { rows: rows.map((r) => ({ ...r, answer: parse(r.answer), candidates: parse(r.plan_candidates) || [] })), summary: summarize(rows), imported, planned, first, queued, lastRun, today: todayEastern() };
}

/** For Site → Automations: counts by state and the last run, or null before the list was loaded */
export async function pastJobsFacts(DB) {
  await ensurePastJobs(DB);
  const { results } = await DB.prepare('SELECT state, count(*) AS n FROM past_jobs GROUP BY state').all();
  const by = Object.fromEntries((results || []).map((r) => [r.state, r.n]));
  const total = Object.values(by).reduce((a, b) => a + b, 0);
  if (!total) return null;
  const [first, lastRun] = await Promise.all([getState(DB, 'first'), getState(DB, 'lastRun')]);
  const failed = (await DB.prepare("SELECT name, year, error FROM past_jobs WHERE state = 'failed' ORDER BY year, name LIMIT 5").all()).results || [];
  return { total, by, firstAt: first?.at || null, lastRunAt: lastRun?.at || null, failed };
}
