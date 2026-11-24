/**
 * The emails a press owes someone, kept until they've gone
 * ===========================================================================
 * Three of the board's emails go once, after a person's press, and had no record of their own: a member told their
 * signature was taken off (Board → Who's signed: Take it off, or a signed copy SOARD put in its place), the secretary
 * and the founders told a correction to the minutes was suggested, and whoever suggested one told what was decided.
 * A read of People that failed, or a send Resend didn't take, lost them for good (Board QA round 10, Nov 22 2026). A
 * fourth since: who runs Board told a member can't sign a paper as written (Decline), which went after the answer with
 * nothing to try again (Board QA round 13, Nov 24 2026).
 *
 * Now each is written down as due before anything is asked of People or Resend (board_state 'notice-due:<id>', one row
 * per notice, holding what it needs to send itself later), in the same write as the press's own work (dueStmt: the
 * correction, the decline, the signature taken off or replaced), and comes off in the step that sends it. A read of People
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
 * isn't set up (as before: there's nothing to send it with). Only for a press whose own work is already written: a press
 * that writes something with its notice writes the notice in that same write (dueStmt) and then sends it (sendNotice),
 * never in a step after it (Board QA round 13, Nov 24 2026: a correction kept, its notice's write failing, and the
 * secretary and the founders never told)
 */
export async function oweNotice(env, id, notice, opts = {}) {
  if (!emailConfigured(env)) return {};
  await readState(env.DB, `${PREFIX}${id}`); // (makes board_state)
  await dueStmt(env.DB, id, notice, opts.now ?? Date.now()).run();
  return sendNotice(env, id, opts);
}

/**
 * A notice written down as due in a press's own write (dueStmt), sent now if People can be read: after the answer with
 * `waitUntil`, or before it (`wait`: the press says whether it went). → {} | { sent: true } (`wait`, it went) |
 * { later } (it waits for People, or (`wait`) for the next look). Nothing when email isn't set up
 */
export async function sendNotice(env, id, { waitUntil = null, who = '', now = Date.now(), wait = false } = {}) {
  if (!emailConfigured(env)) return {};
  let reads;
  try { reads = await noticeReads(env.DB); } catch (err) {
    if (!err?.unread) throw err;
    return { later: laterWords(who) };
  }
  if (wait) {
    const r = await deliver(env, id, reads, { now });
    return r.sent ? { sent: true } : { later: laterWords(who) };
  }
  const going = deliver(env, id, reads, { now }).catch((err) => console.error('[board-notices]', id, err?.message || err));
  if (waitUntil) waitUntil(going); else await going;
  return {};
}

/**
 * The row a notice is kept due in, as oweNotice writes it: { key, data, at }. A press that writes it in the same step as
 * its own work (./_board-corrections.js decideCorrection) uses this, then sendNotice
 */
export const dueRow = (id, notice, now = Date.now()) => ({ key: `${PREFIX}${id}`, data: JSON.stringify({ ...notice, id, queuedAt: iso(now), tries: 0 }), at: iso(now) });
/**
 * The statement that writes a notice down as due, for a press's own one write (board_state made first: readState or
 * stateReady). Written once: a press made again keeps the first (ON CONFLICT), never two of one notice. `only` ({ sql,
 * bind }): written only while that holds, as the press's own statement in the same batch is
 */
export const dueStmt = (DB, id, notice, now = Date.now(), only = null) => {
  const d = dueRow(id, notice, now);
  return only
    ? DB.prepare(`INSERT INTO board_state (key, data, updated_at) SELECT ?, ?, ? WHERE ${only.sql} ON CONFLICT(key) DO NOTHING`).bind(d.key, d.data, d.at, ...only.bind)
    : DB.prepare('INSERT INTO board_state (key, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING').bind(d.key, d.data, d.at);
};

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
  // (a read that fails before anything is sent lets go of it as it was: it's no try, and the next look has it at once)
  const release = () => DB.prepare("UPDATE board_state SET data = json_remove(data, '$.sending') WHERE key = ?").bind(key).run();
  let n;
  try { n = parse((await DB.prepare('SELECT data FROM board_state WHERE key = ?').bind(key).first())?.data); } catch (err) { await release().catch(() => {}); throw err; }
  if (!n) return { none: true };
  const keep = (sent, why) => DB.prepare('UPDATE board_state SET data = ? WHERE key = ?')
    .bind(JSON.stringify({ ...n, sending: undefined, sent, tries: (Number(n.tries) || 0) + 1, triedAt: iso(now), error: String(why || '').slice(0, 300) }), key).run();
  const close = (events = []) => (events.length
    ? import('./_board-sign.js').then(({ appendEvents }) => appendEvents(DB, async () => ({ stmts: [DB.prepare('DELETE FROM board_state WHERE key = ?').bind(key)], events })))
    : DB.prepare('DELETE FROM board_state WHERE key = ?').bind(key).run());
  // Who it's for, as People has them at the moment it goes (Board QA round 11: one who'd left the board was sent it at
  // the address the press kept). A read that fails here lets go of it too, for the look to say so
  let who;
  try { who = await forNow(DB, n, reads.board); } catch (err) { await release().catch(() => {}); throw err; }
  // (one whose rename couldn't finish waits for the person who settles it: nothing is sent or written)
  if (who.wait) { await release(); return { busy: true }; }
  // (who has had it: kept through anything that stops this send, so nobody gets it twice)
  const had = new Set(n.sent || []);
  try {
    // (a signature's notice the chain already has went: off the list, never again)
    if (n.kind === 'void' && await voidInChain(DB, n, who.slug)) { await close(); return { none: true }; }
    // Someone who left the board is owed nothing: closed with a true record of why (in the signing record, for a
    // signature's), in one step with taking it off the list
    if (who.left) {
      await close(n.kind === 'void' ? [{ kind: 'void-sent', docId: n.docId, slug: who.slug, year: n.year, by: n.by || 'SOARD board page', detail: { for: n.at, skipped: 'not on the board' } }] : []);
      return { none: true };
    }
    const mails = await mailsFor(env, n, reads, who.member);
    let failed = 0;
    let why = '';
    for (const m of mails) {
      if (had.has(m.to)) continue;
      const r = await sendEmailOne(env, m);
      if (r.sent || r.already) had.add(m.to);
      else { failed += 1; why = r.errors?.[0] || 'the email didn’t go'; }
    }
    if (failed) { await keep([...had], why); return { failed }; }
    // (all of it went: off the list. Its record not closing leaves who had it kept, so the next look only closes it, and
    // the answer is what went. Board QA round 13)
    try {
      await close(n.kind === 'void' && mails.length ? [{ kind: 'void-sent', docId: n.docId, slug: who.slug, year: n.year, by: n.by || 'SOARD board page', detail: { to: mails[0].to, for: n.at, ...(n.replacedByCopy ? { replacedByCopy: true } : {}) } }] : []);
    } catch (err) {
      console.error('[board-notices] closing', id, err?.message || err);
      await keep([...had], 'sent; its record not closed yet').catch(() => {});
    }
    return mails.length ? { sent: true } : { none: true };
  } catch (err) {
    await keep([...had], err?.message).catch(() => {});
    throw err;
  }
}

/**
 * The address a member has now: `slug`, as it was at `since`, followed through People's renames made after (./_board.js
 * addressesNow: the audit log, the signing chain's 'renamed' events and a rename still finishing). → { slug } or
 * { wait: true } while a rename of theirs that couldn't finish waits for a person (./_rename-finish.js: until it's
 * settled, who's at either address can't be told). A read that fails throws, never "the same address"
 */
export async function slugNow(DB, slug, since = '') {
  const { addressesNow } = await import('./_board.js');
  const { renamesLeft } = await import('./_rename-finish.js');
  const now = (await addressesNow(DB, [slug], { since }))[slug] || slug;
  if ((await renamesLeft(DB)).some((x) => x.stuck && [x.from, x.to].some((s) => s === slug || s === now))) return { wait: true };
  return { slug: now };
}

/**
 * Whom a notice is for at the moment it goes: { member } (on the board now, at the address they have now), { left, slug }
 * (not on the board: nothing is owed them), { wait } (see slugNow), or {} for a notice that isn't any one member's
 */
async function forNow(DB, n, board) {
  const slug = n.kind === 'void' ? n.slug : n.kind === 'correction-decided' ? n.toSlug : null;
  if (!slug) return {};
  const now = await slugNow(DB, slug, n.queuedAt || '');
  if (now.wait) return now;
  const member = board.find((p) => p.slug === now.slug);
  return member ? { member, slug: now.slug } : { left: true, slug: now.slug };
}

/**
 * Whether the chain says this signature's notice went or was closed (a void-sent for the same paper, member, year and
 * signature, under the address they had or have now). A read that fails throws: never taken for "not yet"
 */
async function voidInChain(DB, n, slugNow = n.slug) {
  const rows = (await DB.prepare("SELECT detail FROM board_sign_events WHERE kind = 'void-sent' AND doc_id = ? AND slug IN (?, ?) AND year = ?").bind(n.docId, n.slug, slugNow || n.slug, n.year).all().catch((e) => {
    if (/no such table/i.test(e?.message || '')) return { results: [] };
    throw e;
  })).results || [];
  return rows.some((r) => parse(r.detail)?.for === n.at);
}

/**
 * Each email a notice is, as it reads now: [{ to, subject, html, text, … }] ([] when nothing is owed any more).
 * `member`: whom it's for, on the board now (forNow); the address the press kept is only where it goes, never whether
 */
async function mailsFor(env, n, { board, admins }, member = null) {
  const { DB } = env;
  if (n.kind === 'void') {
    const to = [n.to, member?.email].map(normEmail).find(isEmail) || '';
    const { listDocs } = await import('./_board.js');
    const doc = (await listDocs(DB)).find((d) => d.id === n.docId);
    if (!isEmail(to) || !doc) return [];
    const { voidEmail } = await import('./_board-sign.js');
    return [{ to, from: fromBoard(), replyTo: admins, tags: [{ name: 'kind', value: 'board-void' }], idempotencyKey: `void:${n.docId}:${n.slug}:${n.year}:${n.at}`, ...voidEmail({ doc, year: n.year, reason: n.reason || '', replacedByCopy: !!n.replacedByCopy }) }];
  }
  if (n.kind === 'declined') {
    // To who runs Board: a member who can't sign a paper as written, and why (the decline itself is in the chain, kept
    // in the same write as this notice: ./_board-sign.js declineDoc)
    const { listDocs } = await import('./_board.js');
    const doc = (await listDocs(DB)).find((d) => d.id === n.docId);
    if (!doc) return [];
    const { declineEmail } = await import('./_board-sign.js');
    const mail = declineEmail({ doc, name: n.name || '', reason: n.reason || '', year: n.year });
    return [...new Set((admins || []).map(normEmail))].filter(isEmail).map((to) => ({ to, from: fromBoard(), replyTo: isEmail(n.email) ? [n.email] : [], tags: [{ name: 'kind', value: 'board-declined' }], idempotencyKey: `declined:${n.docId}:${n.slug}:${n.year}:${n.at}:${to}`, ...mail }));
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
    const to = [n.toEmail, member?.email].map(normEmail).find(isEmail) || '';
    if (!isEmail(to)) return [];
    return [{ to, from: fromBoard(), ...words.correctionDecidedEmail(m, { made: !!n.made, by: n.byName || '' }), replyTo: admins, tags: [{ name: 'kind', value: 'board-correction-decided' }], idempotencyKey: `correction-decided:${n.cid}` }];
  }
  return [];
}

export { firstName as noticeName };
