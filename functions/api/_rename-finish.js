/**
 * _rename-finish.js: what a People rename moves after its one batch (./rename-content.js), finished for certain
 * ========================================================================================================
 * The record, its private email, History, profile requests, Advisory Board applications and welcome records move in
 * the rename's one batch: all of it or none of it. A board member's board records (./_board-rename.js moveBoardSlug:
 * meetings read and saved one at a time) and an Advisory Board member's page records (./_advisory.js moveSlug) can't go
 * in that batch, so the batch writes down that they're to follow (`rename-finish:<from>`, in board_state), they're moved
 * right after it, and the note goes only once every one of them has. One that didn't (the database didn't answer partway)
 * is finished by the heartbeat (maybeFinishRenames, from ./_board.js maybeRunBoard): every move is safe to run again,
 * and the signing chain's "renamed" event is written once. Nothing is ever left at the old address unsaid
 * (Advisory Board QA round 17, Nov 21 2026). One that can't be finished as it stands (the person no longer at its new
 * address, or someone at its old one) is a person's to look at: the staff are told once, and until then neither of its
 * addresses is given to anyone nor its people renamed or deleted (Advisory Board QA round 19)
 */
import { counted } from './_member-places.js';

const KEY = (from) => `rename-finish:${from}`;
// (its Needs attention post's key: told by tellStuck, resolved by settleStuck)
const ISSUE = (from) => `rename-finish:${from}`;

/** The statement for the rename's batch: their board and page records are to follow (board_state made first: noteReady) */
export const finishNote = (DB, from, to, { at = new Date().toISOString(), by = '' } = {}) => DB.prepare('INSERT OR REPLACE INTO board_state (key, data, updated_at) VALUES (?, ?, ?)')
  .bind(KEY(from), JSON.stringify({ from, to, at, by }), at);
/** board_state made, so the batch's note has its table */
export async function noteReady(DB) {
  const { readState } = await import('./_board-roles.js');
  await readState(DB, KEY(''));
}

/**
 * Their board records and Advisory Board records moved, every place each keeps them (./_member-places.js), and the note
 * gone once all of them are. → { report } (what actually moved, by kind: [{ kind, owner, words, moved, folded }], folded
 * being a record they had at both addresses, the newer kept and the older in the audit log) when all went, else false.
 * `at`: this rename's own moment (its note's), so its "renamed" event is written once however often it's finished, and
 * a later rename the same way (renamed, undone, renamed again) writes its own (Board QA round 6). `by`: who renamed them;
 * `foldBy`: who the audit log names for a record folded in (the person who pressed Move on People's note), else `by`
 */
export async function finishRename(DB, from, to, { by = '', at = '', foldBy = '' } = {}) {
  try {
    const report = [];
    // (either one failing leaves the note, for the heartbeat or a press to finish: each move is safe to run again)
    await (await import('./_board-rename.js')).moveBoardSlug(DB, from, to, { strict: true, by: foldBy || by, report });
    report.push(...await (await import('./_advisory.js')).moveSlug(DB, from, to, { by: foldBy || by }));
    // The signing chain is never rewritten: a 'renamed' event says the old slug is theirs (./_board-sign.js slugsOf), once
    const had = await DB.prepare('SELECT COUNT(*) AS n FROM board_sign_events WHERE slug = ?').bind(from).first().catch((e) => { if (/no such table/i.test(e?.message || '')) return null; throw e; });
    if (Number(had?.n) > 0) {
      const mark = at || new Date().toISOString();
      const done = await DB.prepare("SELECT COUNT(*) AS n FROM board_sign_events WHERE kind = 'renamed' AND slug = ? AND instr(detail, ?) > 0 AND instr(detail, ?) > 0").bind(to, JSON.stringify(from), JSON.stringify(mark)).first();
      if (!Number(done?.n)) {
        const { appendEvents } = await import('./_board-sign.js');
        await appendEvents(DB, async () => ({ events: [{ kind: 'renamed', slug: to, by, detail: { from, to, at: mark } }] }));
      }
    }
    await DB.prepare('DELETE FROM board_state WHERE key = ?').bind(KEY(from)).run();
    return { report };
  } catch (e) {
    console.error('[rename] finishing', from, '→', to, e?.message || e);
    return false;
  }
}

/**
 * Every rename still to finish: [{ key, from, to, at, stuck?, told? }]. A list that can't be read throws, never read as
 * none (a rename or delete going ahead on that would leave records at an address nobody has: Advisory Board QA round 19);
 * no table yet is none
 */
export async function renamesLeft(DB) {
  let rows;
  try {
    rows = (await DB.prepare("SELECT key, data FROM board_state WHERE key >= 'rename-finish:' AND key < 'rename-finish;'").all()).results || [];
  } catch (e) {
    if (/no such table/i.test(e?.message || '')) return [];
    throw Object.assign(new Error(`the renames still to finish couldn’t be read: ${e?.message || e}`), { unread: true });
  }
  return rows.map((r) => { try { return { key: r.key, ...JSON.parse(r.data) }; } catch { return null; } }).filter((n) => n?.from && n?.to);
}
const notes = renamesLeft;

/**
 * One rename's records finished, only as things stand: the person still at its new address and nobody at its old one
 * (a rename on top of it, its undo, or someone moved into the old address would otherwise have their records filed under
 * the wrong person: Advisory Board QA round 18). Both addresses held meanwhile, as a rename holds them
 * (./_advisory-add.js holdForPeople), unless the caller holds them already (`held`). → 'done' | 'busy' | 'failed' | 'stuck'
 */
async function finishOne(DB, n, { held = [], by = '' } = {}) {
  const { holdForPeople, letGo } = await import('./_advisory-add.js');
  const need = [n.from, n.to].filter((x) => !held.includes(x));
  let keys = null;
  if (need.length) { keys = await holdForPeople(DB, need).catch(() => null); if (!keys) return 'busy'; }
  try {
    const at = ((await DB.prepare('SELECT slug FROM team WHERE slug IN (?, ?)').bind(n.from, n.to).all()).results || []).map((r) => r.slug);
    if (!at.includes(n.to) || at.includes(n.from)) {
      // (never moved under someone else: left for a person, told once by the heartbeat (tellStuck), never tried again by
      // itself, and its addresses given to nobody meanwhile: ./_people-address.js)
      console.error('[rename] not finished: the person is no longer at', n.to, 'or someone is at', n.from);
      await DB.prepare('UPDATE board_state SET data = json_set(data, \'$.stuck\', ?) WHERE key = ?').bind(at.includes(n.from) ? 'someone at the old address' : 'not at the new address', n.key || KEY(n.from)).run();
      return 'stuck';
    }
    return (await finishRename(DB, n.from, n.to, { by: n.by || by, at: n.at })) ? 'done' : 'failed';
  } finally {
    if (keys) await letGo(DB, keys);
  }
}

/**
 * Before a People rename or delete goes on (holding `held`): every rename still to finish that touches these addresses,
 * finished first, so a rename on top of one, its undo, or a swap of two people's addresses never leaves records at a
 * dead address or under the wrong person. → the ones still to finish ({ from, to, stuck? }): the rename or delete then
 * waits. One that couldn't finish as it stood (stuck) waits for a person, never finished by itself or stepped over; a
 * list that can't be read is [{ unread: true }], never taken for none (Advisory Board QA round 19)
 */
export async function settleFor(DB, held) {
  let list;
  try { list = await notes(DB); } catch (e) {
    console.error('[rename] settling', e?.message || e);
    return [{ unread: true }];
  }
  const left = [];
  for (const n of list) {
    if (!held.includes(n.from) && !held.includes(n.to)) continue;
    if (n.stuck) { left.push({ from: n.from, to: n.to, stuck: true }); continue; }
    const r = await finishOne(DB, n, { held });
    if (r !== 'done') left.push({ from: n.from, to: n.to, ...(r === 'stuck' ? { stuck: true } : {}) });
  }
  return left;
}

// Board's records with no words of their own (when they last visited, and when their visits were last counted: one
// each, said together)
const BOARD_OTHER = ['other Board record (like when they last visited)', 'other Board records (like when they last visited)'];
/** Entries by kind ([{ owner, n, words }]) in words for staff, Board's "other" records together after Board's own */
function wordsOf(entries) {
  const out = [];
  let other = 0;
  let boardEnd = 0;
  for (const e of entries) {
    if (!e.n) continue;
    if (e.words) out.push(counted(e.n, e.words)); else other += e.n;
    if (e.owner === 'board') boardEnd = out.length;
  }
  if (other) out.splice(boardEnd, 0, counted(other, BOARD_OTHER));
  return out;
}
/**
 * What's still kept under an address, by kind, in words for staff (the Needs attention post and People's note say the
 * same) → ['1 board meeting they’re on', '2 to-dos from board meetings', '3 sign-ins to the board page', …]: every place
 * in the one list of where a person's things live (./_member-places.js), the list the address rule holds and a rename
 * moves (Advisory Board QA round 20: the ask email's links weren't counted). A read that fails throws; a table not made
 * yet keeps nothing
 */
export async function leftAt(DB, slug) {
  const { keptAt } = await import('./_member-places.js');
  return wordsOf(await keptAt(DB, slug));
}

/**
 * Who a stuck rename is about, as things stand: `name` (the person at its new address, else the name History last kept
 * there, else ''), `here` (someone is at the new address), `other` (the name of whoever is at its old address now, or
 * null). The Needs attention post and People's note say the same. A read that fails throws
 */
async function whoOf(DB, n) {
  const rows = ((await DB.prepare('SELECT slug, name, data FROM team WHERE slug IN (?, ?)').bind(n.from, n.to).all()).results) || [];
  const nameOf = (r) => { if (!r) return ''; if (r.name) return r.name; try { return JSON.parse(r.data)?.name || r.slug; } catch { return r.slug; } };
  const at = (slug) => rows.find((r) => r.slug === slug);
  let name = nameOf(at(n.to));
  if (!name) {
    // (deleted or renamed again since: History keeps their last version under the address, so their name is known)
    const last = await DB.prepare("SELECT data FROM content_versions WHERE collection = 'team' AND slug = ? ORDER BY id DESC LIMIT 1").bind(n.to).first()
      .catch((e) => { if (/no such table/i.test(e?.message || '')) return null; throw e; });
    try { name = JSON.parse(last?.data || 'null')?.name || ''; } catch { name = ''; }
  }
  return { name, here: !!at(n.to), other: at(n.from) ? nameOf(at(n.from)) : null };
}

/**
 * A rename that couldn't be finished as it stood, said to the staff once (Needs attention, as Board's alerts are): what's
 * left where, and where to settle it (People's note: settleStuck). Claimed first, so two heartbeats never both say it;
 * one that didn't go out is let go, so the next heartbeat says it
 */
async function tellStuck(DB, n, tell, now, resolve = null) {
  const r = await DB.prepare("UPDATE board_state SET data = json_set(data, '$.told', ?) WHERE key = ? AND json_valid(data) AND json_extract(data, '$.told') IS NULL")
    .bind(new Date(now).toISOString(), n.key || KEY(n.from)).run();
  if (!r?.meta?.changes) return false;
  try {
    const who = await whoOf(DB, n);
    let left;
    try { left = await leftAt(DB, n.from); } catch { left = null; }
    const where = left === null ? `some of their records may still be under “${n.from}” (the site couldn’t count them just now)`
      : left.length ? `these are still under “${n.from}”: ${left.join(', ')}`
        : `the site found nothing of theirs still under “${n.from}”, but couldn’t finish the change either`;
    const why = n.stuck === 'someone at the old address'
      ? `The site didn’t move them by itself because ${who.other || 'someone else'} is at “${n.from}” on People now, so they might be theirs.`
      : `The site didn’t move them by itself because nobody is at “${n.to}” on People now (renamed again or deleted since), so it can’t tell whose they are.`;
    // (where a person settles it, and only the ways it can be settled: Move only while someone is at the new address)
    const ways = who.here ? `move them to “${n.to}” or leave them at “${n.from}”` : `leave them at “${n.from}”`;
    // (still waiting for a person: checked again after the Slack post, just before the email goes, so an email never
    // asks staff to settle what someone already settled meanwhile: Board QA round 8. A check that fails tells them)
    const unsettled = () => DB.prepare("SELECT 1 AS here FROM board_state WHERE key = ? AND json_valid(data) AND json_extract(data, '$.stuck') IS NOT NULL AND COALESCE(json_extract(data, '$.at'), '') = ?")
      .bind(n.key || KEY(n.from), n.at || '').first().then((r) => !!r, () => true);
    await tell({
      stillSo: unsettled,
      level: 'warn', title: `A change of web address on People didn’t finish: “${n.from}” to “${n.to}”`,
      detail: `${who.name ? `${who.name}’s` : 'Someone’s'} web address was changed from “${n.from}” to “${n.to}”, and ${where}. ${why}`,
      fix: `Settle it in the admin on People: the note at the top lets you ${ways}. Until then the site won’t give “${n.from}” or “${n.to}” to anyone, or change the address of anyone at them.`,
      url: 'https://sunshineonaranneyday.com/admin/#people', urlLabel: 'Open People', issue: ISSUE(n.from),
    });
    // Settled on People while this was going out: settleStuck's own "Resolved" found no post yet to say it on, so it's
    // said here, and the post never stays open over records a person already settled (a read that fails says nothing)
    if (resolve) {
      const still = await DB.prepare("SELECT 1 AS here FROM board_state WHERE key = ? AND json_valid(data) AND COALESCE(json_extract(data, '$.at'), '') = ?")
        .bind(n.key || KEY(n.from), n.at || '').first().catch(() => ({ here: 1 }));
      if (!still) await resolve(ISSUE(n.from), `Settled on People: “${n.from}” to “${n.to}”`).catch((e) => console.error('[rename] settled while telling', n.from, e?.message || e));
    }
    return true;
  } catch (e) {
    console.error('[rename] telling the staff', n.from, '→', n.to, e?.message || e);
    await DB.prepare("UPDATE board_state SET data = json_remove(data, '$.told') WHERE key = ? AND json_valid(data)").bind(n.key || KEY(n.from)).run().catch(() => {});
    return false;
  }
}

/**
 * How the heartbeat tells the staff (./_board.js maybeRunBoard): `tell` posts in Needs attention, as Board's alerts do;
 * `resolve` edits that post to Resolved, for a rename settled on People while its post was going out
 */
export function alertsFor(env) {
  return {
    tell: async (card) => {
      const [{ alertAdmins }, { readConfig }] = await Promise.all([import('./_broadcast-notify.js'), import('./_broadcast.js')]);
      await alertAdmins(env, await readConfig(env.DB).catch(() => ({})), card);
    },
    resolve: async (issue, title) => {
      const [{ slackResolved }, { slackCard }] = await Promise.all([import('./_broadcast-notify.js'), import('./_slack-cards.js')]);
      await slackResolved(env, issue, slackCard({ icon: '✅', title, lead: 'Someone settled it on People as this was being posted.' }), { summary: 'Settled on People.' });
    },
  };
}

/**
 * The heartbeat: each rename whose records didn't all follow, finished (a minute after it, so never racing the rename
 * itself). One that couldn't be finished as it stood is never tried again by itself: the staff are told, once (`tell`,
 * the board's alert: ./_board.js maybeRunBoard; `resolve` says its post settled, for one settled on People as it went
 * out). A list that can't be read stops it, said in the log
 */
export async function maybeFinishRenames(DB, { now = Date.now(), tell = null, resolve = null } = {}) {
  const done = [];
  for (const n of await notes(DB)) {
    if (n.stuck) { if (!n.told && tell) await tellStuck(DB, n, tell, now, resolve); continue; }
    if (now - Date.parse(n.at) < 60 * 1000) continue;
    const r = await finishOne(DB, n);
    if (r === 'done') done.push(n.from);
    else if (r === 'stuck' && tell) {
      const after = (await notes(DB)).find((x) => x.key === n.key);
      if (after?.stuck && !after.told) await tellStuck(DB, after, tell, now, resolve);
    }
  }
  return done;
}

// ─── A person settles one that couldn't finish (People's note, ./rename-settle.js) ───────────────────

/**
 * Every rename that couldn't finish by itself and waits for a person, as People's note shows it: [{ from, to, at, name,
 * here, other, left }] (whoOf; `left` is what's still under its old address, by kind, or null when it couldn't be
 * counted). A list that can't be read throws, never read as none
 */
export async function stuckRenames(DB) {
  const out = [];
  for (const n of await notes(DB)) {
    if (!n.stuck) continue;
    const who = await whoOf(DB, n);
    let left;
    try { left = await leftAt(DB, n.from); } catch { left = null; }
    out.push({ from: n.from, to: n.to, at: n.at || '', ...who, left });
  }
  return out;
}

const SETTLED = 'This was settled already, in another tab or by someone else. People shows where things stand now.';
const refused = (status, error, more = {}) => ({ status, body: { success: false, error, ...more } });

/**
 * One that couldn't finish, settled by the person who chose on People's note (`by`, their sign-in), Peter's rules
 * (Nov 21 2026: approvals and decisions live in the admin, in an existing page):
 *   'move'   everything still under its old address moved to its new one, as a rename moves it (finishRename: the
 *            signing chain's "renamed" event written once), only while someone is at the new address; whatever of the
 *            person now at the old address is there moves too, which the question asked first says
 *   'leave'  the records stay where they are, with whoever is at the old address, or with nobody
 * Either way the note goes (so the rule that held both addresses for it lets go: ./_people-address.js 'renaming'), its
 * Needs attention post is resolved (the same post: tellStuck's), and the audit log says who chose which. `at` is the
 * note's own moment as the person saw it, so a note settled meanwhile (and any made since) is never acted on.
 * Both addresses held while it's settled, as a rename holds them. → { status, body }
 */
export async function settleStuck(env, { from, at = '', choice } = {}, by = '') {
  const { DB } = env;
  if (choice !== 'move' && choice !== 'leave') return refused(400, 'Choose Move them or Leave them.');
  if (typeof from !== 'string' || !from) return refused(400, 'Say which change of web address to settle: reload People and press its button again.');
  const find = async () => (await notes(DB)).find((x) => x.from === from && x.stuck && (!at || x.at === at)) || null;
  const noAnswer = () => refused(503, 'The site’s database didn’t answer just now, so nothing changed. Try again in a moment.');
  let n;
  try { n = await find(); } catch (e) { console.error('[rename] settling', from, e?.message || e); return noAnswer(); }
  if (!n) return refused(409, SETTLED, { settled: true });
  const { holdForPeople, letGo } = await import('./_advisory-add.js');
  let keys;
  try { keys = await holdForPeople(DB, [n.from, n.to]); } catch (e) { console.error('[rename] settling: hold', e?.message || e); return noAnswer(); }
  if (!keys) return refused(409, 'Someone is changing one of these people on People right now. Try again in a moment.');
  try {
    // (as it is now, inside the hold: settled meanwhile is said as that)
    try { n = await find(); } catch (e) { console.error('[rename] settling', from, e?.message || e); return noAnswer(); }
    if (!n) return refused(409, SETTLED, { settled: true });
    const who = await whoOf(DB, n);
    let left;
    try { left = await leftAt(DB, n.from); } catch { left = null; }
    const list = left?.length ? left.join(', ') : '';
    const whose = who.name ? `${who.name}’s records` : 'The records';
    let said;
    let folded = '';
    if (choice === 'move') {
      if (!who.here) return refused(409, `Nobody is at “${n.to}” on People now, so the records can’t be moved there. Leave them at “${n.from}” instead.`);
      // (the moves a rename makes, each safe to run again: one that didn't all go leaves the note, so pressing again finishes it)
      const done = await finishRename(DB, n.from, n.to, { by: n.by || by, at: n.at, foldBy: by });
      if (!done) {
        return refused(503, `Not everything moved: the site’s database didn’t answer partway. Press Move them to “${n.to}” again to finish.`);
      }
      // Said from what actually moved, never the counts read before it (Advisory Board QA round 20, Board QA round 8: a
      // record the new address had already was said to have moved and stayed behind): moved, folded into the one already
      // at the new address (the newer kept, the older in the audit log), and anything still there
      const order = await (await import('./_member-places.js')).kindOrder();
      const report = [...(done.report || [])].sort((x, y) => order.indexOf(x.kind) - order.indexOf(y.kind));
      const moved = wordsOf(report.map((e) => ({ ...e, n: e.moved }))).join(', ');
      folded = wordsOf(report.map((e) => ({ ...e, n: e.folded }))).join(', ');
      let still;
      try { still = (await leftAt(DB, n.from)).join(', '); } catch { still = null; }
      const term = report.some((e) => e.folded && e.kind === 'advisory_terms');
      said = [
        !moved && !folded ? `Nothing of ${who.name ? `${who.name}’s` : 'theirs'} was still at “${n.from}”, so nothing needed moving to “${n.to}”.`
          : `${whose} still at “${n.from}” moved to “${n.to}”${moved ? `: ${moved}` : ''}.`,
        folded ? `For ${folded}, “${n.to}” had one already: the newer of each was kept${term ? ' (a term keeps the earlier start date)' : ''}, and the older is in the audit log.` : '',
        still ? `Still at “${n.from}”: ${still}.` : still === null ? `The site couldn’t check what’s still at “${n.from}” just now.` : '',
      ].filter(Boolean).join(' ');
    } else {
      const r = await DB.prepare("DELETE FROM board_state WHERE key = ? AND json_valid(data) AND json_extract(data, '$.stuck') IS NOT NULL AND COALESCE(json_extract(data, '$.at'), '') = ?")
        .bind(KEY(n.from), n.at || '').run();
      if (!r?.meta?.changes) return refused(409, SETTLED, { settled: true });
      said = `${whose} were left at “${n.from}”${who.other ? `, with ${who.other}, who is at that address now` : ', with nobody: nobody is at that address on People'}.`;
    }
    // The Needs attention post tellStuck made says it's settled (the same post, edited to Resolved), and the audit log
    // who chose which
    try {
      const [{ slackResolved }, { slackCard }] = await Promise.all([import('./_broadcast-notify.js'), import('./_slack-cards.js')]);
      await slackResolved(env, ISSUE(n.from), slackCard({ icon: '✅', title: `Settled on People: “${n.from}” to “${n.to}”`, lead: `${said} ${by || 'Someone'} chose this on People.` }), { summary: said });
    } catch (e) { console.error('[rename] settling: Needs attention', e?.message || e); }
    const { logAudit } = await import('./_audit.js');
    await logAudit(DB, {
      userEmail: by || 'unknown', action: 'updated', entityType: 'team', entitySlug: n.to,
      entityName: choice === 'move' ? `${who.name || n.to}: records moved from “${n.from}” to “${n.to}”` : `${who.name || n.to}: records left at “${n.from}”`,
      changes: [{ field: `records still at “${n.from}”`, from: list || null, to: choice === 'move' ? `moved to “${n.to}”${folded ? `, the newer kept where “${n.to}” had one already: ${folded}` : ''}` : `left at “${n.from}”, ${who.other ? `with ${who.other}` : 'with nobody'}` }],
      path: null, gitStatus: null,
    });
    return { status: 200, body: { success: true, choice, from: n.from, to: n.to, said } };
  } finally {
    await letGo(DB, keys).catch(() => {});
  }
}
