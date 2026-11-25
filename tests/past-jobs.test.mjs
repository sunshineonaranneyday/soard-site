/**
 * Past makeovers and community projects as closed JobTread jobs (functions/api/_past-jobs.js): the close date, which
 * customer, what is asked of a person, and the maker against a fake JobTread: a new customer with no Status, Year or
 * contact (so never an applicant, nobody emailed), a location with no address, a closed job named so the kid status
 * sync links it; a retry never makes a second customer or job; nothing is made before the first job, or past a
 * person's question.
 * Run: node --test tests/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';
import {
  closeDateFor, customersFor, planRow, checkImport, importRows, planAll, makeFirst, queueRest, runPastJobs, answerRow,
  accountNameFor, jobNameForRow, summarize, ensurePastJobs, DONE_STATUS,
} from '../functions/api/_past-jobs.js';
import { linkJobs } from '../functions/api/_kid-status.js';
import { isApplicantAccount, rowFromAccount } from '../functions/api/_applicants.js';

const SOARD = '22NJw42j5GLg';
const FIELD_YEAR = '22P52xmCz3cx';
const FIELD_STATUS = '22P52qfFub9b';
const acct = (id, name, { year = null, jobs = [], archivedAt = null, primaryLocation = null } = {}) => ({
  id, name, archivedAt, primaryLocation,
  customFieldValues: { nodes: year ? [{ value: String(year), customField: { id: FIELD_YEAR } }] : [] },
  jobs: { nodes: jobs },
});
const kid = (slug, name, year, data = {}) => ({ slug, name, year, data: { name, year, status: 'completed', ...data } });
const project = (slug, name, year) => ({ kind: 'community', slug, name, year, status: 'completed', data: { name, year } });

test('the close date: the reviewed reveal date in its year or the three months after, else Dec 31', () => {
  assert.deepEqual(closeDateFor(2012, '2012-07-14', 'most reveal photos'), { closeOn: '2012-07-14', how: 'most reveal photos' });
  assert.equal(closeDateFor(2024, '2025-01-27').closeOn, '2025-01-27', 'a December build revealed in January');
  assert.equal(closeDateFor(2024, '2025-04-01').closeOn, '2024-12-31');
  assert.equal(closeDateFor(2020, '2000-01-01').closeOn, '2020-12-31', 'a camera clock never set');
  assert.equal(closeDateFor(2021, '2016-06-04').closeOn, '2021-12-31', 'another year’s photos');
  assert.match(closeDateFor(2021, '2016-06-04').how, /isn’t in 2021/);
  assert.deepEqual(closeDateFor(2015, null), { closeOn: '2015-12-31', how: 'no reveal date found, so Dec 31 of the year' });
});

test('names: a family’s new customer carries the year, an organization its own name; the job by the approval’s namer', () => {
  assert.equal(accountNameFor({ kind: 'kid', name: 'Mathew', year: 2012 }), 'Mathew (2012)');
  assert.equal(accountNameFor({ kind: 'community', name: 'Camp Twin Lakes', year: 2018 }), 'Camp Twin Lakes');
  assert.equal(jobNameForRow({ kind: 'kid', name: 'TA & Alissa', year: 2014 }), 'TA & Alissa (2014)');
  assert.ok(jobNameForRow({ kind: 'community', name: 'Childrens Development Academy of Greater Atlanta', year: 2025 }).length <= 30);
});

test('which customer: every word of the name and the page’s year; an organization by its exact name', () => {
  const accounts = [
    acct('a1', 'Mathew Smith', { year: 2012 }),
    acct('a2', 'Mathew Jones', { jobs: [{ id: 'j', name: 'Mathew Jones (2019)' }] }),
    acct('a3', 'Briana (2013)'),
    acct('a4', 'Camp Twin Lakes'),
    acct('a5', 'Camp Twin Lakes Foundation'),
    acct('a6', 'Mathew Old', { year: 2012, archivedAt: '2024-01-01' }),
  ];
  assert.deepEqual(customersFor({ kind: 'kid', name: 'Mathew', year: 2012 }, accounts).map((a) => a.id), ['a1'], 'the Year field; an archived one never');
  assert.deepEqual(customersFor({ kind: 'kid', name: 'Mathew', year: 2019 }, accounts).map((a) => a.id), ['a2'], 'a job named for that year');
  assert.deepEqual(customersFor({ kind: 'kid', name: 'Briana', year: 2013 }, accounts).map((a) => a.id), ['a3'], 'the year in the customer’s name');
  assert.deepEqual(customersFor({ kind: 'kid', name: 'Briana', year: 2016 }, accounts), [], 'another year is another makeover');
  assert.deepEqual(customersFor({ kind: 'community', name: 'Camp Twin Lakes', year: 2018 }, accounts).map((a) => a.id), ['a4']);
});

test('each row’s plan: already has a job, one customer, a new one, or a question for a person', () => {
  const records = [kid('mathew', 'Mathew', 2012), kid('ava', 'Ava', 2026), kid('briana', 'Briana', 2013), kid('briana-2016', 'Briana', 2016),
    kid('max', 'Max', 2019), kid('max-b', 'Max', 2019), project('camp-twin-lakes', 'Camp Twin Lakes', 2018)];
  const jobs = [{ id: 'jAva', name: 'Ava Lee (2026)', closedOn: null }];
  const links = linkJobs(jobs, records);
  const accounts = [acct('m1', 'Mathew A', { year: 2012 }), acct('m2', 'Mathew B', { year: 2012 }), acct('b1', 'Briana Cole', { year: 2013 })];
  const row = (key, kind, slug, name, year, extra = {}) => ({ key, kind, slug, name, year, draft_date: `${year}-06-01`, ...extra });
  const w = { accounts, links, records };
  assert.equal(planRow(row('ava', 'kid', 'ava', 'Ava', 2026), w).plan, 'has-job');
  const two = planRow(row('mathew', 'kid', 'mathew', 'Mathew', 2012), w);
  assert.equal(two.plan, 'ask');
  assert.deepEqual(two.candidates.map((c) => c.id), ['m1', 'm2']);
  assert.equal(planRow(row('mathew', 'kid', 'mathew', 'Mathew', 2012), { ...w, answer: { accountId: 'm2' } }).accountId, 'm2', 'a person’s pick');
  const asNew = planRow(row('mathew', 'kid', 'mathew', 'Mathew', 2012), { ...w, answer: { account: 'new' } });
  assert.deepEqual([asNew.plan, asNew.accountId, asNew.accountName], ['make', null, 'Mathew (2012)']);
  const one = planRow(row('briana', 'kid', 'briana', 'Briana', 2013), w);
  assert.deepEqual([one.plan, one.accountId, one.jobName, one.closeOn], ['make', 'b1', 'Briana (2013)', '2013-06-01']);
  const fresh = planRow(row('briana-2016', 'kid', 'briana-2016', 'Briana', 2016), w);
  assert.deepEqual([fresh.plan, fresh.accountId, fresh.accountName], ['make', null, 'Briana (2016)']);
  // Two pages with one name and year: the job's name can't tell the kid status sync which, so the page is linked by id
  const twin = planRow(row('max', 'kid', 'max', 'Max', 2019), w);
  assert.deepEqual([twin.plan, twin.pin], ['make', true]);
  assert.match(twin.note, /linked to the job by id/);
  assert.equal(one.pin, false, 'a name that names its page alone needs no link');
  assert.equal(planRow(row('camp-twin-lakes', 'community', 'camp-twin-lakes', 'Camp Twin Lakes', 2018), w).jobName, 'Camp Twin Lakes (2018)');
  assert.equal(planRow(row('gone', 'kid', 'gone', 'Gone', 2014), w).plan, 'ask', 'a page that was deleted');
});

test('the reviewed list is checked before it is loaded', () => {
  const ok = checkImport({ rows: [{ kind: 'kid', slug: 'mathew', name: 'Mathew', year: '2012', date: '2012-07-14', how: 'most photos', flag: 'check' },
    { kind: 'community', slug: 'camp', name: 'Camp', year: 2018, date: '' }] });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.rows.map((r) => [r.key, r.draft_date]), [['mathew', '2012-07-14'], ['community/camp', null]]);
  assert.equal(checkImport({ rows: [{ kind: 'kid', slug: 'Bad Slug', name: 'X', year: 2012 }] }).ok, false);
  assert.equal(checkImport({ rows: [{ kind: 'kid', slug: 'a', name: 'A', year: 2012 }, { kind: 'kid', slug: 'a', name: 'A', year: 2012 }] }).ok, false);
  assert.equal(checkImport({}).ok, false);
});

// ── A fake JobTread that keeps what it's asked to make ────────────────────────
function fakeJobTread({ accounts = [], jobs = [], loseAnswerOf = null } = {}) {
  const st = { accounts: accounts.map((a) => ({ ...a, locations: [], jobs: { nodes: [...(a.jobs?.nodes || [])] } })), jobs: [...jobs], calls: [], n: 0 };
  const id = (p) => `${p}${++st.n}x`.padEnd(12, '0');
  const fetchImpl = async (url, init) => {
    const q = JSON.parse(init.body).query;
    delete q.$;
    const op = Object.keys(q)[0];
    st.calls.push({ op, input: q[op].$ || null });
    const lost = loseAnswerOf === op && !st.lost && (st.lost = true);
    if (op === 'createAccount') {
      const a = { id: id('A'), name: q.createAccount.$.name, archivedAt: null, customFieldValues: { nodes: [] }, primaryLocation: null, locations: [], jobs: { nodes: [] }, type: 'customer' };
      st.accounts.push(a);
      if (lost) return new Response('timeout', { status: 504 });
      return Response.json({ createAccount: { createdAccount: { id: a.id, name: a.name } } });
    }
    if (op === 'createLocation') {
      const a = st.accounts.find((x) => x.id === q.createLocation.$.accountId);
      const loc = { id: id('L'), address: q.createLocation.$.address };
      a.locations.push(loc);
      a.primaryLocation ||= { id: loc.id };
      return Response.json({ createLocation: { createdLocation: { id: loc.id } } });
    }
    if (op === 'createJob') {
      const $ = q.createJob.$;
      const a = st.accounts.find((x) => x.locations.some((l) => l.id === $.locationId) || x.primaryLocation?.id === $.locationId);
      const j = { id: id('J'), name: $.name, closedOn: $.closedOn, createdAt: '2026-11-25T15:00:00Z', status: $.customFieldValues };
      a.jobs.nodes.unshift(j);
      st.jobs.push({ ...j, customFieldValues: { nodes: [] }, tasks: { nodes: [] } });
      if (lost) return new Response('timeout', { status: 504 });
      return Response.json({ createJob: { createdJob: { id: j.id, name: j.name } } });
    }
    if (op === 'account') {
      const a = st.accounts.find((x) => x.id === q.account.$.id);
      return Response.json({ account: a ? { ...a, organization: { id: SOARD }, locations: { nodes: a.locations } } : null });
    }
    if (op === 'organization') {
      const o = q.organization;
      if (o.jobs) return Response.json({ organization: { jobs: { nextPage: null, nodes: st.jobs } } });
      if (o.accounts) {
        const where = JSON.stringify(o.accounts.$.where || '');
        const named = where.match(/\["name","=","([^"]+)"\]/);
        const list = named ? st.accounts.filter((a) => a.name === named[1]) : st.accounts;
        return Response.json({ organization: { accounts: { nextPage: null, nodes: list } } });
      }
    }
    throw new Error(`fake JobTread: no answer for ${op}`);
  };
  return { st, fetchImpl, made: (op) => st.calls.filter((c) => c.op === op) };
}

async function siteWith({ kids = [], projects = [] } = {}) {
  const DB = await createD1({ schemaFiles: ['scripts/schema.sql'] });
  for (const k of kids) await DB.prepare('INSERT INTO kids (slug, name, year, status, data) VALUES (?, ?, ?, ?, ?)').bind(k.slug, k.name, k.year, 'completed', JSON.stringify(k.data)).run();
  await DB.prepare('CREATE TABLE IF NOT EXISTS community (slug TEXT PRIMARY KEY, name TEXT, data TEXT)').run();
  for (const p of projects) await DB.prepare('INSERT INTO community (slug, name, data) VALUES (?, ?, ?)').bind(p.slug, p.name, JSON.stringify(p.data)).run();
  await ensurePastJobs(DB);
  return { DB, JOBTREAD_GRANT_KEY: 'grant' };
}

test('the first job: a new customer with nothing that makes it an applicant, a location with no address, a closed job', async () => {
  const env = await siteWith({ kids: [kid('mathew', 'Mathew', 2012), kid('briana', 'Briana', 2013)] });
  const checked = checkImport({ rows: [{ kind: 'kid', slug: 'mathew', name: 'Mathew', year: 2012, date: '2012-07-14', how: 'most photos' },
    { kind: 'kid', slug: 'briana', name: 'Briana', year: 2013, date: '2016-10-15', how: 'most reveal photos' }] });
  await importRows(env.DB, checked.rows);
  const jt = fakeJobTread({ accounts: [acct('b1', 'Briana Cole', { year: 2013, primaryLocation: { id: 'Lhome' } })] });

  assert.equal((await queueRest(env, { fetchImpl: jt.fetchImpl })).ok, false, 'nothing is queued before the first job');
  assert.equal(jt.made('createJob').length, 0);

  const first = await makeFirst(env, { fetchImpl: jt.fetchImpl, by: 'peter@soardcharity.com' });
  assert.equal(first.ok, true, first.error);
  assert.equal(first.made.key, 'mathew', 'a row with a new customer goes first: no contacts, nobody to email');
  const [ca] = jt.made('createAccount');
  assert.deepEqual(ca.input, { organizationId: SOARD, type: 'customer', name: 'Mathew (2012)', notify: false, suffixIfNecessary: true });
  assert.equal(jt.made('createLocation')[0].input.address, null);
  const [cj] = jt.made('createJob');
  assert.deepEqual([cj.input.name, cj.input.closedOn, cj.input.customFieldValues[FIELD_STATUS]], ['Mathew (2012)', '2012-07-14', DONE_STATUS]);
  // What the site's applicant rule sees of the new customer: no Status, no Makeover Year, no application → not an applicant
  const made = jt.st.accounts.find((a) => a.name === 'Mathew (2012)');
  assert.equal(isApplicantAccount({ ...made, type: 'customer' }), false);
  assert.equal((await makeFirst(env, { fetchImpl: jt.fetchImpl })).ok, false, 'only one first job');

  // The rest: Briana's existing customer, at the family's own location, closed Dec 31 (her date was another year's)
  const rest = await queueRest(env, { fetchImpl: jt.fetchImpl, by: 'peter@soardcharity.com' });
  assert.deepEqual([rest.ok, rest.queued], [true, 1]);
  const run = await runPastJobs(env, { fetchImpl: jt.fetchImpl });
  assert.deepEqual(run.errors, []);
  assert.equal(jt.made('createAccount').length, 1, 'no second customer');
  assert.equal(jt.made('createLocation').length, 1, 'the family’s own location');
  const briana = jt.made('createJob')[1].input;
  assert.deepEqual([briana.locationId, briana.name, briana.closedOn], ['Lhome', 'Briana (2013)', '2013-12-31']);
  assert.equal(await runPastJobs(env, { fetchImpl: jt.fetchImpl }), null, 'nothing left');
  // Planned again: both are made, and the kid status sync's link sees the new jobs as theirs
  const again = await planAll(env, { fetchImpl: jt.fetchImpl });
  assert.deepEqual(again.rows.map((r) => r.state).sort(), ['made', 'made']);
});

test('a lost answer: the next try finds the customer and the job it made, and never makes a second', async () => {
  const env = await siteWith({ kids: [kid('gavin', 'Gavin', 2013)] });
  await importRows(env.DB, checkImport({ rows: [{ kind: 'kid', slug: 'gavin', name: 'Gavin', year: 2013, date: '2013-01-05' }] }).rows);
  const jt = fakeJobTread({ loseAnswerOf: 'createAccount' });
  assert.equal((await makeFirst(env, { fetchImpl: jt.fetchImpl })).ok, false, 'the answer was lost');
  await env.DB.prepare("UPDATE past_jobs SET claimed_at = NULL").run();
  // The first job isn't recorded, so it is the first job again: the customer made last time is found by name
  const again = await makeFirst(env, { fetchImpl: jt.fetchImpl });
  assert.equal(again.ok, true, again.error);
  assert.equal(jt.made('createAccount').length, 1, 'found, not made twice');
  assert.equal(jt.st.accounts.filter((a) => a.name.startsWith('Gavin')).length, 1);

  const env2 = await siteWith({ kids: [kid('demetri', 'Demetri', 2012)] });
  await importRows(env2.DB, checkImport({ rows: [{ kind: 'kid', slug: 'demetri', name: 'Demetri', year: 2012, date: '2012-11-15' }] }).rows);
  const jt2 = fakeJobTread({ loseAnswerOf: 'createJob' });
  assert.equal((await makeFirst(env2, { fetchImpl: jt2.fetchImpl })).ok, false);
  await env2.DB.prepare('UPDATE past_jobs SET claimed_at = NULL').run();
  const found = await makeFirst(env2, { fetchImpl: jt2.fetchImpl });
  assert.equal(found.ok, true, found.error);
  assert.equal(found.made.found, true);
  assert.equal(jt2.made('createJob').length, 1, 'the job JobTread made is used, not a second');
});

test('a row with several customers waits for a person, then is made with their pick', async () => {
  const env = await siteWith({ kids: [kid('mathew', 'Mathew', 2012), kid('ruby', 'Ruby', 2016)] });
  await importRows(env.DB, checkImport({ rows: [{ kind: 'kid', slug: 'mathew', name: 'Mathew', year: 2012, date: '2012-07-14' },
    { kind: 'kid', slug: 'ruby', name: 'Ruby', year: 2016, date: '2016-03-15' }] }).rows);
  const jt = fakeJobTread({ accounts: [acct('mAAAAA1', 'Mathew A', { year: 2012, primaryLocation: { id: 'L1' } }), acct('mAAAAA2', 'Mathew B', { year: 2012, primaryLocation: { id: 'L2' } })] });
  assert.equal((await makeFirst(env, { fetchImpl: jt.fetchImpl })).made.key, 'ruby');
  const q = await queueRest(env, { fetchImpl: jt.fetchImpl });
  assert.equal(q.queued, 0, 'the question row isn’t queued');
  assert.equal(q.summary.by.ask, 1);
  assert.equal((await answerRow(env.DB, { key: 'mathew', accountId: 'bad id!' })).ok, false);
  assert.equal((await answerRow(env.DB, { key: 'mathew', accountId: 'mAAAAA2' }, { by: 'linzi' })).ok, true);
  assert.equal((await queueRest(env, { fetchImpl: jt.fetchImpl })).queued, 1);
  await runPastJobs(env, { fetchImpl: jt.fetchImpl });
  assert.equal(jt.made('createJob').at(-1).input.locationId, 'L2');
});

test('summary: counts by state and every date that differs from the reviewed list', () => {
  const s = summarize([{ state: 'ready', plan: 'make', plan_account_id: null, draft_date: '2016-06-04', close_on: '2021-12-31', key: 'helen', name: 'Helen', year: 2021, close_how: 'x' },
    { state: 'has-job', plan: 'has-job', draft_date: '2025-07-23', close_on: '2025-07-23' }]);
  assert.deepEqual(s.by, { ready: 1, 'has-job': 1 });
  assert.equal(s.newCustomers, 1);
  assert.deepEqual(s.differs.map((d) => d.key), ['helen']);
});

test('a family’s current job: open first, then a job really worked, and a past makeover’s record only when nothing else', async () => {
  const { latestJob, madeClosed } = await import('../functions/api/_jt-jobs.js');
  const past = { id: 'past', name: 'Briana (2013)', closedOn: '2013-12-31', createdAt: '2026-11-25T15:00:00Z' };
  const worked = { id: 'worked', name: 'Briana Cole (2024)', closedOn: '2024-11-02', createdAt: '2024-03-01T15:00:00Z' };
  const open = { id: 'open', name: 'Briana Cole (2026)', closedOn: null, createdAt: '2026-02-01T15:00:00Z' };
  assert.equal(madeClosed(past), true);
  assert.equal(madeClosed(worked), false);
  assert.equal(madeClosed({ closedOn: '2026-11-25', createdAt: '2026-11-25T20:00:00Z' }), false, 'closed the day it was made is not a past record');
  assert.equal(latestJob([past, worked, open]).id, 'open');
  assert.equal(latestJob([past, worked]).id, 'worked', 'the newest by createdAt (the past record) would be wrong');
  assert.equal(latestJob([past]).id, 'past');
  assert.equal(latestJob([]), null);
  // The applicants mirror keeps the family's real job when a past makeover's job is added to their customer
  const row = rowFromAccount({ id: 'acc', name: 'Briana Cole', type: 'customer', customFieldValues: { nodes: [] }, jobs: { nodes: [past, worked] } }, null);
  assert.equal(row.job_id, 'worked');
});

// ── What the rest of the site does with a past makeover's record: nothing it shouldn't ───────────────────────
const pastJob = (extra = {}) => ({ id: 'jPast', name: 'Max (2014)', closedOn: '2014-12-31', createdAt: '2026-11-25T15:00:00Z', number: '1100', ...extra });
const workedJob = { id: 'jWorked', name: 'Ava Lee (2025)', closedOn: '2025-10-02', createdAt: '2025-03-01T15:00:00Z', number: '1050' };
const orgJobsFetch = (jobs, seen = []) => async (url, init) => {
  const q = JSON.parse(init.body).query;
  seen.push(q);
  return Response.json({ organization: { jobs: { nextPage: null, nodes: jobs.map((j) => ({ ...j, customFieldValues: { nodes: [] }, location: { street: '', account: { name: 'X' } } })) } } });
};

test('close-outs: a past makeover’s record is never a close-out (no work or money went through it)', async () => {
  const { closedJobs } = await import('../functions/api/_job-closeout.js');
  const seen = [];
  const got = await closedJobs({ JOBTREAD_GRANT_KEY: 'g' }, '2025-01-01', { fetchImpl: orgJobsFetch([pastJob({ closedOn: '2025-07-23', name: 'Harper (2025)' }), workedJob], seen) });
  assert.deepEqual(got.map((j) => j.id), ['jWorked']);
  assert.ok('createdAt' in seen[0].organization.jobs.nodes, 'it asks when each job was made');
});

test('the CompanyCam copier leaves past makeovers’ records alone', async () => {
  const { listJobs } = await import('../functions/api/_companycam-jobs.js');
  const got = await listJobs({ JOBTREAD_GRANT_KEY: 'g', DB: null }, orgJobsFetch([pastJob(), workedJob]), { closed: true });
  assert.deepEqual(got.map((j) => j.id), ['jWorked']);
});

test('makeover costs: a past record’s years are its name’s and close date’s, never the day it was made', async () => {
  const { looseMatch } = await import('../functions/api/_makeover-costs.js');
  const records = [{ slug: 'max-2026', name: 'Max', year: 2026 }, { slug: 'max', name: 'Max', year: 2014 }];
  // "Job for Max" made today, closed 2014: only 2014's Max can be it, never this year's
  const job = pastJob({ name: 'Job for Max', location: { account: { name: 'Max (2014)' } } });
  assert.equal(looseMatch(job, records)?.slug, 'max');
  assert.equal(looseMatch({ ...job, closedOn: '2014-12-31', createdAt: '2014-03-01T15:00:00Z' }, records)?.slug, 'max', 'a job really worked in 2014 too');
});

test('the Zillow check looks only at locations with an address (a past record has none)', async () => {
  const { zillowFacts } = await import('../functions/api/automations-admin.js');
  let asked = null;
  await zillowFacts('g', async (url, init) => { asked = JSON.parse(init.body).query.organization.locations.$; return Response.json({ organization: { locations: { nodes: [] } } }); });
  assert.deepEqual(asked.where, ['address', '!=', null]);
});

test('the board’s cost note: a handful by name, past that the newest few and the rest counted', async () => {
  const { notCounted } = await import('../public/admin/board/costs.js');
  assert.equal(notCounted([]), '');
  assert.equal(notCounted([{ name: 'Ava', season: 2025 }, { name: 'Bo', season: 2026 }]), ' Not counted: Bo and Ava (2025 and 2026), with no bills in JobTread.');
  const many = Array.from({ length: 170 }, (_, i) => ({ name: `Kid${i}`, season: 2012 + (i % 13) }));
  const text = notCounted(many);
  assert.match(text, /^ Not counted, with no bills in JobTread: .+ and 166 more from 2012 to 2024\.$/);
  assert.ok(text.length < 200);
});

test('a long organization name cut to 30 characters: its page is linked to the new job by id', async () => {
  const env = await siteWith({ kids: [kid('ruby', 'Ruby', 2016)], projects: [project('murphy-harpst', 'Murphy-Harpst Children’s Center', 2015)] });
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS community_extra (x TEXT)').run();
  await importRows(env.DB, checkImport({ rows: [{ kind: 'kid', slug: 'ruby', name: 'Ruby', year: 2016, date: '2016-03-15' },
    { kind: 'community', slug: 'murphy-harpst', name: 'Murphy-Harpst Children’s Center', year: 2015, date: '2015-06-01' }] }).rows);
  const jt = fakeJobTread();
  assert.equal((await makeFirst(env, { fetchImpl: jt.fetchImpl })).made.key, 'ruby');
  const q = await queueRest(env, { fetchImpl: jt.fetchImpl });
  assert.equal(q.queued, 1);
  await runPastJobs(env, { fetchImpl: jt.fetchImpl });
  const job = jt.made('createJob').at(-1).input;
  assert.equal(job.name, 'Murphy-Harpst (2015)', 'the name JobTread can hold');
  const rec = JSON.parse((await env.DB.prepare("SELECT data FROM community WHERE slug = 'murphy-harpst'").first()).data);
  const made = jt.st.jobs.find((j) => j.name === 'Murphy-Harpst (2015)');
  assert.equal(rec.jobtreadJobId, made.id, 'the page is pinned to its job');
  const again = await planAll(env, { fetchImpl: jt.fetchImpl });
  assert.deepEqual(again.rows.map((r) => [r.key, r.state]).sort(), [['community/murphy-harpst', 'made'], ['ruby', 'made']]);
  // and the kid status sync's link now finds it by id
  const { linkJobs } = await import('../functions/api/_kid-status.js');
  const records = [{ kind: 'community', slug: 'murphy-harpst', name: rec.name, year: 2015, status: 'completed', data: rec }];
  assert.equal(linkJobs([{ id: made.id, name: made.name, closedOn: made.closedOn }], records).get('community/murphy-harpst')?.id, made.id);
  // Ruby's name names her page alone: no link written
  assert.equal(JSON.parse((await env.DB.prepare("SELECT data FROM kids WHERE slug = 'ruby'").first()).data).jobtreadJobId, undefined);
});
