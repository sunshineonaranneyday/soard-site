/**
 * Advisory Board QA round 21: the world the round's interleaving proof starts each run from, every kind of write
 * about a member, and the sweep (tests/advisory-round21.test.mjs, and the whole matrix in
 * test-results/qa21-fix/11-unit-sweep.mjs). Made-up people only; Resend, Slack and Google are faked.
 */
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createD1 } from './d1-shim.mjs';
import { holdable } from './interleave.mjs';

export const BY = 'linzi@soardcharity.com';
export const P = { slug: 'pia-swap', name: 'Pia Swap', email: 'pia@example.org' };
export const Q = { slug: 'quin-swap', name: 'Quin Swap', email: 'quin@example.org' };
const MARY = { slug: 'mary-lead', name: 'Mary Lead', email: 'mary@example.org' };
export const TOKEN = 'tok-pia-r21-aaaaaaaaaaaaaaaaaaaa';
export const TOKEN_Q = 'tok-quin-r21-aaaaaaaaaaaaaaaaaaa';
export const ASK = 'ask_rtwentyone';
const { privateKey: SA_PEM } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const GOOGLE_CALENDAR_KEY = JSON.stringify({ type: 'service_account', client_email: 'site@example.iam.gserviceaccount.com', client_id: '1', private_key: SA_PEM, token_uri: 'https://oauth2.googleapis.com/token', project_id: 'p' });
export const hashOf = async (t) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map((b) => b.toString(16).padStart(2, '0')).join('');

// ─── The world each run starts from (one copy made, each run starts from its bytes) ───────────────

export const sent = [];
const google = { events: {} };
const realFetch = globalThis.fetch;
const fakeFetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.host === 'api.resend.com') { const b = JSON.parse(init.body); sent.push(...(Array.isArray(b) ? b : [b])); return Response.json(Array.isArray(b) ? { data: b.map((_, i) => ({ id: `e${i}` })) } : { id: 'e0' }); }
  if (url.host === 'slack.com' || url.host === 'hooks.slack.test') return Response.json({ ok: true, ts: '1.1' });
  if (url.href.startsWith('https://oauth2.googleapis.com/token')) return Response.json({ access_token: 't', expires_in: 3600 });
  if (url.host === 'www.googleapis.com') {
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    const id = decodeURIComponent(url.pathname.split('/events/')[1] || '');
    if (method === 'POST') { const ev = { ...body, hangoutLink: 'https://meet.google.com/abc-defg-hij', status: 'confirmed' }; google.events[ev.id] = ev; return Response.json(ev); }
    if (!google.events[id]) return Response.json({ error: { message: 'Not Found' } }, { status: 404 });
    if (method === 'PATCH') { google.events[id] = { ...google.events[id], ...body }; return Response.json(google.events[id]); }
    return Response.json(google.events[id]);
  }
  return Response.json({ error: 'no route' }, { status: 503 });
};
globalThis.fetch = fakeFetch;
export const restoreFetch = () => { globalThis.fetch = realFetch; };

let BYTES = null;
export let MEETING = '';
let MEETING_COPY = '{}';
export let DOC = null;
export async function world() {
  if (BYTES) return BYTES;
  const DB = await createD1();
  for (const sql of [
    'CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)',
    'CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)',
    'CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)',
    'CREATE TABLE site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)',
  ]) await DB.exec(sql);
  await (await import('../../functions/api/_board.js')).ensureSchema(DB);
  const adv = await import('../../functions/api/_advisory.js');
  await adv.ensureAdvisory(DB);
  for (const [p, group] of [[P, 'advisory'], [Q, 'advisory'], [MARY, 'board']]) {
    await DB.prepare('INSERT INTO team (slug, name, "group", order_num, data) VALUES (?, ?, ?, 0, ?)').bind(p.slug, p.name, group, JSON.stringify({ slug: p.slug, name: p.name, group, status: 'active', publishStatus: 'published', title: group === 'board' ? 'Board Member' : 'Advisory Board Member' })).run();
    await DB.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(p.slug, p.email).run();
  }
  await adv.saveSettings(DB, { lead: MARY.slug, emails: true });
  await DB.prepare('INSERT INTO advisory_asks (id, data, sent_at, at, by) VALUES (?, ?, ?, ?, ?)').bind(ASK, JSON.stringify({ title: 'Host a dinner', body: 'Can you?' }), '2026-11-20T12:00:00.000Z', '2026-11-20T12:00:00.000Z', BY).run();
  /* r25: an ask's emails are claimed on the ask itself, in the write that marks it emailed (Advisory Board QA round 25),
     so the asks these sweeps email are out on the record first, as every ask that's emailed is */
  for (const [id, title] of [['ask_rtwentyoneb', 'Know a plumber?'], ['ask_left', 'Know a painter?']]) await DB.prepare('INSERT INTO advisory_asks (id, data, sent_at, at, by) VALUES (?, ?, ?, ?, ?)').bind(id, JSON.stringify({ title }), '2026-11-20T12:00:00.000Z', '2026-11-20T12:00:00.000Z', BY).run();
  for (const [t, who] of [[TOKEN, P], [TOKEN_Q, Q]]) await DB.prepare('INSERT INTO advisory_links (hash, ask_id, slug, expires) VALUES (?, ?, ?, ?)').bind(await hashOf(t), ASK, who.slug, '2099-01-01T00:00:00.000Z').run();
  // (her term ends in a month: Renew is open)
  await DB.prepare('INSERT INTO advisory_terms (slug, started_on, ends_on) VALUES (?, ?, ?)').bind(P.slug, '2026-01-02', new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)).run();
  DOC = await adv.saveDoc(DB, { kind: 'agreement', title: 'Advisory Board agreement', body: 'The words.' }, { by: BY });
  // A meeting with its invite out (Google faked), both members invited
  const meet = await import('../../functions/api/_advisory-meetings.js');
  const { meeting } = await meet.createAdvisoryMeeting({ DB }, { date: '2099-03-11', by: BY });
  MEETING = meeting.id;
  MEETING_COPY = JSON.stringify(meeting);
  const env = { DB, GOOGLE_CALENDAR_KEY };
  await DB.prepare("INSERT OR REPLACE INTO board_state (key, data, updated_at) VALUES ('settings', ?, ?)").bind(JSON.stringify({ calendar: { organizer: 'jane@soardcharity.com' }, inviteFrom: 'jane@soardcharity.com', admins: ['jane@soardcharity.com'] }), new Date().toISOString()).run();
  await meet.sendAdvisoryInvite(env, MEETING, { fetchImpl: fakeFetch }).catch((e) => { throw new Error(`the invite in the world: ${e.message}`); });
  BYTES = DB._db.export();
  return BYTES;
}
export async function fresh() {
  const raw = await createD1({ bytes: await world() });
  const h = holdable(raw);
  sent.length = 0;
  // (Google's answers as each run starts: Pia accepted, Quin declined)
  for (const ev of Object.values(google.events)) ev.attendees = (ev.attendees || []).map((a) => ({ ...a, responseStatus: a.email === P.email ? 'accepted' : a.email === Q.email ? 'declined' : a.responseStatus }));
  return { h, env: { DB: h.DB, RESEND_API_KEY: 're_test', GOOGLE_CALENDAR_KEY, SLACK_WEBHOOK_URL: 'https://hooks.slack.test/x' }, close: () => raw._db.close() };
}

export const quietly = async (fn) => { const q = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = q; } };
const rename = async (env, from, to) => {
  const { rename: ren } = await import('../../functions/api/rename-content.js');
  const r = await ren(env, { collection: 'team', from, to }, BY, async () => Response.json({ success: true }));
  if (r.status !== 200) throw new Error(`rename ${from} → ${to}: ${r.status} ${r.body.error}`);
  return r;
};
export const RENAMES = {
  plain: async (env) => { await rename(env, P.slug, 'pia-new'); },
  swap: async (env) => { await rename(env, P.slug, 'pia-temp'); await rename(env, Q.slug, P.slug); await rename(env, 'pia-temp', Q.slug); },
};
export const slugOf = async (DB, email) => (await DB.prepare('SELECT slug FROM reveal_board_emails WHERE email = ?').bind(email).first())?.slug;
export const slugs = async (DB, sql, ...binds) => ((await DB.prepare(sql).bind(...binds).all()).results || []).map((r) => r.slug);
export const team = async (DB) => slugs(DB, 'SELECT slug FROM team');

// ─── Each kind of write, and where it must be once both are done ──────────────────

/**
 * The member page's own write, as Pia makes it: through its real API (functions/api/advisory-portal.js), signed in as
 * the middleware finds her as the request begins (advisorFor her email), the write itself later
 */
async function portal(env, body) {
  const { onRequestPost } = await import('../../functions/api/advisory-portal.js');
  const { advisorFor } = await import('../../functions/api/_board-roles.js');
  const advisor = await advisorFor(env.DB, P.email);
  if (!advisor) throw Object.assign(new Error('not on the sign-in list'), { status: 403 });
  const waits = [];
  const res = await onRequestPost({ env, request: new Request('https://site.test/api/advisory-portal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), data: { advisor, userEmail: P.email }, waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  const j = await res.json();
  if (!res.ok) throw Object.assign(new Error(j.error), { status: res.status, moving: !!j.moving });
  return j;
}
export const KINDS = {
  'an “I can help” press in the monthly ask’s email': {
    write: async (env) => (await import('../../functions/api/_advisory-mail.js')).answerFromLink(env.DB, TOKEN, { answer: 'yes', note: 'P pressed' }),
    where: async (DB) => slugs(DB, "SELECT slug FROM advisory_answers WHERE note = 'P pressed'"),
    said: (r) => assert.equal(r.name, P.name, 'the notice names whose record it landed on, Pia, never Quin or nobody'),
  },
  'the monthly ask going out (each member’s link)': {
    write: async (env) => (await import('../../functions/api/_advisory-mail.js')).sendAsk(env, { id: 'ask_rtwentyoneb', title: 'Know a plumber?' }),
    where: async (DB) => {
      const mine = sent.filter((m) => [m.to].flat().includes(P.email)).map((m) => decodeURIComponent(m.html.match(/advisory-action\?t=([^&"]+)/)[1]));
      assert.equal(mine.length, 1, 'Pia’s email went, with one link');
      const out = [];
      for (const t of mine) out.push(...await slugs(DB, 'SELECT slug FROM advisory_links WHERE hash = ?', await hashOf(t)));
      // (and Quin's link is Quin's)
      const theirs = sent.filter((m) => [m.to].flat().includes(Q.email)).map((m) => decodeURIComponent(m.html.match(/advisory-action\?t=([^&"]+)/)[1]));
      for (const t of theirs) assert.deepEqual(await slugs(DB, 'SELECT slug FROM advisory_links WHERE hash = ?', await hashOf(t)), [await slugOf(DB, Q.email)], 'Quin’s link is at Quin’s address');
      return out;
    },
  },
  'an answer on the member page': {
    write: (env) => portal(env, { action: 'answer', askId: ASK, answer: 'yes', note: 'P on the page' }),
    where: async (DB) => slugs(DB, "SELECT slug FROM advisory_answers WHERE note = 'P on the page'"),
  },
  'an introduction': {
    write: (env) => portal(env, { action: 'intro', name: 'Pias Contact' }),
    where: async (DB) => slugs(DB, "SELECT slug FROM advisory_intros WHERE instr(data, 'Pias Contact') > 0"),
  },
  'a request to host a fundraiser': {
    write: (env) => portal(env, { action: 'host', title: 'Pias Dinner' }),
    where: async (DB) => slugs(DB, "SELECT slug FROM advisory_hosted WHERE instr(data, 'Pias Dinner') > 0"),
  },
  'a signature': {
    write: (env) => portal(env, { action: 'sign', docId: DOC.id, name: P.name, version: DOC.version }),
    where: async (DB) => slugs(DB, 'SELECT slug FROM advisory_signatures WHERE doc_id = ?', DOC.id),
  },
  'a renewal': {
    write: (env) => portal(env, { action: 'renew' }),
    where: async (DB) => slugs(DB, 'SELECT slug FROM advisory_terms WHERE renewed_on IS NOT NULL'),
  },
  'the meeting invite’s answers (the heartbeat reading Google)': {
    write: async (env) => (await import('../../functions/api/_advisory-meetings.js')).maybeSyncAdvisoryMeetings(env, { fetchImpl: fakeFetch }),
    where: async (DB) => {
      const m = JSON.parse((await DB.prepare('SELECT data FROM advisory_meetings WHERE id = ?').bind(MEETING).first()).data);
      const replies = m.invite.replies || {};
      const people = await team(DB);
      assert.deepEqual(Object.keys(replies).filter((s) => !people.includes(s)), [], `no answer under an address nobody has: ${JSON.stringify(replies)}`);
      assert.equal(replies[await slugOf(DB, Q.email)], 'declined', 'Quin’s answer is Quin’s');
      return Object.entries(replies).filter(([, a]) => a === 'accepted').map(([s]) => s);
    },
  },
  'a sign-in email marked as sent (the welcome)': {
    write: async (env) => (await import('../../functions/api/_advisory-mail.js')).sendWelcome(env, { by: BY, anyway: true }),
    where: async (DB) => {
      const welcomed = JSON.parse((await DB.prepare("SELECT data FROM board_state WHERE key = 'advisory-mail'").first())?.data || '{}').welcomed || {};
      const people = await team(DB);
      assert.deepEqual(Object.keys(welcomed).filter((s) => !people.includes(s)), [], `no welcome record under an address nobody has: ${JSON.stringify(welcomed)}`);
      assert.equal(welcomed[await slugOf(DB, Q.email)]?.to, Q.email, 'Quin’s welcome record is Quin’s');
      return Object.entries(welcomed).filter(([, v]) => v?.to === P.email && v.at && !v.sending).map(([s]) => s);
    },
  },
};
// A meeting saved from an editor opened before the rename, naming her at the address she had (finding 8, Board QA round
// 9): saved at her address now. (Against a rename only: during a swap the old address is someone else's by then, and an
// address someone has is theirs, as Board's saves have it)
export const SAVES = {
  'a meeting saved naming her old address': {
    renames: ['plain'],
    write: async (env) => {
      const meet = await import('../../functions/api/_advisory-meetings.js');
      const m = JSON.parse(MEETING_COPY);
      const sections = m.sections.map((sec, i) => (i === 0 ? { ...sec, items: [{ ...sec.items[0], title: 'Pias report', who: [P.slug] }] } : sec));
      return meet.saveAdvisoryMeeting(env.DB, { ...m, sections }, { by: BY, base: null });
    },
    where: async (DB) => {
      const m = JSON.parse((await DB.prepare('SELECT data FROM advisory_meetings WHERE id = ?').bind(MEETING).first()).data);
      return m.sections.flatMap((sec) => sec.items).filter((it) => it.title === 'Pias report').flatMap((it) => it.who);
    },
  },
};
// Staff writes keyed by an address (Members, Money): wherever they land, it's someone's address now, or staff are told
export const STAFF = {
  'a term set by staff': {
    write: async (env) => { const a = await import('../../functions/api/_advisory.js'); return a.setTerm(env.DB, P.slug, { ends: '2028-03-01' }, await a.getSettings(env.DB)); },
    where: async (DB) => slugs(DB, "SELECT slug FROM advisory_terms WHERE ends_on = '2028-03-01'"),
  },
  'a gift credited by staff': {
    write: async (env) => { const a = await import('../../functions/api/_advisory.js'); return (await import('../../functions/api/_advisory-money.js')).creditGift(env, await a.getSettings(env.DB), { paymentId: 'pay_rtwentyone', slug: P.slug }); },
    where: async (DB) => slugs(DB, "SELECT slug FROM advisory_credits WHERE payment_id = 'pay_rtwentyone'"),
  },
  'a Zeffy page matched by staff': {
    write: async (env) => { const a = await import('../../functions/api/_advisory.js'); return (await import('../../functions/api/_advisory-money.js')).matchPage(env, await a.getSettings(env.DB), { campaignId: 'camp_rtwentyone', slug: P.slug }); },
    where: async (DB) => { const s = await (await import('../../functions/api/_advisory.js')).getSettings(DB); return s.pages.camp_rtwentyone ? [s.pages.camp_rtwentyone] : []; },
  },
};

/** One run: the write and the rename in this order, then the checks. → a line saying what happened, or throws */
export async function oneRun(kind, how, renameKind, holdOp, k, opts = {}) {
  const { h, env, close } = await fresh();
  try { return await runIn(h, env, kind, how, renameKind, holdOp, k, opts); } finally { close(); }
}
async function runIn(h, env, kind, how, renameKind, holdOp, k, { staff = false } = {}) {
  const write = () => quietly(() => kind.write(env));
  const ren = () => RENAMES[renameKind](env);
  const r = holdOp === 'write' ? await h.heldAt('write', k, write, ren) : await h.heldAt('rename', k, ren, write);
  const [w, rn] = holdOp === 'write' ? [r.first, r.second] : [r.second, r.first];
  if (rn.err) throw new Error(`${how}: the rename failed: ${rn.err.message}`);
  let result = w;
  // (a press, or any write, told a change of address is under way: nothing written; the person tries again, as told)
  if (w.err) {
    const ok = w.err.status === 503 && (w.err.why === 'moving' || w.err.moving) || (staff && [403, 409, 503].includes(w.err.status));
    if (!ok) throw new Error(`${how}: the write failed: ${w.err.status} ${w.err.message}`);
    if (staff && w.err.status !== 503) return { hit: r.hit, refused: true };
    assert.deepEqual(await kind.where(env.DB).catch(() => []), [], `${how}: refused, and nothing written`);
    result = await (async () => { try { return { ok: await write() }; } catch (err) { return { err }; } })();
    if (result.err) throw new Error(`${how}: tried again after: ${result.err.status} ${result.err.message}`);
  }
  const at = await slugOf(env.DB, P.email);
  const where = await kind.where(env.DB);
  if (staff) {
    const people = await team(env.DB);
    assert.ok(where.every((s) => people.includes(s)), `${how}: at ${where.join(', ')}, someone’s address now`);
  } else {
    assert.deepEqual(where, [at], `${how}: at Pia’s address now (${at}), never ${where.filter((s) => s !== at).join(', ') || 'nowhere'}`);
    kind.said?.(result.ok, { at });
  }
  assert.deepEqual(await slugs(env.DB, "SELECT key AS slug FROM board_state WHERE key LIKE 'rename-finish:%'"), [], `${how}: nothing left to finish`);
  if (renameKind === 'plain') assert.equal(await (await import('../../functions/api/_people-address.js')).addressTaken(env.DB, P.slug), null, `${how}: “${P.slug}” free again`);
  return { hit: r.hit, retried: !!w.err };
}

/** Every statement of each, held in turn, both ways round */
export async function sweep(name, kind, renameKind, opts = {}) {
  const { onRun = null, renamePoints = null } = opts;
  const a = await fresh();
  const nw = (await a.h.count('write', () => quietly(() => kind.write(a.env)))).n;
  a.close();
  const b = await fresh();
  const nr = (await b.h.count('rename', () => RENAMES[renameKind](b.env))).n;
  b.close();
  let runs = 0;
  let retried = 0;
  for (let k = 1; k <= nw; k++) { const x = await oneRun(kind, `${name}, held at its statement ${k} of ${nw} while the ${renameKind} rename ran`, renameKind, 'write', k, opts); runs += 1; retried += x.retried ? 1 : 0; onRun?.('write', k, nw, x); }
  for (const k of renamePoints ? renamePoints(nr) : Array.from({ length: nr }, (_, i) => i + 1)) { const x = await oneRun(kind, `the ${renameKind} rename held at its statement ${k} of ${nr} while ${name} ran`, renameKind, 'rename', k, opts); runs += 1; retried += x.retried ? 1 : 0; onRun?.('rename', k, nr, x); }
  return { nw, nr, runs, retried };
}

