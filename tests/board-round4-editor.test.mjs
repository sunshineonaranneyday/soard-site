/**
 * Board admin, QA round 4 (Nov 21 2026), the meeting editor's and the agenda template's server rules: a save is judged by
 * what it changes against the copy the tab started from (a stale tab's unchanged "shared" is the saved-meanwhile 409 it
 * merges, never a refusal; a refusal carries the meeting as the site has it); sharing a "not a board meeting" waits for
 * its approval by the one rule Board offers Share by; the agenda template keeps everything its editor sets, a part or
 * item not named yet too, and a meeting made from it leaves the unnamed ones out. Made-up people only.
 * Run: node --test tests/board-round4-editor.test.mjs
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';
import { agendaApproved } from './lib/agenda-approved.mjs';
import { onRequest, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import * as admin from '../functions/api/board-admin.js';
import * as board from '../functions/api/_board.js';
import * as shared from '../public/admin/board-shared.js';

const { getMeeting, patchMeeting, ensureSchema, getSettings } = board;
const { todayEastern } = shared;

const TEAM = 'soard';
const AUD = 'aud-tag';
const ISS = `https://${TEAM}.cloudflareaccess.com`;
const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
async function signIn(email) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ iss: ISS, aud: [AUD], email, iat: now, nbf: now, exp: now + 3600 }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64u(new Uint8Array(sig))}`;
}

const FOUNDER = 'jane@soardcharity.com';
const OTHER = 'holly@soardcharity.com';
const PEOPLE = [
  ['jane-doe', { name: 'Jane Doe', group: 'team', title: 'Co-Founder/President' }],
  ['holly-doe', { name: 'Holly Doe', group: 'team', title: 'Co-Founder' }],
  ['alex-rivera', { name: 'Alex Rivera', group: 'board', title: 'Board Chair' }],
  ['sam-ortiz', { name: 'Sam Ortiz', group: 'board', title: 'Board Treasurer' }],
  ['taylor-nguyen', { name: 'Taylor Nguyen', group: 'board', title: 'Board Secretary' }],
];
const inDays = (n) => new Date(Date.parse(`${todayEastern()}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

let env;
const realFetch = globalThis.fetch;
beforeEach(async () => {
  env = { DB: await createD1(), CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD, RESEND_API_KEY: 're_test' };
  await env.DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)');
  for (const [slug, d] of PEOPLE) await env.DB.prepare('INSERT INTO team (slug, name, "group", data) VALUES (?, ?, ?, ?)').bind(slug, d.name, d.group, JSON.stringify(d)).run();
  await ensureSchema(env.DB);
  _resetKeyCacheForTests();
  globalThis.fetch = async (input) => {
    const url = String(input?.url || input);
    if (url === `${ISS}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
    throw new Error(`unexpected fetch ${url}`);
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

async function call(email, path, { method = 'GET', body = null, handler }) {
  const headers = { 'CF-Access-JWT-Assertion': await signIn(email), Origin: 'https://sunshineonaranneyday.com' };
  if (body) headers['Content-Type'] = 'application/json';
  const request = new Request(`https://sunshineonaranneyday.com${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const ctx = { request, env, data: {}, waitUntil: () => {} };
  ctx.next = async () => handler(ctx);
  const res = await onRequest(ctx);
  return { status: res.status, body: (res.headers.get('Content-Type') || '').includes('json') ? await res.json() : await res.text() };
}
const adminApi = (body, email = FOUNDER) => call(email, '/api/board-admin', { method: 'POST', body, handler: admin.onRequestPost });
/** A meeting made in Board, `days` ahead (from the template) */
const meeting = async (days) => (await adminApi({ action: 'new-meeting', date: inDays(days) })).body.meeting;
const save = (m, base, email = FOUNDER) => adminApi({ action: 'save-meeting', meeting: m, base }, email);

// ─── A-B1 (blocker): a stale tab's unchanged "shared" ───────────────

test('a tab opened before another tab took the meeting off the board page is told to merge (409 with theirs), never refused, and its merged save goes', async () => {
  // The next meeting, on the board page, its agenda not approved (as the QA seed's): both tabs open it
  const made = await meeting(9);
  const opened = await patchMeeting(env.DB, made.id, (cur) => ({ ...cur, shared: true }));
  // Tab B: Take it off
  const off = await save({ ...opened, shared: false }, opened.updatedAt, OTHER);
  assert.equal(off.status, 200, JSON.stringify(off.body));
  assert.equal(off.body.meeting.shared, false);
  // Tab A, opened before, types in item 1.1: its copy still says shared, as it was when it opened
  const typed = structuredClone(opened);
  typed.sections[0].items[0].title += ' (A)';
  const a = await save(typed, opened.updatedAt);
  assert.equal(a.status, 409, JSON.stringify(a.body));
  assert.equal(a.body.refused, undefined, `never refused for a field the tab didn't change (${a.body.error})`);
  assert.equal(a.body.current?.shared, false, 'theirs comes back to merge: off the board page');
  // Merged (B's shared, A's words) on B's time: it goes, and the site has both
  const merged = { ...a.body.current, sections: typed.sections };
  const again = await save(merged, a.body.current.updatedAt);
  assert.equal(again.status, 200, JSON.stringify(again.body));
  const now = await getMeeting(env.DB, made.id);
  assert.equal(now.shared, false);
  assert.match(now.sections[0].items[0].title, / \(A\)$/);
});

test('the same through a server-side unshare: a copy that only still says shared merges, and the board never sees it', async () => {
  const made = await meeting(9);
  const opened = await patchMeeting(env.DB, made.id, (cur) => ({ ...cur, shared: true }));
  // (taken off by the site itself, as server code does)
  await patchMeeting(env.DB, made.id, (cur) => ({ ...cur, shared: false }));
  const typed = structuredClone(opened);
  typed.title = 'Typed in the stale tab';
  const a = await save(typed, opened.updatedAt);
  assert.equal(a.status, 409);
  assert.equal(a.body.refused, undefined, `a merge, not a refusal (${a.body.error})`);
  assert.equal(a.body.current?.shared, false);
  assert.equal((await getMeeting(env.DB, made.id)).shared, false, 'nothing written');
});

test('a save that turns shared on before the approval is refused by name, with the meeting as the site has it now', async () => {
  const m = await meeting(9);
  const r = await save({ ...m, shared: true, title: 'Typed with it' }, m.updatedAt);
  assert.equal(r.status, 409);
  assert.deepEqual(r.body.refused, ['shared']);
  assert.equal(r.body.current, undefined, 'a refusal, not someone else’s save to merge');
  assert.equal(r.body.meeting?.id, m.id, 'the refusal carries the meeting as it is now');
  assert.equal(r.body.meeting.shared, false, 'off the board page, as the site has it');
  assert.equal(r.body.meeting.updatedAt, m.updatedAt);
  // Minutes marked approved that aren't in Board: the same, with the meeting as it is
  const held = await meeting(-3);
  const ap = await save({ ...held, minutes: 'approved', approvedOn: inDays(0) }, held.updatedAt);
  assert.equal(ap.status, 409);
  assert.deepEqual(ap.body.refused, ['minutes', 'approvedOn']);
  assert.equal(ap.body.meeting?.minutes, 'draft');
});

// ─── A-m1: "not a board meeting" on its day ─────────────────────────

test('sharing a meeting that isn’t a board meeting waits for its approval, by one rule for Board’s Share and the site', async () => {
  const today = todayEastern();
  const cases = [
    [{ date: inDays(0), notBoard: true }, true, 'not a board meeting, on its day'],
    [{ date: inDays(5), notBoard: true }, true, 'not a board meeting, ahead'],
    [{ date: inDays(0) }, true, 'a board meeting on its day'],
    [{ date: inDays(-1), notBoard: true }, false, 'its day gone'],
    [{ date: inDays(0), notBoard: true, live: { endedAt: new Date().toISOString() } }, false, 'ended in Board'],
    [{ date: inDays(0), practice: true }, false, 'a practice'],
  ];
  for (const [m, waits, why] of cases) assert.equal(shared.shareWaits(m, today), waits, why);
  // The site agrees: Share on a "not a board meeting" today is refused before the approval, and goes after it
  const m = await meeting(0);
  const tagged = await patchMeeting(env.DB, m.id, (cur) => ({ ...cur, notBoard: true, shared: false }));
  assert.equal(shared.shareWaits(tagged, today), true, 'Board doesn’t offer Share for it');
  const r = await save({ ...tagged, shared: true }, tagged.updatedAt);
  assert.equal(r.status, 409);
  assert.deepEqual(r.body.refused, ['shared']);
  assert.equal(r.body.error, 'The agenda goes to the board once it’s approved');
  await agendaApproved(env.DB, m.id);
  const ok = await save({ ...tagged, shared: true }, tagged.updatedAt);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.meeting.shared, true);
  assert.equal(ok.body.meeting.notBoard, false, 'shared, it’s a board meeting');
});

// ─── A-M1: the agenda template keeps what its editor sets ───────────

test('the agenda template keeps every live list on an item and a part or item not named yet; a meeting made from it leaves the unnamed out', async () => {
  const opened = await getSettings(env.DB);
  const t = structuredClone(opened.template);
  const fin = t.flatMap((s) => s.items).find((it) => it.title === 'Financial');
  assert.equal(fin.live, 'cash');
  // (a) Financial shows The money, and now Upcoming reveals too
  fin.also = ['reveals'];
  // (b) + Add a part, an item typed in it before the part has a name; and an item with only who presents it
  t.push({ id: 's_newpart1', title: '', items: [{ id: 'i_newitem1', title: 'Vote on the 2027 calendar' }] });
  t[0].items.push({ id: 'i_noname01', title: '', presenter: 'Sam Ortiz', who: ['sam-ortiz'] });
  const r = await adminApi({ action: 'save-settings', settings: { template: t }, base: opened.templateAt });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const check = (tpl, when) => {
    const f = tpl.flatMap((s) => s.items).find((it) => it.title === 'Financial');
    assert.deepEqual([f.live, f.also], ['cash', ['reveals']], `${when}: Financial shows The money and the reveals`);
    const part = tpl.find((s) => s.id === 's_newpart1');
    assert.ok(part && part.title === '' && part.items[0].title === 'Vote on the 2027 calendar', `${when}: the unnamed part and its item are kept`);
    const blank = tpl[0].items.find((it) => it.id === 'i_noname01');
    assert.ok(blank && blank.title === '' && blank.presenter === 'Sam Ortiz' && blank.who[0] === 'sam-ortiz', `${when}: an item not named yet keeps who presents it`);
  };
  check(r.body.settings.template, 'the save’s answer');
  // The editor knows it's saved by what the site answered: the same as what it sent
  assert.equal(JSON.stringify(shared.cleanTemplate(r.body.settings.template)), JSON.stringify(shared.cleanTemplate(t)), 'nothing sent was dropped');
  check((await getSettings(env.DB)).template, 'opened again');
  // A meeting made from it: the named parts and items only, and every live list an item shows
  const m = await meeting(30);
  const titles = m.sections.map((s) => s.title);
  assert.ok(!titles.includes(''), `no unnamed part on the meeting (${titles.join(' | ')})`);
  assert.ok(!m.sections.some((s) => s.items.some((it) => it.title === 'Vote on the 2027 calendar')), 'nor the item in it');
  assert.ok(!m.sections.some((s) => s.items.some((it) => !it.title && !it.live)), 'nor an unnamed item');
  const mf = m.sections.flatMap((s) => s.items).find((it) => it.title === 'Financial');
  assert.deepEqual([mf.live, mf.also], ['cash', ['reveals']], 'its Financial shows both');
});

test('a template with only unnamed parts still gives a meeting the usual agenda, as an empty one did', () => {
  const titles = (sections) => sections.map((s) => `${s.title}: ${s.items.map((it) => it.title).join(' | ')}`);
  assert.deepEqual(titles(shared.templateAgenda(null, { template: [{ title: '', items: [{ title: 'Half typed' }] }] })), titles(shared.templateAgenda(null, { template: [] })));
});
