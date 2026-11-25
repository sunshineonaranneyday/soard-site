/**
 * Past makeovers' photos onto their JobTread jobs (functions/api/_past-photos.js, functions/api/drive-file.js):
 * which files are photos, each photo's stage, the signed link JobTread fetches, listing a project's Drive folder,
 * copying with the stage tag, a lost answer never copied twice, off until a founder turns it on (the first job's
 * photos alone first), and who JobTread would tell.
 * Run: node --test tests/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createD1 } from './lib/d1-shim.mjs';
import { isPhoto, stageFor, signDriveLink, checkDriveLink, maybeRunPastPhotos, setPhotosScope, photosStatus, uploadNotices, ensurePastPhotos, PHOTOS_DRIVE, HOLDING } from '../functions/api/_past-photos.js';
import { checkImport, importRows, ensurePastJobs } from '../functions/api/_past-jobs.js';
import { onRequestGet as driveFile } from '../functions/api/drive-file.js';

const { privateKey: SA_PEM } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const SERVICE_ACCOUNT = JSON.stringify({ type: 'service_account', client_email: 'site@example.iam.gserviceaccount.com', client_id: '1', private_key: SA_PEM, token_uri: 'https://oauth2.googleapis.com/token', project_id: 'p' });
const FOLDER = 'application/vnd.google-apps.folder';

test('photos by type, or by name when Drive calls them plain files', () => {
  assert.equal(isPhoto({ name: 'a.jpg', mimeType: 'image/jpeg' }), true);
  assert.equal(isPhoto({ name: 'IMG_1234.HEIC', mimeType: 'application/octet-stream' }), true, 'an iPhone photo Drive mislabels');
  assert.equal(isPhoto({ name: 'DSC0001.ARW', mimeType: 'application/octet-stream' }), true, 'a camera RAW');
  assert.equal(isPhoto({ name: 'reveal.mov', mimeType: 'video/quicktime' }), false, 'videos wait for the library');
  assert.equal(isPhoto({ name: 'Medical form.pdf', mimeType: 'application/pdf' }), false);
  assert.equal(isPhoto({ name: 'Before', mimeType: FOLDER }), false);
});

test('each photo’s stage: the nearest folder that says, else taken on or after reveal day; never a guess', () => {
  const job = { closeOn: '2014-07-12', closeHow: 'most reveal photos (162 of 162)' };
  assert.deepEqual(stageFor({ path: 'Before Pictures' }, job), { stage: 'Before', how: 'folder “Before Pictures”' });
  assert.equal(stageFor({ path: 'Demo Day/Misc' }, job).stage, 'During', 'a parent folder that says');
  assert.equal(stageFor({ path: 'Reveal/Before and after' }, job).stage, 'Before', 'the nearest folder wins');
  assert.equal(stageFor({ path: 'Professional Reveal' }, job).stage, 'After');
  assert.equal(stageFor({ path: '', takenAt: '2014-07-12T15:03:00-05:00' }, job).stage, 'After', 'reveal day itself');
  assert.equal(stageFor({ path: 'From Old computer', takenAt: '2014-08-01T10:00:00-05:00' }, job).stage, 'After');
  const early = stageFor({ path: 'Misc', takenAt: '2014-05-01T10:00:00-05:00' }, job);
  assert.deepEqual([early.stage, /before reveal day/.test(early.how)], [null, true], 'before reveal day with no folder: no tag');
  assert.equal(stageFor({ path: '', takenAt: '2015-01-01T10:00:00-05:00' }, { closeOn: '2014-12-31', closeHow: 'no reveal date found, so Dec 31 of the year' }).stage, null,
    'a job closed on Dec 31 for want of a date goes by folders only');
  assert.equal(stageFor({}, job).stage, null);
});

test('the link JobTread fetches: signed, six hours, a Drive id only', async () => {
  const env = { GOOGLE_CALENDAR_KEY: SERVICE_ACCOUNT };
  const now = Date.parse('2026-11-25T20:00:00Z');
  const q = await signDriveLink(env, '1AbCdEfGhIjKlMnOp', now);
  assert.equal(await checkDriveLink(env, q, now), true);
  assert.equal(await checkDriveLink(env, q, now + 7 * 3600e3), false, 'expired');
  assert.equal(await checkDriveLink(env, { ...q, d: '1AbCdEfGhIjKlMnOX' }, now), false, 'another file');
  assert.equal(await checkDriveLink({ GOOGLE_CALENDAR_KEY: '' }, q, now), false);
  assert.equal(await signDriveLink({}, 'x'), null);
});

// ── A fake Google (token, Drive) and JobTread ─────────────────────────
function world({ files = {}, failCreateOnce = false, driveIdOf = () => PHOTOS_DRIVE } = {}) {
  const st = { calls: [], jtFiles: [], n: 0, lost: false };
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://oauth2.googleapis.com/token')) return Response.json({ access_token: 'tok', expires_in: 3600 });
    if (u.startsWith('https://www.googleapis.com/drive/v3/files')) {
      const p = new URL(u);
      const id = p.pathname.split('/files/')[1];
      if (id && p.searchParams.get('alt') === 'media') return new Response('JPEGBYTES', { status: 200 });
      if (id) return Response.json({ id, name: 'x.jpg', mimeType: 'image/jpeg', size: '9', driveId: driveIdOf(id), trashed: false });
      const q = p.searchParams.get('q');
      const parent = q.match(/^'([^']+)' in parents/)[1];
      const named = q.match(/name = '([^']+)'/);
      const kids = (files[parent] || []).filter((f) => !named || (f.name === named[1] && f.mimeType === FOLDER));
      return Response.json({ files: kids });
    }
    if (u.includes('jobtread')) {
      const q = JSON.parse(init.body).query; delete q.$;
      const op = Object.keys(q)[0];
      st.calls.push({ op, input: q[op].$ });
      if (op === 'createUploadRequest') return Response.json({ createUploadRequest: { createdUploadRequest: { id: `U${++st.n}` } } });
      if (op === 'createFile') {
        const f = { id: `F${++st.n}`, ...q.createFile.$ };
        st.jtFiles.push(f);
        if (failCreateOnce && !st.lost) { st.lost = true; return new Response('timeout', { status: 504 }); }
        return Response.json({ createFile: { createdFile: { id: f.id } } });
      }
      if (op === 'job') {
        const name = q.job.files.$.where[2];
        return Response.json({ job: { files: { nodes: st.jtFiles.filter((f) => f.targetId === q.job.$.id && f.name === name).map((f) => ({ id: f.id })) } } });
      }
    }
    throw new Error(`no fake answer for ${u}`);
  };
  return { st, fetchImpl, made: (op) => st.calls.filter((c) => c.op === op) };
}

async function site() {
  const DB = await createD1({ schemaFiles: ['scripts/schema.sql'] });
  await ensurePastJobs(DB);
  await ensurePastPhotos(DB);
  await DB.prepare('CREATE TABLE IF NOT EXISTS file_tags (name TEXT PRIMARY KEY, id TEXT NOT NULL, updated_at TEXT NOT NULL)').run();
  for (const [n, id] of [['Before', 'TB'], ['During', 'TD'], ['After', 'TA']]) await DB.prepare('INSERT INTO file_tags VALUES (?, ?, ?)').bind(n, id, 'x').run();
  await importRows(DB, checkImport({ rows: [
    { kind: 'kid', slug: 'mathew', name: 'Mathew', year: 2012, date: '2012-07-14', folder: 'Mathew 2012' },
    { kind: 'kid', slug: 'glass-family', name: 'Glass Family', year: 2012, date: '2012-10-20', folder: 'Glass 2012' },
  ] }).rows);
  // Both made, as _past-jobs.js leaves them
  await DB.prepare("UPDATE past_jobs SET state = 'made', job_id = 'JMATHEW', close_on = '2012-07-14', close_how = 'most photos' WHERE key = 'mathew'").run();
  await DB.prepare("UPDATE past_jobs SET state = 'made', job_id = 'JGLASS', close_on = '2012-10-20', close_how = 'most photos' WHERE key = 'glass-family'").run();
  await DB.prepare("INSERT INTO past_jobs_state (key, value) VALUES ('first', ?)").bind(JSON.stringify({ key: 'mathew', jobId: 'JMATHEW' })).run();
  return { DB, JOBTREAD_GRANT_KEY: 'g', GOOGLE_CALENDAR_KEY: SERVICE_ACCOUNT };
}
const tree = {
  [PHOTOS_DRIVE]: [{ id: 'HOLD', name: HOLDING, mimeType: FOLDER }],
  HOLD: [{ id: 'FMATHEW', name: 'Mathew 2012', mimeType: FOLDER }, { id: 'FGLASS', name: 'Glass 2012', mimeType: FOLDER }],
  FMATHEW: [
    { id: 'FBEFORE', name: 'Before', mimeType: FOLDER },
    { id: 'PHOTOID0003', name: 'IMG_0003.jpg', mimeType: 'image/jpeg', size: '2000', imageMediaMetadata: { time: '2012:07:14 18:00:00' } },
    { id: 'PHOTOID0004', name: 'IMG_0004.HEIC', mimeType: 'application/octet-stream', size: '3000', imageMediaMetadata: { time: '2012:06:01 10:00:00' } },
    { id: 'VIDEOID0001', name: 'reveal.mov', mimeType: 'video/quicktime', size: '9000000' },
    { id: 'PHOTOIDBIG1', name: 'huge.tif', mimeType: 'image/tiff', size: String(150 * 1024 * 1024) },
  ],
  FBEFORE: [{ id: 'PHOTOID0001', name: 'IMG_0001.jpg', mimeType: 'image/jpeg', size: '1000' }],
  FGLASS: [{ id: 'PHOTOIDG001', name: 'g1.jpg', mimeType: 'image/jpeg', size: '1000', imageMediaMetadata: { time: '2012:10:20 12:00:00' } }],
};

test('off until a founder turns it on; the first job’s photos alone first, each with its stage tag', async () => {
  const env = await site();
  const w = world({ files: tree });
  const now = Date.parse('2026-11-25T21:00:00Z');
  assert.equal(await maybeRunPastPhotos(env, { fetchImpl: w.fetchImpl, now }), null, 'off');
  assert.equal((await setPhotosScope(env.DB, 'all')).ok, false, 'not every job before the first job’s photos');
  assert.equal((await setPhotosScope(env.DB, 'first', { by: 'peter@soardcharity.com' })).ok, true);
  // Each turn reads a folder while few photos wait, then copies
  const first = await maybeRunPastPhotos(env, { fetchImpl: w.fetchImpl, now });
  assert.equal(first.listed, 'mathew: 4');
  assert.deepEqual([first.copied, first.failed], [3, 0], 'read and copied in the same turn');
  const rows = (await env.DB.prepare('SELECT drive_id, stage, state FROM past_photos ORDER BY drive_id').all()).results;
  assert.deepEqual(rows.map((r) => [r.drive_id, r.stage, r.state]), [['PHOTOID0001', 'Before', 'copied'], ['PHOTOID0003', 'After', 'copied'], ['PHOTOID0004', null, 'copied'], ['PHOTOIDBIG1', null, 'skipped']]);
  const note = (await env.DB.prepare("SELECT photos_note FROM past_jobs WHERE key = 'mathew'").first()).photos_note;
  assert.match(note, /4 photos; 1 other files/);
  assert.equal(await maybeRunPastPhotos(env, { fetchImpl: w.fetchImpl, now: now + 30e3 }), null, 'one turn a minute');
  const files = w.made('createFile').map((c) => [c.input.name, c.input.targetId, c.input.fileTagIds || null]);
  assert.deepEqual(files, [['IMG_0003.jpg', 'JMATHEW', ['TA']], ['IMG_0004.HEIC', 'JMATHEW', null], ['IMG_0001.jpg', 'JMATHEW', ['TB']]]);
  const link = new URL(w.made('createUploadRequest')[0].input.url);
  assert.equal(link.pathname, '/api/drive-file');
  assert.equal(await checkDriveLink(env, Object.fromEntries(link.searchParams), now), true, 'JobTread gets a signed link');
  // Glass Family waits: only the first job while the scope is 'first'
  assert.equal(await maybeRunPastPhotos(env, { fetchImpl: w.fetchImpl, now: now + 61e3 }).then((r) => r.listed), null);
  assert.equal(w.made('createFile').length, 3);
  // Then every job
  assert.equal((await setPhotosScope(env.DB, 'all')).ok, true);
  const all = await maybeRunPastPhotos(env, { fetchImpl: w.fetchImpl, now: now + 122e3 });
  assert.deepEqual([all.listed, all.copied], ['glass-family: 1', 1]);
  assert.deepEqual(w.made('createFile').at(-1).input.name, 'g1.jpg');
  assert.deepEqual(w.made('createFile').at(-1).input.fileTagIds, ['TA']);
  const st = await photosStatus(env.DB);
  assert.deepEqual(st.by, { copied: 4, skipped: 1 });
  assert.equal(st.jobsToList, 0);
  assert.equal(st.newest.length, 4);
});

test('a lost answer: the next try finds the photo JobTread made and never copies it twice', async () => {
  const env = await site();
  const w = world({ files: { ...tree, FMATHEW: [tree.FMATHEW[1]] }, failCreateOnce: true });
  const now = Date.parse('2026-11-25T21:00:00Z');
  await setPhotosScope(env.DB, 'first');
  const r1 = await maybeRunPastPhotos(env, { fetchImpl: w.fetchImpl, now });
  assert.equal(r1.failed, 1);
  const r2 = await maybeRunPastPhotos(env, { fetchImpl: w.fetchImpl, now: now + 61e3 });
  assert.equal(r2.copied, 1);
  assert.equal(w.made('createFile').length, 1, 'found by its name on the job, not made again');
});

test('/api/drive-file: a signed link streams the file; anything else, or a file outside Photos & Video, is 404', async () => {
  const env = { GOOGLE_CALENDAR_KEY: SERVICE_ACCOUNT };
  const w = world({ driveIdOf: (id) => (id === 'OTHERDRIVEFILE1' ? 'ELSEWHERE' : PHOTOS_DRIVE) });
  const get = async (q) => driveFile({ env, request: new Request(`https://x/api/drive-file?${new URLSearchParams(q)}`), fetchImpl: w.fetchImpl });
  const ok = await get(await signDriveLink(env, 'PHOTOFILE00001'));
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), 'JPEGBYTES');
  assert.equal(ok.headers.get('cache-control'), 'no-store');
  assert.equal((await get({ d: 'PHOTOFILE00001', e: String(Date.now() + 1e6), s: 'bad' })).status, 404);
  assert.equal((await get(await signDriveLink(env, 'OTHERDRIVEFILE1'))).status, 404, 'only Photos & Video');
});

test('who JobTread would tell about each photo', async () => {
  const fetchImpl = async () => Response.json({ organization: {
    roles: { nodes: [{ name: 'Admin', notificationSubscriptions: { nodes: [{ notificationType: 'jobFileCreated', viaEmail: true, viaPushNotification: false, condition: 'participating' }] } },
      { name: 'Designer', notificationSubscriptions: { nodes: [] } }] },
    memberships: { nodes: [{ user: { name: 'Linzi Lawsky' }, useRoleNotificationSubscriptions: false, notificationSubscriptions: { nodes: [{ notificationType: 'jobFileCreated', viaEmail: false, viaPushNotification: true, condition: null }] } },
      { user: { name: 'Holly' }, useRoleNotificationSubscriptions: true, notificationSubscriptions: { nodes: [{ notificationType: 'jobFileCreated', viaEmail: true }] } }] },
  } });
  assert.deepEqual((await uploadNotices('g', fetchImpl)).subscribed, ['Role Admin (email, participating)', 'Linzi Lawsky (push)']);
  assert.match((await uploadNotices('g', async () => new Response('x', { status: 413 }))).error, /413/);
});
