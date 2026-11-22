/**
 * The website's side of the backup (functions/api/_backup.js, backup-admin.js): the 15-minute upkeep (Stream MP4s
 * and the signing key, done with the site's own Stream key), the alerts and their all-clear, and what the admin
 * reads and sends. The backup is reached through its binding's methods (BackupAPI), faked here; the real Worker and
 * this same file are tested together in workers/backup (npm test there).
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';
import { maybeBackupChores, backupProblems, backupFacts } from '../functions/api/_backup.js';
import { onRequestPost, onRequestGet } from '../functions/api/backup-admin.js';

const NOW = Date.parse('2026-11-14T12:00:00Z');
const MIN = 60_000;
const fine = () => ({
  setup: { ready: true, problems: [] },
  night: { run: '2026-11-14', finished: '2026-11-14T08:10:00Z', errors: [], failures: [], problems: [], problemKinds: [], notes: [], waitingToShip: 0, homes: { drive: true, b2: true }, ok: true },
  drill: { run: '2026-11-14', ok: true, problems: [] },
  started: { run: '2026-11-14', at: '2026-11-14T07:00:00Z', status: 'complete' },
  setUpAt: '2026-11-10T12:00:00Z',
  key: { fingerprint: 'ABCD-1234-ABCD-1234' }, databases: ['soard-db'], repos: [], counts: {}, needs: {}, recovery: {},
});

function world({ status = fine(), needs = { streamKey: false, videos: [] } } = {}) {
  const w = { calls: [], status, needs, keys: [], held: null, stream: [], alerts: [], down: false, refuseKey: false, keepButThrow: false, alertFails: 0, streamKeysList: [], downloads: {} };
  const answer = (name, fn) => async (arg) => {
    w.calls.push(name);
    if (w.down) throw new Error('Worker "soard-backup" not found');
    return fn(arg);
  };
  w.BACKUP = {
    status: answer('status', () => ({ ...structuredClone(w.status), streamKey: w.held ? { id: w.held } : null })),
    needs: answer('needs', () => structuredClone(w.needs)),
    setStreamKey: answer('setStreamKey', (k) => {
      if (w.refuseKey) throw new Error('busy');
      const replaced = w.held;
      w.keys.push(k); w.held = k.id; w.needs.streamKey = false;
      if (w.keepButThrow) throw new Error('the answer was lost');
      return { ok: true, replaced };
    }),
    check: answer('check', () => ({ ready: true, problems: [] })),
    run: answer('run', (a) => ({ started: true, by: a.by })),
    recoverySheet: answer('recoverySheet', (a) => ({ identity: 'AGE-SECRET-KEY-PQ-1TEST', fingerprint: 'ABCD-1234-ABCD-1234', by: a.by })),
    recoveryPrinted: answer('recoveryPrinted', (a) => ({ printed: { by: a.by } })),
  };
  let n = 0;
  w.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    const path = u.pathname.replace('/client/v4/accounts/acct/stream', '');
    w.stream.push(`${method} ${path}`);
    assert.equal(init.headers.Authorization, 'Bearer stream-key', 'the site’s own Stream key, never the backup’s');
    if (path === '/keys' && method === 'POST') { const id = `kid${++n}`; w.streamKeysList.push({ id, created: new Date().toISOString() }); return Response.json({ success: true, result: { id, jwk: 'eyJrZXkiOnRydWV9', pem: 'PEM' } }); }
    if (path === '/keys' && method === 'GET') return Response.json({ success: true, result: w.streamKeysList });
    if (/^\/keys\//.test(path) && method === 'DELETE') { const id = path.split('/').pop(); if (!w.streamKeysList.some((k) => k.id === id)) return Response.json({ success: false, errors: [{ message: 'not found' }] }, { status: 404 }); w.streamKeysList = w.streamKeysList.filter((k) => k.id !== id); return Response.json({ success: true, result: 'Revoked' }); }
    const m = /^\/([^/]+)\/downloads$/.exec(path);
    if (m && method === 'GET') return Response.json({ success: true, result: w.downloads[m[1]] ? { default: w.downloads[m[1]] } : {} });
    if (m && method === 'POST') { w.downloads[m[1]] = { status: 'inprogress' }; return Response.json({ success: true, result: { default: w.downloads[m[1]] } }); }
    if (m && method === 'DELETE') { delete w.downloads[m[1]]; return Response.json({ success: true, result: 'ok' }); }
    throw new Error(`unexpected ${method} ${url}`);
  };
  w.alert = async (card) => {
    if (w.alertFails > 0) { w.alertFails--; return { slack: { ok: false, error: 'Slack is down' }, email: null }; }
    w.alerts.push(card);
    return { slack: { ok: true } };
  };
  return w;
}

async function env(w) {
  const DB = await createD1({ schemaSql: ['CREATE TABLE site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)'] });
  return { DB, BACKUP: w.BACKUP, CF_ACCOUNT_ID: 'acct', CF_STREAM_TOKEN: 'stream-key' };
}
const chores = (e, w, at, more = {}) => maybeBackupChores(e, { now: at, fetchImpl: w.fetch, alert: w.alert, ...more });
const ROUND = 16 * MIN;

test('upkeep: a Stream signing key only when one is needed, and an MP4 for each video waiting, each asked once a day', async () => {
  const w = world({ needs: { streamKey: true, videos: ['v1', 'v2'] } });
  const e = await env(w);
  const r = await chores(e, w, NOW);
  assert.deepEqual(w.keys, [{ id: 'kid1', jwk: 'eyJrZXkiOnRydWV9' }], 'only the id and the key; never the PEM');
  assert.deepEqual(w.stream, ['POST /keys', 'GET /v1/downloads', 'POST /v1/downloads', 'GET /v2/downloads', 'POST /v2/downloads']);
  assert.equal(r.choreError, null);
  assert.equal(w.alerts.length, 0);
  // Every 15 minutes, not every minute
  assert.equal(await chores(e, w, NOW + MIN), null);
  // Still waiting (Stream is making them): not asked again the same day, and nothing is ever removed
  w.stream = [];
  await chores(e, w, NOW + ROUND);
  assert.deepEqual(w.stream, []);
  await chores(e, w, NOW + 25 * 3600e3);
  assert.deepEqual(w.stream, ['GET /v1/downloads', 'GET /v2/downloads'], 'a day later, looked at again; Stream has them, so nothing is asked');
  assert.equal(w.keys.length, 1, 'no key asked for: none made');
});

test('a signing key handed over replaces the old one, which goes from Stream; one the backup never got goes too', async () => {
  const w = world({ needs: { streamKey: true, videos: [] } });
  const e = await env(w);
  await chores(e, w, NOW);
  assert.equal(w.held, 'kid1');
  // Stream refused kid1 one night: the backup asks for another, and kid1 is removed once kid2 is in hand
  w.needs.streamKey = true;
  w.stream = [];
  const r = await chores(e, w, NOW + ROUND);
  assert.deepEqual(w.stream, ['POST /keys', 'DELETE /keys/kid1']);
  assert.equal(w.held, 'kid2');
  assert.ok(r.done.includes('removed the Stream signing key kid1, which the backup doesn’t use'));
  // The backup refuses the handoff: the new key is removed in the next round, never left alive
  w.needs.streamKey = true;
  w.refuseKey = true;
  w.stream = [];
  const r2 = await chores(e, w, NOW + 2 * ROUND);
  assert.match(r2.choreError, /busy/);
  assert.deepEqual(w.stream, ['POST /keys']);
  w.refuseKey = false;
  w.needs.streamKey = false;
  w.stream = [];
  await chores(e, w, NOW + 3 * ROUND);
  assert.deepEqual(w.stream, ['DELETE /keys/kid3']);
  assert.equal(w.held, 'kid2', 'and the key the backup holds is never touched');
});

test('a handoff whose answer was lost: the key the backup holds is kept, not removed', async () => {
  const w = world({ needs: { streamKey: true, videos: [] } });
  w.keepButThrow = true;
  const e = await env(w);
  const r = await chores(e, w, NOW);
  assert.match(r.choreError, /answer was lost/);
  w.keepButThrow = false;
  w.stream = [];
  await chores(e, w, NOW + ROUND);
  assert.deepEqual(w.stream, [], 'kid1 is the backup’s: nothing removed');
  assert.deepEqual(w.streamKeysList.map((k) => k.id), ['kid1']);
});

test('a round cut off between asking Stream for a key and writing it down: that key is found and removed', async () => {
  const w = world({ needs: { streamKey: true, videos: [] } });
  const e = await env(w);
  // The round is cut off right after Stream made the key (its id never written down)
  const realFetch = w.fetch;
  w.fetch = async (url, init) => { const res = await realFetch(url, init); if ((init.method || 'GET') === 'POST' && /\/keys$/.test(url)) throw new Error('cut off'); return res; };
  await chores(e, w, NOW);
  w.fetch = realFetch;
  assert.deepEqual(w.streamKeysList.map((k) => k.id), ['kid1'], 'Stream made a key nobody has');
  w.stream = [];
  await chores(e, w, NOW + ROUND);
  assert.ok(w.stream.includes('GET /keys') && w.stream.includes('DELETE /keys/kid1'), w.stream.join(', '));
  assert.equal(w.held, 'kid2', 'and the backup gets one of its own');
  assert.deepEqual(w.streamKeysList.map((k) => k.id), ['kid2']);
});

test('the Stream chores stop at the minute hook’s deadline, and what they did is kept', async () => {
  const w = world({ needs: { streamKey: false, videos: ['v1', 'v2', 'v3'] } });
  const e = await env(w);
  let t = 0;
  const r = await chores(e, w, NOW, { deadline: 1, clock: () => t++ });
  assert.deepEqual(w.stream, ['GET /v1/downloads', 'POST /v1/downloads']);
  assert.deepEqual(Object.keys(r.askedMp4), ['v1']);
  w.stream = [];
  await chores(e, w, NOW + ROUND);
  assert.deepEqual(w.stream, ['GET /v2/downloads', 'POST /v2/downloads', 'GET /v3/downloads', 'POST /v3/downloads'], 'the next round carries on where it stopped');
});

test('alerts: once for trouble, again only for a new kind of trouble, an all-clear when well, and a failed alert is tried again', async () => {
  const w = world();
  const e = await env(w);
  w.status.night.finished = '2026-11-12T08:00:00Z';
  w.status.night.run = '2026-11-12';
  w.alertFails = 1;
  await chores(e, w, NOW);
  assert.equal(w.alerts.length, 0, 'Slack was down: nothing reached anyone');
  await chores(e, w, NOW + ROUND);
  assert.equal(w.alerts.length, 1, 'so it’s sent on the next round');
  assert.equal(w.alerts[0].issue, 'backup');
  assert.match(w.alerts[0].detail, /No backup run has finished since 2026-11-12/);
  await chores(e, w, NOW + 2 * ROUND);
  assert.equal(w.alerts.length, 1, 'no second alert for the same trouble');
  // The same kind with other numbers is not new; a new kind is
  w.status.night.problems = ['3 files couldn’t be copied (the run’s summary lists each one and why)'];
  w.status.night.problemKinds = ['files-failed'];
  await chores(e, w, NOW + 3 * ROUND);
  assert.equal(w.alerts.length, 2);
  assert.equal(w.alerts[1].title, 'The website backup has new trouble');
  assert.match(w.alerts[1].detail.split('\n')[0], /^3 files couldn’t be copied/);
  w.status.night.problems = ['1 file couldn’t be copied (the run’s summary lists each one and why)'];
  await chores(e, w, NOW + 4 * ROUND);
  assert.equal(w.alerts.length, 2, '1 file instead of 3 is the same trouble');
  w.status = fine();
  await chores(e, w, NOW + 5 * ROUND);
  assert.equal(w.alerts.length, 3);
  assert.equal(w.alerts[2].resolves, 'backup');
  assert.match(w.alerts[2].detail, /found nothing wrong/);
  await chores(e, w, NOW + 6 * ROUND);
  assert.equal(w.alerts.length, 3, 'one all-clear');
});

test('a backup that stops answering: one miss is a blip; two in a row is an alert, once it has been reached before; a Stream problem is never mistaken for it', async () => {
  const w = world({ needs: { streamKey: true, videos: [] } });
  w.down = true;
  const e = await env(w);
  const r = await chores(e, w, NOW);
  assert.match(r.error, /not found/);
  await chores(e, w, NOW + ROUND);
  assert.equal(w.alerts.length, 0, 'never reached yet (not deployed): Automations shows it, nobody is alerted');
  w.down = false;
  // Stream refuses (the site's Stream key, or Stream down): the backup is still read and judged on its own
  const realFetch = w.fetch;
  w.fetch = async () => Response.json({ success: false, errors: [{ message: 'Stream not enabled' }] }, { status: 403 });
  const ok = await chores(e, w, NOW + 2 * ROUND);
  w.fetch = realFetch;
  assert.equal(ok.error, null, 'the last error is cleared once it answers');
  assert.match(ok.choreError, /Stream 403/);
  assert.equal(w.alerts.length, 0);
  w.down = true;
  await chores(e, w, NOW + 3 * ROUND);
  assert.equal(w.alerts.length, 0, 'one miss (a redeploy) says nothing');
  await chores(e, w, NOW + 4 * ROUND);
  assert.equal(w.alerts.length, 1);
  assert.match(w.alerts[0].detail, /hasn’t been able to reach the backup for half an hour/);
});

test('what counts as trouble, in words', () => {
  assert.deepEqual(backupProblems({ night: null }, NOW), [], 'nothing to say before the first run');
  assert.deepEqual(backupProblems({ night: null, setUpAt: '2026-11-11T00:00:00Z', firstStarted: '2026-11-12T07:00:00Z', started: { run: '2026-11-14', at: '2026-11-14T07:00:00Z', status: 'running' } }, NOW).map((p) => p.text), ['The backup’s first run, started 2026-11-12, hasn’t finished.'], 'counted from the very first start, not the newest');
  // Before it has been set up once, nothing is trouble: the setup steps say what's left
  const early = fine();
  delete early.setUpAt;
  early.night.problems = ['Backblaze isn’t set up or can’t be reached'];
  early.setup.problems = [{ home: 'b2', why: 'the Backblaze key (B2_KEY_ID, B2_APPLICATION_KEY) isn’t set yet' }];
  assert.deepEqual(backupProblems(early, NOW), []);
  // A setup problem fixed after the run (the sheet printed, a key added) is fixed: the newer check wins
  const fixed = fine();
  fixed.night.problems = ['the recovery sheet hasn’t been printed yet: …'];
  fixed.night.problemKinds = ['setup:key:the recovery sheet hasn’t been printed yet'];
  fixed.setup = { at: '2026-11-14T11:00:00Z', problems: [] };
  assert.deepEqual(backupProblems(fixed, NOW), []);
  const s = fine();
  assert.deepEqual(backupProblems(s, NOW), []);
  s.night.problems = ['the restore drill found problems (1)', '2 copies are still waiting to reach both homes', 'the recovery sheet hasn’t been printed yet: until it is, the only copy of the key that opens every backup is inside Cloudflare'];
  s.night.problemKinds = ['drill', 'waiting-to-ship', 'setup:key:the recovery sheet hasn’t been printed yet'];
  s.setup.problems = [{ home: 'b2', why: 'the Backblaze key can delete: make a key with read and write only' }, { home: 'key', why: 'the recovery sheet hasn’t been printed yet: until it is, the only copy of the key that opens every backup is inside Cloudflare' }];
  const p = backupProblems(s, NOW);
  assert.deepEqual(p.map((x) => x.kind), ['drill', 'waiting-to-ship', 'setup:key:the recovery sheet hasn’t been printed yet', 'setup:b2:the Backblaze key can delete']);
  assert.equal(p[2].text, 'The recovery sheet hasn’t been printed yet: until it is, the only copy of the key that opens every backup is inside Cloudflare.', 'an unprinted sheet is trouble, said once');
  // A run that ended without its summary
  const t = fine();
  t.started = { run: '2026-11-14 0930', at: '2026-11-14T08:30:00Z', status: 'complete' };
  assert.deepEqual(backupProblems(t, NOW).map((x) => x.kind), ['no-summary']);
});

test('before the backup is connected or deployed: no upkeep, and Automations says which', async () => {
  const w = world();
  const e = await env(w);
  w.down = true;
  const facts = await backupFacts(e, { now: NOW });
  assert.deepEqual([facts.connected, facts.reachable], [true, false]);
  assert.match(facts.error, /not found/);
  delete e.BACKUP;
  assert.equal(await chores(e, w, NOW), null);
  assert.deepEqual([(await backupFacts(e)).connected, (await backupFacts(e)).reachable], [false, false]);
});

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test('the admin: actions go to the backup with who asked; the key being opened is told in Slack; anything else is refused', async () => {
  const w = world();
  const e = await env(w);
  e.SLACK_WEBHOOK_URL = 'https://hooks.slack.test/backup';
  const slack = [];
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).startsWith('https://hooks.slack.test/')) { slack.push(JSON.parse(init.body)); return new Response('ok'); }
    throw new Error(`unexpected ${url}`);
  };
  const waits = [];
  const post = async (body, userEmail = 'staffer@example.org') => (await onRequestPost({ env: e, request: new Request('https://x/api/backup-admin', { method: 'POST', body: JSON.stringify(body) }), data: { userEmail }, waitUntil: (p) => waits.push(p) })).json();
  const sheet = await post({ action: 'recovery-sheet' });
  assert.equal(sheet.by, 'staffer@example.org');
  assert.match(sheet.identity, /^AGE-SECRET-KEY-PQ-1/);
  await Promise.all(waits);
  assert.equal(slack.length, 1);
  assert.match(JSON.stringify(slack[0]), /staffer@example\.org opened the recovery sheet/);
  assert.ok(!JSON.stringify(slack[0]).includes('AGE-SECRET-KEY'), 'the note never carries the key');
  assert.equal((await post({ action: 'check' })).ready, true);
  assert.equal((await post({ action: 'run' })).by, 'staffer@example.org');
  assert.equal((await post({ action: 'stream-key' })).success, false, 'only the four admin actions pass');
  assert.equal((await post({ action: 'run' }, '')).success, false, 'never without a signed-in person');
  // (the admin reads it as of now, so the run finished just now)
  w.status.night.finished = new Date().toISOString();
  const facts = await (await onRequestGet({ env: e })).json();
  assert.equal(facts.connected, true);
  assert.deepEqual(facts.problems, []);
  assert.ok(!JSON.stringify(facts).includes('AGE-SECRET-KEY'), 'the key is never in what Automations reads');
});

test('after an outage, trouble already told isn’t told again; reaching it again is said once', async () => {
  const w = world();
  const e = await env(w);
  w.status.night.problems = ['3 files couldn’t be copied (the run’s summary lists each one and why)'];
  w.status.night.problemKinds = ['files-failed'];
  await chores(e, w, NOW);
  assert.equal(w.alerts.length, 1);
  w.down = true;
  await chores(e, w, NOW + ROUND);
  await chores(e, w, NOW + 2 * ROUND);
  assert.equal(w.alerts.length, 2);
  assert.match(w.alerts[1].detail, /can’t|hasn’t been able to reach/);
  w.down = false;
  await chores(e, w, NOW + 3 * ROUND);
  assert.equal(w.alerts.length, 3);
  assert.equal(w.alerts[2].title, 'The site reaches the website backup again');
  assert.match(w.alerts[2].detail, /3 files couldn’t be copied/);
  await chores(e, w, NOW + 4 * ROUND);
  assert.equal(w.alerts.length, 3, 'the files trouble isn’t told a second time');
});

test('an alert cut off before it was sent is sent in the next round, once; a setup half done is alerted a week in', async () => {
  const w = world();
  const e = await env(w);
  w.status.night.problems = ['Backblaze isn’t set up or can’t be reached'];
  w.status.night.problemKinds = ['home:b2'];
  // The round runs out of time while Slack is being posted to
  await chores(e, w, NOW, { alert: async () => { throw new Error('the round ran out of time'); } });
  assert.equal(w.alerts.length, 0);
  await chores(e, w, NOW + ROUND);
  assert.equal(w.alerts.length, 1, 'sent in the next round');
  await chores(e, w, NOW + 2 * ROUND);
  assert.equal(w.alerts.length, 1, 'and only once');

  // Never fully set up (the watchdog step skipped): quiet for the first week, then its trouble is told
  const h = world();
  delete h.status.setUpAt;
  h.status.firstStarted = new Date(NOW - 3 * 86400e3).toISOString();
  h.status.setup.problems = [{ home: 'watchdog', why: 'the watchdog in Google, which checks the backup from outside Cloudflare, isn’t set up yet' }];
  const he = await env(h);
  await chores(he, h, NOW);
  assert.equal(h.alerts.length, 0, 'three days in: still being set up');
  h.status.firstStarted = new Date(NOW - 8 * 86400e3).toISOString();
  await chores(he, h, NOW + ROUND);
  assert.equal(h.alerts.length, 1, 'a week in: told');
  assert.match(h.alerts[0].detail, /watchdog/);
});

test('an MP4 Stream failed to make is cleared and asked for again; a failed key handoff doesn’t stop the MP4s', async () => {
  const w = world({ needs: { streamKey: true, videos: ['v1'] } });
  w.refuseKey = true;
  w.downloads.v1 = { status: 'error' };
  const e = await env(w);
  const r = await chores(e, w, NOW);
  assert.deepEqual(w.stream, ['POST /keys', 'GET /v1/downloads', 'DELETE /v1/downloads', 'POST /v1/downloads'], 'the key whose handoff failed waits for the next round, which reads whether the backup kept it');
  assert.ok(r.done.includes('asked Stream for an MP4 of video v1 again (it failed to make one)'));
  assert.match(r.choreError, /handing the backup a Stream signing key: busy/);
});

test('the site’s own part failing for six hours is trouble of its own; without a Stream key it says so', async () => {
  const w = world({ needs: { streamKey: false, videos: ['v1'] } });
  const e = await env(w);
  delete e.CF_STREAM_TOKEN;
  const r = await chores(e, w, NOW);
  assert.match(r.choreError, /no Stream key \(CF_STREAM_TOKEN\)/);
  for (let i = 1; i <= 24; i++) await chores(e, w, NOW + i * ROUND);
  assert.equal(w.alerts.length, 1);
  assert.match(w.alerts[0].detail, /hasn’t been able to do its part for the backup with Stream/);
});
