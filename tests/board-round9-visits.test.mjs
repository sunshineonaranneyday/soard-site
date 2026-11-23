/**
 * Board QA round 9 (Nov 22 2026), from round 21's Advisory Board fixer: what a member does on the board page (their
 * sign-in, their looks, their reports' time, their visit) was written at the address read when the request began. A
 * People rename between the read and the write moved everything else, and the row landed at the old address, nobody's,
 * holding it for good (People's next person with that name got "-2"); during a swap of two people's addresses it landed
 * on the other person. Now each is written only while that address is theirs (their sign-in email at it on People, no
 * rename moving records off it or onto it): a line missed in a rename's moment, never a record left behind.
 * Made-up people only (the repo is public). Run: node --test tests/board-round9-visits.test.mjs
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';
import { ensureActivitySchema, noteGet, noteLook, noteEvents, noteFamilyOpen } from '../functions/api/_board-activity.js';
import { ensureSchema } from '../functions/api/_board.js';
import { stateReady } from '../functions/api/_board-roles.js';

const PIA = { slug: 'pia-ames', name: 'Pia Ames', email: 'pia.board@example.com' };
const QUIN = { slug: 'quin-rowe', name: 'Quin Rowe', email: 'quin.board@example.org' };
let DB;
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
// (a signed-in request: the Access token's iat is all the tracker reads from it; the middleware checked it already)
const request = (iat = Math.floor(Date.now() / 1000) - 60) => new Request('https://sunshineonaranneyday.com/api/board-portal', { headers: { 'Cf-Access-Jwt-Assertion': `${b64u({ alg: 'RS256' })}.${b64u({ iat })}.sig`, 'User-Agent': 'Mozilla/5.0 (Macintosh) Safari/605.1.15' } });
const person = (p, slug = p.slug) => Promise.all([
  DB.prepare('INSERT OR REPLACE INTO team (slug, name, "group", data) VALUES (?, ?, ?, ?)').bind(slug, p.name, 'board', JSON.stringify({ name: p.name, group: 'board', status: 'active' })).run(),
  DB.prepare('INSERT OR REPLACE INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(slug, p.email).run(),
]);
/** A People rename's own batch, as ./rename-content.js writes it: the record and its email at the new address */
const renamed = async (from, to) => DB.batch([
  DB.prepare('UPDATE team SET slug = ? WHERE slug = ?').bind(to, from),
  DB.prepare('UPDATE reveal_board_emails SET slug = ? WHERE slug = ?').bind(to, from),
]);
const moving = (from, to) => DB.prepare('INSERT OR REPLACE INTO board_state (key, data, updated_at) VALUES (?, ?, ?)').bind(`rename-finish:${from}`, JSON.stringify({ from, to, at: new Date().toISOString() }), new Date().toISOString()).run();
/** Everything the tracker keeps at an address */
async function keptAt(slug) {
  const n = async (t) => Number((await DB.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE slug = ?`).bind(slug).first())?.n || 0);
  return { signins: await n('board_signins'), looks: await n('board_activity'), reports: await n('board_activity_reports'), seen: await n('board_seen') };
}
const NONE = { signins: 0, looks: 0, reports: 0, seen: 0 };
/** Everything a member's page does in a sitting, as `member` read when the request began */
async function aSitting(member) {
  const env = { DB };
  const now = Date.now();
  await noteGet(env, member, request(), { now });
  await noteLook(env, member, request(), 'calendar', 'm_example1', { now });
  await noteFamilyOpen(env, member, request(), 'acctIris01', 'application', 'Iris Example', { now });
  // (a report with time in it keeps their visit going too: ./_board.js keepVisit, board_seen)
  await noteEvents(env, member, request(), { events: [{ id: 'lookhome0001', kind: 'view', ref: 'home', at: now - 120_000, end: now - 60_000, secs: 60, touched: 60 }], now }, { now });
}

beforeEach(async () => {
  DB = await createD1();
  await DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)');
  await DB.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  await ensureSchema(DB);
  await ensureActivitySchema(DB);
  await stateReady(DB);
  await person(PIA);
});

test('a member at their own address: every line of their sitting is kept (control)', async () => {
  await aSitting(PIA);
  const k = await keptAt(PIA.slug);
  assert.ok(k.signins === 1 && k.looks >= 3 && k.reports === 1 && k.seen === 1, JSON.stringify(k));
});

test('read before a rename, written after it: nothing at the old address, which is free for the next person', async () => {
  await renamed('pia-ames', 'pia-ames-rowe');
  await aSitting(PIA);
  assert.deepEqual(await keptAt('pia-ames'), NONE);
});

test('written while the rename is still moving their records: nothing at either address until it finishes', async () => {
  await renamed('pia-ames', 'pia-ames-rowe');
  await moving('pia-ames', 'pia-ames-rowe');
  await aSitting(PIA);
  await aSitting({ ...PIA, slug: 'pia-ames-rowe' });
  assert.deepEqual(await keptAt('pia-ames'), NONE);
  assert.deepEqual(await keptAt('pia-ames-rowe'), NONE);
});

test('during a swap of two addresses: never on the other person', async () => {
  // Pia's request read her at pia-ames; then People swapped them: Quin is at pia-ames now, Pia elsewhere
  await renamed('pia-ames', 'pia-tmp');
  await person(QUIN, 'pia-ames');
  await aSitting(PIA);
  assert.deepEqual(await keptAt('pia-ames'), NONE, 'nothing of Pia’s written under Quin');
  // Quin's own sitting at that address is his
  await aSitting({ ...QUIN, slug: 'pia-ames' });
  assert.equal((await keptAt('pia-ames')).signins, 1);
});
