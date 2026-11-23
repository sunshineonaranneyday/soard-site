/**
 * The emails a press owes someone, kept until they've gone
 * ===========================================================================
 * Three of the board's emails go once, after a person's press, and had no record of their own: a member told their
 * signature was taken off (Board → Who's signed: Take it off, or a signed copy SOARD put in its place), the secretary
 * and the founders told a correction to the minutes was suggested, and whoever suggested one told what was decided.
 * A read of People that failed, or a send Resend didn't take, lost them for good (Board QA round 10, Nov 22 2026).
 *
 * Now each is written down as due before anything is asked of People or Resend (board_state 'notice-due:<id>', one row
 * per notice, holding what it needs to send itself later), and comes off in the step that sends it. A read of People
 * that fails, or a send that doesn't go, leaves it due, and the signing look (./_board-sign.js maybeRunSigning) sends it
 * on its next clean look. The press itself always stands: the person is told the email follows, never that it went.
 * Never twice: one send of a notice at a time holds it (a claim, let go of after two minutes should a send never
 * finish), each email carries its own idempotency key, and a signature's notice already in the chain isn't sent again.
 */

import { activeBoard, boardAdmins, readState, normEmail } from './_board-roles.js';
import { sendEmailOne, emailConfigured, EMAIL_FROM, isEmail } from './_broadcast-notify.js';

const PREFIX = 'notice-due:';
const HOLD_MS = 2 * 60 * 1000;
// A send that didn't go is tried again no sooner than this, longer each time, never more than 6 hours apart
const BACKOFF_MS = 5 * 60 * 1000;
const MAX_WAIT_MS = 6 * 60 * 60 * 1000;
const iso = (t = Date.now()) => new Date(t).toISOString();
const changed = (r) => (r?.meta?.changes ?? r?.changes ?? 0) > 0;
const fromBoard = () => EMAIL_FROM.replace(/^[^<]*/, 'SOARD Board ');
const parse = (s) => { try { return JSON.parse(s || 'null'); } catch { return null; } };

/** What the person pressing is told when the email waits for People: "The email to Alex goes as soon as …" */
export const laterWords = (who) => `The email to ${String(who || '').trim() || 'them'} goes as soon as the site can check People.`;
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

/** The reads a notice is sent with, both for certain (./_board-roles.js): who is on the board, and who runs Board */
export async function noticeReads(DB) {
  const [board, admins] = await Promise.all([activeBoard(DB), boardAdmins(DB)]);
  return { board, admins };
}

/**
 * A notice a press owes, written down as due, then sent if People can be read now (the send itself after the answer,
 * with `waitUntil`). → {} or { later: the words the person is told } when it waits for People. Nothing when email
 * isn't set up (as before: there's nothing to send it with)
 */
export async function oweNotice(env, id, notice, { waitUntil = null, who = '', now = Date.now() } = {}) {
  if (!emailConfigured(env)) return {};
  await readState(env.DB, `${PREFIX}${id}`); // (makes board_state)
  await env.DB.prepare('INSERT INTO board_state (key, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING')
    .bind(`${PREFIX}${id}`, JSON.stringify({ ...notice, id, queuedAt: iso(now), tries: 0 }), iso(now)).run();
  let reads;
  try { reads = await noticeReads(env.DB); } catch (err) {
    if (!err?.unread) throw err;
    return { later: laterWords(who) };
  }
  const going = deliver(env, id, reads, { now }).catch((err) => console.error('[board-notices]', id, err?.message || err));
  if (waitUntil) waitUntil(going); else await going;
  return {};
}

/** The notices due, oldest first: [{ id, ...notice }] */
export async function dueNotices(DB) {
  const rows = (await DB.prepare("SELECT key, data FROM board_state WHERE key LIKE 'notice-due:%' ORDER BY updated_at").all().catch((e) => {
    if (/no such table/i.test(e?.message || '')) return { results: [] };
    throw e;
  })).results || [];
  return rows.map((r) => ({ ...(parse(r.data) || {}), id: r.key.slice(PREFIX.length) }));
}

/**
 * The signing look: every notice due, sent with the board and who runs Board as the look read them (for certain). One
 * resting after a send that didn't go waits its turn. → how many went. A read of People that fails inside throws
 * (readDown), for the look to say so; the notice stays due
 */
export async function sendDueNotices(env, reads, { now = Date.now(), limit = 10 } = {}) {
  let sent = 0;
  for (const n of (await dueNotices(env.DB)).slice(0, limit)) {
    const wait = n.tries ? Math.min(MAX_WAIT_MS, BACKOFF_MS * 2 ** (n.tries - 1)) : 0;
    if (n.triedAt && now - Date.parse(n.triedAt) < wait) continue;
    const r = await deliver(env, n.id, reads, { now });
    if (r.sent) sent += 1;
  }
  return sent;
}

/**
 * One notice sent and taken off the list in the same step, held while it goes so a second look (the heartbeat and the
 * press's own send together) never sends it too. → { sent } | { none } (nothing owed any more: they left the board,
 * the meeting or the paper is gone) | { failed } (kept, to try again) | { busy }
 */
async function deliver(env, id, reads, { now = Date.now() } = {}) {
  const { DB } = env;
  const key = `${PREFIX}${id}`;
  const claim = await DB.prepare("UPDATE board_state SET data = json_set(data, '$.sending', ?), updated_at = updated_at WHERE key = ? AND json_valid(data) AND (json_extract(data, '$.sending') IS NULL OR json_extract(data, '$.sending') < ?)")
    .bind(iso(now), key, iso(now - HOLD_MS)).run();
  if (!changed(claim)) return { busy: true };
  const n = parse((await DB.prepare('SELECT data FROM board_state WHERE key = ?').bind(key).first())?.data);
  if (!n) return { none: true };
  const keep = (sent, why) => DB.prepare('UPDATE board_state SET data = ? WHERE key = ?')
    .bind(JSON.stringify({ ...n, sending: undefined, sent, tries: (Number(n.tries) || 0) + 1, triedAt: iso(now), error: String(why || '').slice(0, 300) }), key).run();
  try {
    // (a signature's notice the chain already has went: off the list, never again)
    if (n.kind === 'void' && await voidInChain(DB, n)) { await DB.prepare('DELETE FROM board_state WHERE key = ?').bind(key).run(); return { none: true }; }
    const mails = await mailsFor(env, n, reads);
    const had = new Set(n.sent || []);
    let failed = 0;
    let why = '';
    for (const m of mails) {
      if (had.has(m.to)) continue;
      const r = await sendEmailOne(env, m);
      if (r.sent || r.already) had.add(m.to);
      else { failed += 1; why = r.errors?.[0] || 'the email didn’t go'; }
    }
    if (failed) { await keep([...had], why); return { failed }; }
    if (n.kind === 'void' && mails.length) {
      const { appendEvents } = await import('./_board-sign.js');
      await appendEvents(DB, async () => ({ events: [{ kind: 'void-sent', docId: n.docId, slug: n.slug, year: n.year, by: n.by || 'SOARD board page', detail: { to: mails[0].to, for: n.at, ...(n.replacedByCopy ? { replacedByCopy: true } : {}) } }] }));
    }
    await DB.prepare('DELETE FROM board_state WHERE key = ?').bind(key).run();
    return mails.length ? { sent: true } : { none: true };
  } catch (err) {
    await keep(n.sent || [], err?.message).catch(() => {});
    throw err;
  }
}

/** Whether the chain says this signature's notice went (a void-sent for the same paper, member, year and signature) */
async function voidInChain(DB, n) {
  const rows = (await DB.prepare("SELECT detail FROM board_sign_events WHERE kind = 'void-sent' AND doc_id = ? AND slug = ? AND year = ?").bind(n.docId, n.slug, n.year).all().catch(() => ({ results: [] }))).results || [];
  return rows.some((r) => parse(r.detail)?.for === n.at);
}

/** Each email a notice is, as it reads now: [{ to, subject, html, text, … }] ([] when nothing is owed any more) */
async function mailsFor(env, n, { board, admins }) {
  const { DB } = env;
  if (n.kind === 'void') {
    const to = normEmail(n.to || board.find((p) => p.slug === n.slug)?.email);
    const { listDocs } = await import('./_board.js');
    const doc = (await listDocs(DB)).find((d) => d.id === n.docId);
    if (!isEmail(to) || !doc) return [];
    const { voidEmail } = await import('./_board-sign.js');
    return [{ to, from: fromBoard(), replyTo: admins, tags: [{ name: 'kind', value: 'board-void' }], idempotencyKey: `void:${n.docId}:${n.slug}:${n.year}:${n.at}`, ...voidEmail({ doc, year: n.year, reason: n.reason || '', replacedByCopy: !!n.replacedByCopy }) }];
  }
  const { getMeeting } = await import('./_board.js');
  const m = await getMeeting(DB, n.meetingId);
  if (!m) return [];
  const words = await import('./_board-corrections.js');
  if (n.kind === 'correction') {
    // To the secretary and whoever runs Board, never back to whoever suggested it
    const secretary = board.find((p) => p.seat === 'secretary');
    const by = normEmail(n.by?.email);
    const to = [...new Set([secretary?.email, ...admins].filter(Boolean).map(normEmail))].filter((e) => e !== by && isEmail(e));
    const mail = words.correctionEmail(m, { by: n.by?.name || '', where: n.where || '' });
    return to.map((address) => ({ to: address, from: fromBoard(), ...mail, replyTo: n.by?.email || admins, tags: [{ name: 'kind', value: 'board-correction' }], idempotencyKey: `correction:${n.cid}:${address}` }));
  }
  if (n.kind === 'correction-decided') {
    const to = normEmail(n.toEmail || board.find((p) => p.slug === n.toSlug)?.email);
    if (!isEmail(to)) return [];
    return [{ to, from: fromBoard(), ...words.correctionDecidedEmail(m, { made: !!n.made, by: n.byName || '' }), replyTo: admins, tags: [{ name: 'kind', value: 'board-correction-decided' }], idempotencyKey: `correction-decided:${n.cid}` }];
  }
  return [];
}

export { firstName as noticeName };
