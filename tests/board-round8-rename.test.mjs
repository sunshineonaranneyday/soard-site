/**
 * Board QA round 8 (Nov 21 2026), the privacy tester's two about a rename on People, on the server:
 *   T1  the agenda template's editor open across a rename never writes the member's old address back: the rename's
 *       change to the template is a save of it like any other (its templateAt moves on, templateBy says it was the
 *       rename), so the page's next save meets the 409 and its item-by-item merge, and what's saved, what the meetings on
 *       the template follow and a meeting made from it all name the new address. A meeting's and a practice meeting's
 *       editor open across one the same (a practice meeting's time never moved, so its editor wrote the old address back)
 *   T2  a board member (or an Advisory Board member) signing in at the moment they're renamed is them: the email and the
 *       person at it are read together, never as "not on the list"
 * Made-up people only (the repo is public). Run: node --test tests/board-round8-rename.test.mjs
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';
import { onRequest, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import * as admin from '../functions/api/board-admin.js';
import { ensureSchema, getMeeting, saveMeeting, getSettings, createPractice } from '../functions/api/_board.js';
import { boardMemberFor, advisorFor } from '../functions/api/_board-roles.js';
import { cleanMeeting, mergeMeeting, todayEastern } from '../public/admin/board-shared.js';

const TEAM = 'soard';
const AUD = 'aud-tag';
const ISS = `https://${TEAM}.cloudflareaccess.com`;
const FOUNDER = 'jane@soardcharity.com';
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
const inDays = (n) => new Date(Date.parse(`${todayEastern()}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const PEOPLE = [
  ['jane-doe', { name: 'Jane Doe', group: 'team', title: 'Co-Founder/President' }],
  ['alex-rivera', { name: 'Alex Rivera', group: 'board', title: 'Board Chair' }],
  ['sam-ortiz', { name: 'Sam Ortiz', group: 'board', title: 'Board Treasurer' }],
  ['kim-park', { name: 'Kim Park', group: 'board', title: 'Board Member' }],
  ['ada-example', { name: 'Ada Example', group: 'advisory', title: 'Advisory Board Member' }],
];
const EMAILS = [['alex-rivera', 'alex.board@example.com'], ['sam-ortiz', 'sam.board@example.org'], ['ada-example', 'ada.adv@example.org']];

let env;
const realFetch = globalThis.fetch;
beforeEach(async () => {
  env = { DB: await createD1(), CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD };
  await env.DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)');
  for (const [slug, d] of PEOPLE) await env.DB.prepare('INSERT INTO team (slug, name, "group", data) VALUES (?, ?, ?, ?)').bind(slug, d.name, d.group, JSON.stringify({ slug, status: 'active', ...d })).run();
  for (const [slug, email] of EMAILS) await env.DB.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(slug, email).run();
  await ensureSchema(env.DB);
  _resetKeyCacheForTests();
  globalThis.fetch = async (input) => {
    const url = String(input?.url || input);
    if (url === `${ISS}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
    throw new Error(`unexpected fetch ${url}`);
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

async function api(body, who = FOUNDER) {
  const request = new Request('https://sunshineonaranneyday.com/api/board-admin', {
    method: 'POST', headers: { 'CF-Access-JWT-Assertion': await signIn(who), Origin: 'https://sunshineonaranneyday.com', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const ctx = { request, env, data: {}, waitUntil: () => {} };
  ctx.next = async () => admin.onRequestPost(ctx);
  const res = await onRequest(ctx);
  return { status: res.status, body: await res.json() };
}
/** People's rename, as its route makes it (photo copying never reached: these people have none) */
const rename = async (from, to) => (await import('../functions/api/rename-content.js')).rename(env, { collection: 'team', from, to }, FOUNDER, async () => Response.json({ success: true }));
const itemOf = (sections, title) => sections.flatMap((s) => s.items).find((it) => it.title === title);
/** The template as the editor holds it, as a meeting's parts (public/admin/board-meeting.js asMeeting) */
const asMeeting = (sections) => cleanMeeting({ sections });

// ─── T1 ─────────────────────────────────────────────────────────────

test('T1: a rename moves the agenda template’s time on and says it was the rename, so the editor open from before meets the 409 and merges: the new address stays, the page’s own edit goes in, and the meetings on the template and one made from it name the new address', async () => {
  // Sam presents Financial on the template; a meeting ahead nobody has written an agenda for follows it
  const meeting = (await api({ action: 'new-meeting', date: inDays(40) })).body.meeting;
  let s = await getSettings(env.DB);
  const withSam = s.template.map((sec) => ({ ...sec, items: sec.items.map((it) => (it.title === 'Financial' ? { ...it, who: ['sam-ortiz'], presenter: 'Sam Ortiz' } : it)) }));
  let r = await api({ action: 'save-settings', settings: { template: withSam }, base: s.templateAt });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(itemOf((await getMeeting(env.DB, meeting.id)).sections, 'Financial').who, ['sam-ortiz'], 'the meeting ahead follows the template');

  // The founder's template page, loaded now: what it holds and the time it opened
  const page = (await getSettings(env.DB));
  // People renames Sam
  const ren = await rename('sam-ortiz', 'sam-ortiz-new');
  assert.equal(ren.status, 200, JSON.stringify(ren.body));
  const moved = await getSettings(env.DB);
  assert.deepEqual(itemOf(moved.template, 'Financial').who, ['sam-ortiz-new'], 'the template moved with Sam');

  // The open page saves its own edit (a new name on "Store update"), from the template it opened
  const edited = page.template.map((sec) => ({ ...sec, items: sec.items.map((it) => (it.title === 'Store update' ? { ...it, title: 'Store update and holiday sales' } : it)) }));
  r = await api({ action: 'save-settings', settings: { template: edited }, base: page.templateAt });
  const now = await getSettings(env.DB);
  assert.equal(r.status, 409, `the page’s save from before the rename is refused to merge, never written over it (answered ${r.status}, followed ${r.body.followed}; Financial is now presented by ${JSON.stringify(itemOf(now.template, 'Financial').who)}, the meeting on the template by ${JSON.stringify(itemOf((await getMeeting(env.DB, meeting.id)).sections, 'Financial').who)})`);
  assert.notEqual(moved.templateAt, page.templateAt, 'the rename moved the template’s time on: a save of it like any other');
  assert.equal(moved.templateBy, 'People (renaming Sam Ortiz)', 'saying who made it');
  assert.equal(r.body.current.by, 'People (renaming Sam Ortiz)');
  assert.deepEqual(itemOf(r.body.current.template, 'Financial').who, ['sam-ortiz-new'], 'theirs, to merge, has the new address');
  assert.deepEqual(itemOf((await getSettings(env.DB)).template, 'Financial').who, ['sam-ortiz-new'], 'nothing written by the refused save');

  // The editor's merge (AgendaTemplate's send): item by item, nothing asked (no item changed both ways), then saved
  const { merged, clashes } = mergeMeeting(asMeeting(page.template), asMeeting(edited), asMeeting(r.body.current.template));
  assert.deepEqual(clashes, []);
  r = await api({ action: 'save-settings', settings: { template: merged.sections }, base: r.body.current.at });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  s = await getSettings(env.DB);
  assert.deepEqual(itemOf(s.template, 'Financial').who, ['sam-ortiz-new'], 'the new address kept for the item the page didn’t change');
  assert.ok(itemOf(s.template, 'Store update and holiday sales'), 'and the page’s own edit saved');
  assert.equal(s.templateBy, FOUNDER);

  // Nothing anywhere names the old address: the meeting on the template, and a meeting made from it now
  const followed = await getMeeting(env.DB, meeting.id);
  assert.deepEqual(itemOf(followed.sections, 'Financial').who, ['sam-ortiz-new'], 'the meeting on the template names the new address');
  assert.ok(itemOf(followed.sections, 'Store update and holiday sales'), 'and has the page’s edit');
  const fresh = (await api({ action: 'new-meeting', date: inDays(130) })).body.meeting;
  assert.deepEqual(itemOf(fresh.sections, 'Financial').who, ['sam-ortiz-new'], 'a new meeting from the template names the new address');
  const quoted = JSON.stringify('sam-ortiz');
  const left = (await env.DB.prepare('SELECT COUNT(*) AS n FROM board_meetings WHERE instr(data, ?) > 0').bind(quoted).first()).n;
  assert.equal(left, 0, 'no meeting holds the old address');
  assert.ok(!JSON.stringify((await getSettings(env.DB)).template).includes(quoted), 'nor the template');
});

test('T1: a template with nothing of the renamed member’s keeps its time (an open editor isn’t made to merge for nothing), and one with no name to give says it was a change of web address', async () => {
  const s0 = await getSettings(env.DB);
  const withSam = s0.template.map((sec) => ({ ...sec, items: sec.items.map((it) => (it.title === 'Financial' ? { ...it, who: ['sam-ortiz'], presenter: 'Sam Ortiz' } : it)) }));
  await api({ action: 'save-settings', settings: { template: withSam }, base: s0.templateAt });
  const before = await getSettings(env.DB);
  assert.equal((await rename('kim-park', 'kim-park-2')).status, 200);
  const after = await getSettings(env.DB);
  assert.deepEqual([after.templateAt, after.templateBy], [before.templateAt, before.templateBy], 'Kim presents nothing: the template is as it was');
  // (a rename finished later, its person renamed again meanwhile: no name at the address it moved to)
  const { moveBoardSlug } = await import('../functions/api/_board-rename.js');
  await moveBoardSlug(env.DB, 'sam-ortiz', 'sam-gone');
  const s = await getSettings(env.DB);
  assert.deepEqual(itemOf(s.template, 'Financial').who, ['sam-gone']);
  assert.equal(s.templateBy, 'People (a change of web address)');
  assert.notEqual(s.templateAt, after.templateAt);
});

test('T1 (the same rule elsewhere): a board meeting’s and a practice meeting’s editor open across a rename meet the 409 and merge, never writing the old address back', async () => {
  // A board meeting Sam presents in and has a to-do on, open in an editor
  const blank = (await api({ action: 'new-meeting', date: inDays(30) })).body.meeting;
  const sections = blank.sections.map((sec, i) => (i === 0 ? { ...sec, items: [...sec.items, { id: 'i_samrep', title: 'Treasurer’s report', who: ['sam-ortiz'], presenter: 'Sam Ortiz' }] } : sec));
  let r = await api({ action: 'save-meeting', meeting: { ...blank, sections, actions: [{ id: 'a_sam', owner: 'sam-ortiz', text: 'Send the budget' }] }, base: blank.updatedAt });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const open = r.body.meeting;
  // A practice meeting with Sam presenting, open in the chair's editor
  const p0 = await createPractice(env, { by: FOUNDER });
  const psections = p0.sections.map((sec, i) => (i === 0 ? { ...sec, items: [...sec.items, { id: 'i_pracsam', title: 'Practice report', who: ['sam-ortiz'], presenter: 'Sam Ortiz' }] } : sec));
  const practice = await saveMeeting(env.DB, { ...p0, sections: psections }, { by: FOUNDER, base: p0.updatedAt });
  assert.deepEqual(itemOf(practice.sections, 'Practice report').who, ['sam-ortiz']);

  assert.equal((await rename('sam-ortiz', 'sam-ortiz-new')).status, 200);

  // The board meeting's editor saves an edit from the copy it opened: 409, theirs has the new address
  r = await api({ action: 'save-meeting', meeting: { ...open, title: 'Q1 Board Meeting (moved)' }, base: open.updatedAt });
  assert.equal(r.status, 409, `a board meeting: refused to merge (${r.status})`);
  assert.deepEqual([itemOf(r.body.current.sections, 'Treasurer’s report').who, r.body.current.actions[0].owner], [['sam-ortiz-new'], 'sam-ortiz-new']);

  // The practice meeting's editor the same
  let threw = null;
  try { await saveMeeting(env.DB, { ...practice, title: 'Practice (edited)' }, { by: FOUNDER, base: practice.updatedAt }); } catch (e) { threw = e; }
  const stored = JSON.parse((await env.DB.prepare('SELECT data FROM board_practice WHERE id = ?').bind(practice.id).first()).data);
  assert.equal(threw?.status, 409, `a practice meeting: refused to merge, never written over the rename (saved: ${!threw}; it now names ${JSON.stringify(itemOf(stored.sections, 'Practice report')?.who)})`);
  assert.deepEqual(itemOf(threw.current.sections, 'Practice report').who, ['sam-ortiz-new'], 'theirs has the new address');
  assert.deepEqual(itemOf(stored.sections, 'Practice report').who, ['sam-ortiz-new'], 'and the practice meeting keeps it');
  /* r9: the rename's own rewrite names it, as the template's does (Board QA round 9 admin, item 5) */
  assert.equal(threw.current.updatedBy, 'People (renaming Sam Ortiz)');
  // Merged as the editor merges, and saved: the new address and the edit both
  const { merged } = mergeMeeting(cleanMeeting(practice), cleanMeeting({ ...practice, title: 'Practice (edited)' }), cleanMeeting(threw.current));
  const after = await saveMeeting(env.DB, { ...threw.current, ...merged }, { by: FOUNDER, base: threw.current.updatedAt });
  assert.deepEqual([after.title, itemOf(after.sections, 'Practice report').who], ['Practice (edited)', ['sam-ortiz-new']]);
});

// ─── T2 ─────────────────────────────────────────────────────────────

/**
 * People renames `from` to `to` (the record and its private email in one write, as ./rename-content.js does) the moment
 * the first read of People or the private emails has been made, before the next one: the tester's race, every time
 */
function renameBetweenReads(from, to) {
  const real = env.DB.prepare;
  let done = false;
  const now = () => {
    if (done) return;
    done = true;
    const db = env.DB._db;
    db.run('BEGIN');
    db.run('UPDATE team SET slug = ?, data = json_set(data, \'$.slug\', ?) WHERE slug = ?', [to, to, from]);
    db.run('UPDATE reveal_board_emails SET slug = ? WHERE slug = ?', [to, from]);
    db.run('COMMIT');
  };
  const wrap = (st, sql) => ({
    ...st,
    bind: (...p) => wrap(st.bind(...p), sql),
    // (the read is made when it's called; the rename lands straight after it, before anything else reads)
    all: () => { const r = st.all(); if (/\b(team|reveal_board_emails)\b/.test(sql)) now(); return r; },
    first: (c) => { const r = st.first(c); if (/\b(team|reveal_board_emails)\b/.test(sql)) now(); return r; },
  });
  env.DB.prepare = (sql) => wrap(real(sql), sql);
  return () => { env.DB.prepare = real; };
}

test('T2: a board member signing in the moment People renames them is them, never "not on the board list": their email and the person at it are one read', async () => {
  const undo = renameBetweenReads('alex-rivera', 'alex-rivera-r1');
  const member = await boardMemberFor(env.DB, 'alex.board@example.com');
  undo();
  assert.ok(member, 'a board member, renamed as they signed in, is still a board member');
  assert.equal(member.name, 'Alex Rivera');
  assert.ok(['alex-rivera', 'alex-rivera-r1'].includes(member.slug), member.slug);
  // ...and the board page answers them: through the sign-in check, as many times as it's renamed
  for (let i = 1; i <= 6; i++) {
    const back = renameBetweenReads(`alex-rivera-r${i}`, `alex-rivera-r${i + 1}`);
    const request = new Request('https://sunshineonaranneyday.com/api/board-portal', { headers: { 'CF-Access-JWT-Assertion': await signIn('alex.board@example.com'), Origin: 'https://sunshineonaranneyday.com' } });
    const ctx = { request, env, data: {}, waitUntil: () => {} };
    let reached = null;
    ctx.next = async () => { reached = ctx.data.boardMember; return Response.json({ ok: true }); };
    const res = await onRequest(ctx);
    back();
    assert.equal(res.status, 200, `load ${i}: ${res.status} ${await res.text()}`);
    assert.equal(reached?.name, 'Alex Rivera');
  }
  // (still nobody for an address that's nobody's, and two board members on one address are neither)
  assert.equal(await boardMemberFor(env.DB, 'someone@example.com'), null);
  await env.DB.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind('kim-park', 'alex.board@example.com').run();
  assert.equal(await boardMemberFor(env.DB, 'ALEX.board@example.com '), null);
});

test('T2: an Advisory Board member signing in the moment People renames them is them too (the same one read)', async () => {
  const undo = renameBetweenReads('ada-example', 'ada-example-2');
  const advisor = await advisorFor(env.DB, 'Ada.Adv@example.org');
  undo();
  assert.ok(advisor, 'an Advisory Board member, renamed as they signed in, is still one');
  assert.equal(advisor.name, 'Ada Example');
  assert.equal(await advisorFor(env.DB, 'alex.board@example.com'), null, 'a board member is not an Advisory Board member');
});
