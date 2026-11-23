/**
 * A board member's web address changed on People (./rename-content.js): everywhere Board keeps it, it moves with them
 * ===============================================================================================================
 * Board knows a member by their slug, in its own tables and inside what it stores:
 *   - rows keyed by it: sign-ins and what they did on the board page (Board → Members), their last visit, signatures
 *     (this year's, earlier wordings', their signed copies and records), asks to sign, adopted signature, check-ins,
 *     votes, report asks, answers given on the board page and the old one-tap links, the minutes they signed as
 *     secretary, and who wrote each correction, line note and question
 *   - inside each meeting (practice ones too): the attendance, who presents each item, whose each to-do is, the
 *     invite's answers and who Board put on it, who Meet saw join, who has the floor
 *   - the secretary's notes not sent yet (a person's mark is under their slug) and what the last send put there
 *   - the agenda template (who presents each item)
 * so their own to-dos, the items they present and their reminders stay theirs. The signing chain is never rewritten:
 * a 'renamed' event says the old slug is theirs (./_board-sign.js slugsOf), added by rename-content.js.
 * Each part on its own: one that can't move is said in the log, and never stops the rest.
 */

import { getMeeting, patchMeeting, getPractice, patchPractice, changeTemplate } from './_board.js';
import { rowsPlace, noTable } from './_member-places.js';

/** Tables with the member's slug in a column: [table, column] (./_rename-finish.js counts what's left in them too) */
export const ROWS = [
  ['board_signins', 'slug'], ['board_activity', 'slug'], ['board_activity_reports', 'slug'], ['board_seen', 'slug'],
  ['board_signatures', 'slug'], ['board_signatures_earlier', 'slug'], ['board_sign_asks', 'slug'], ['board_member_marks', 'slug'],
  ['board_checkins', 'slug'], ['board_votes', 'slug'], ['board_asks', 'slug'], ['board_rsvps', 'slug'], ['board_rsvp_links', 'slug'],
  ['board_minutes_signed', 'slug'], ['board_minutes_corrections', 'by_slug'], ['board_line_notes', 'by_slug'], ['board_ask_questions', 'by_slug'],
];
/**
 * Each table's unique key beside the address (`same`: two rows for the same thing clash there; null, they never do) and
 * the column saying when a row was made or last changed (`newer`), for the clash rule (./_member-places.js: the newer
 * kept, the older folded in and in the audit log; Board QA round 8: these moves had been UPDATE OR IGNORE, so a row the
 * new address already had, board_seen above all, left the old address's row behind under whoever is there now). And
 * each kind in words for staff (null: one of Board's "other" records, said together)
 */
const ROW_RULES = {
  board_signins: { same: ['iat'], newer: 'at', words: ['sign-in to the board page', 'sign-ins to the board page'] },
  board_activity: { same: ['look'], newer: 'until', words: ['record of what they looked at on the board page', 'records of what they looked at on the board page'] },
  board_activity_reports: { same: [], newer: 'at', words: null },
  board_seen: { same: [], newer: 'at', words: null },
  board_signatures: { same: ['doc_id', 'year'], newer: 'at', words: ['signature on a board paper', 'signatures on board papers'] },
  board_signatures_earlier: { same: ['doc_id', 'year', 'version'], newer: 'at', words: ['signature on an earlier wording of a board paper', 'signatures on earlier wordings of board papers'] },
  board_sign_asks: { same: ['year'], newer: 'at', words: ['ask to sign a board paper', 'asks to sign board papers'] },
  board_member_marks: { same: [], newer: 'updated_at', words: ['saved signature for board papers', 'saved signatures for board papers'] },
  board_checkins: { same: ['meeting_id'], newer: 'at', words: ['check-in at a board meeting', 'check-ins at board meetings'] },
  board_votes: { same: ['meeting_id', 'motion_id'], newer: 'at', words: ['vote at a board meeting', 'votes at board meetings'] },
  board_asks: { same: ['kind', 'meeting_id', 'item_id'], newer: 'updated_at', words: ['email asking for their report for a meeting', 'emails asking for their reports for meetings'] },
  board_rsvps: { same: ['meeting_id'], newer: 'at', words: ['answer to a board meeting invite', 'answers to board meeting invites'] },
  board_rsvp_links: { same: null, words: ['one-tap link to answer a board meeting invite', 'one-tap links to answer board meeting invites'] },
  board_minutes_signed: { same: null, words: ['set of minutes they signed as secretary', 'sets of minutes they signed as secretary'] },
  board_minutes_corrections: { same: null, words: ['correction they made to the minutes', 'corrections they made to the minutes'] },
  board_line_notes: { same: null, words: ['note on a line of the money report', 'notes on lines of the money report'] },
  board_ask_questions: { same: null, words: ['question on a report', 'questions on reports'] },
};
const FILES_WORDS = ['signed copy or record kept in Board', 'signed copies and records kept in Board'];
const MEETING_WORDS = ['board meeting they’re on', 'board meetings they’re on'];
const TODO_WORDS = ['to-do from a board meeting', 'to-dos from board meetings'];
const PRACTICE_WORDS = ['practice board meeting they’re on', 'practice board meetings they’re on'];
const NOTES_WORDS = ['meeting’s minutes notes that name them', 'meetings’ minutes notes that name them'];
const TEMPLATE_WORDS = ['item they present on the agenda template', 'items they present on the agenda template'];

const rowsOf = async (DB, sql, ...binds) => (await DB.prepare(sql).bind(...binds).all().catch(noTable))?.results || [];
const readJson = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const todosIn = (m, slug) => (Array.isArray(m?.actions) ? m.actions : []).filter((a) => a?.owner === slug).length;
const presentsIn = (template, slug) => (Array.isArray(template) ? template : []).reduce((n, sec) => n + (sec?.items || []).filter((it) => it?.who?.includes(slug)).length, 0);
async function templatePresents(DB, slug) {
  const row = await DB.prepare("SELECT data FROM board_state WHERE key = 'settings'").first().catch(noTable);
  return presentsIn(readJson(row?.data, null)?.template, slug);
}
/**
 * Everywhere Board keeps a member's address, as one list (./_member-places.js), built from what moveBoardSlug moves:
 * the tables above (moved through their places), their signed copies, the meetings and their to-dos, practice meetings,
 * the secretary's notes and the agenda template's presenters (moved by moveBoardSlug itself, below). ./_people-address.js
 * holds an address while any has it, ./_rename-finish.js says what's left in each (Board QA round 8: the address rule
 * looked at four tables and the meetings, so "Leave them" with nobody there gave someone new a line note)
 */
export const BOARD_PLACES = [
  {
    kind: 'board_meetings', kinds: ['board_meetings', 'board_todos'], owner: 'board',
    async tally(DB, slug) {
      const meetings = await rowsOf(DB, 'SELECT data FROM board_meetings WHERE instr(data, ?) > 0 ORDER BY id', JSON.stringify(slug));
      // (a meeting that can't be read counts as one they're on)
      const todos = meetings.reduce((n, m) => n + todosIn(readJson(m.data, null), slug), 0);
      return [{ kind: 'board_meetings', n: meetings.length, words: MEETING_WORDS }, { kind: 'board_todos', n: todos, words: TODO_WORDS }];
    },
  },
  ...ROWS.map(([table, col]) => rowsPlace({ owner: 'board', table, col, ...ROW_RULES[table] })),
  // A correction to who was there targets the person on the roll by their address (`r:<address>`): it moves with them, and
  // counts, so it's made on them after a rename (Board QA round 9: "That part of the minutes isn't on the meeting any more")
  rowsPlace({ owner: 'board', table: 'board_minutes_corrections', col: 'target', prefix: 'r:', kind: 'board_minutes_corrections_roll', words: ['correction to who was there at a meeting', 'corrections to who was there at meetings'] }),
  {
    kind: 'board_files', owner: 'board',
    async tally(DB, slug) {
      const r = await DB.prepare("SELECT COUNT(*) AS n FROM board_files WHERE slug = ? AND owner_type IN ('signed', 'record')").bind(slug).first().catch(noTable);
      return [{ kind: 'board_files', n: Number(r?.n) || 0, words: FILES_WORDS }];
    },
  },
  {
    kind: 'board_practice', owner: 'board',
    async tally(DB, slug) {
      const rows = await rowsOf(DB, 'SELECT data FROM board_practice WHERE instr(data, ?) > 0', JSON.stringify(slug));
      const n = rows.filter((r) => { try { return !!movedIn(JSON.parse(r.data), slug, `${slug}-`); } catch { return true; } }).length;
      return [{ kind: 'board_practice', n, words: PRACTICE_WORDS }];
    },
  },
  {
    kind: 'board_minutes_notes', owner: 'board',
    async tally(DB, slug) {
      const rows = await rowsOf(DB, "SELECT data, sent FROM board_minutes_notes WHERE instr(data, ?) > 0 OR instr(COALESCE(sent, ''), ?) > 0", slug, slug);
      const n = rows.filter((r) => !!notesMoved(readJson(r.data, {}), readJson(r.sent, null), slug, `${slug}-`)).length;
      return [{ kind: 'board_minutes_notes', n, words: NOTES_WORDS }];
    },
  },
  { kind: 'board_template', owner: 'board', tally: async (DB, slug) => [{ kind: 'board_template', n: await templatePresents(DB, slug), words: TEMPLATE_WORDS }] },
];

// (an entry under both addresses: the newer, the one already at `to`, stays, unless it has no answer and the older has:
// Advisory Board QA round 20's rule, for Board's meetings too)
const noAnswer = (v) => v == null || v === '' || v === 'invited';
const keyed = (o, from, to) => {
  if (!o || typeof o !== 'object' || !(from in o)) return o;
  const out = Object.fromEntries(Object.entries(o).map(([k, v]) => [k === from ? to : k, v]));
  if (to in o) out[to] = noAnswer(o[to]) && !noAnswer(o[from]) ? o[from] : o[to];
  return out;
};

/** A meeting with the member's slug moved, or null when it has none (nothing to write) */
export function movedIn(m, from, to) {
  const json = JSON.stringify(m);
  if (!json.includes(`"${from}"`)) return null;
  const one = (s) => (s === from ? to : s);
  const next = {
    ...m,
    attendance: (m.attendance || []).map((p) => (p.slug === from ? { ...p, slug: to, key: to } : p)),
    sections: (m.sections || []).map((s) => ({ ...s, items: s.items.map((it) => (it.who?.includes(from) ? { ...it, who: it.who.map(one) } : it)) })),
    actions: (m.actions || []).map((a) => (a.owner === from ? { ...a, owner: to } : a)),
    invite: m.invite ? { ...m.invite, replies: keyed(m.invite.replies, from, to), who: keyed(m.invite.who, from, to) } : m.invite,
    calendar: m.calendar ? { ...m.calendar, replies: keyed(m.calendar.replies, from, to) } : m.calendar,
    fromMeet: m.fromMeet ? { ...m.fromMeet, joined: (m.fromMeet.joined || []).map((j) => (j.slug === from ? { ...j, slug: to } : j)) } : m.fromMeet,
    live: m.live?.floor === from ? { ...m.live, floor: to } : m.live,
  };
  return JSON.stringify(next) === json ? null : next;
}

/**
 * The secretary's notes not sent yet, and the last send's record, with the member's slug moved: a mark under it
 * (`r:<slug>`), a to-do's owner, and the record's marks, list and keeper (an action's print keeps its owner too, so the
 * next send doesn't take it for one changed in Board). → { data, sent } or null when neither has it
 */
export function notesMoved(data, sent, from, to) {
  const d = { ...(data || {}) };
  let changed = false;
  // (a mark already at the new address was made since, after the rename: it stands, and the older one goes. Board QA round 9)
  if (`r:${from}` in d) { if (!(`r:${to}` in d)) d[`r:${to}`] = d[`r:${from}`]; delete d[`r:${from}`]; changed = true; }
  for (const k of Object.keys(d)) if (k.startsWith('a:') && d[k]?.owner === from) { d[k] = { ...d[k], owner: to }; changed = true; }
  const s = sent && typeof sent === 'object' ? { ...sent } : sent;
  if (s && typeof s === 'object') {
    const before = JSON.stringify(s);
    if (Array.isArray(s.extra)) s.extra = s.extra.map((k) => (k === from ? to : k));
    for (const f of ['rollWas', 'rollPut']) s[f] = keyed(s[f], from, to);
    if (s.keeper === from) s.keeper = to;
    for (const f of ['actionPrints', 'votePrints']) {
      if (!s[f] || typeof s[f] !== 'object') continue;
      s[f] = Object.fromEntries(Object.entries(s[f]).map(([id, p]) => {
        try { const row = JSON.parse(p); if (Array.isArray(row) && row[4] === from) { row[4] = to; return [id, JSON.stringify(row)]; } } catch { /* a print as it was */ }
        return [id, p];
      }));
    }
    if (JSON.stringify(s) !== before) changed = true;
  }
  return changed ? { data: d, sent: s } : null;
}

/**
 * Everywhere Board keeps `from`, moved to `to`. → how many places moved. `strict`: a place that couldn't be moved (the
 * database didn't answer) throws once all the others have been tried, so whoever asked knows to finish it
 * (./_rename-finish.js); without it, as before, it's only logged. `by`: who, for the audit log's folded-in rows.
 * `report`: an array given what moved, by kind ({ kind, owner, words, moved, folded })
 */
export async function moveBoardSlug(DB, from, to, { strict = false, by = '', report = null } = {}) {
  let moved = 0;
  // Who changed what it rewrites, said the same way everywhere (an editor open on a meeting, a practice meeting or the
  // template asks "People (renaming Sam Ortiz) changed this meeting too", never "Board": Board QA round 9)
  let renaming = '';
  try { renaming = String(JSON.parse((await DB.prepare('SELECT data FROM team WHERE slug = ?').bind(to).first())?.data || '{}')?.name || '').trim(); } catch { /* said without it */ }
  const byRename = renaming ? `People (renaming ${renaming})` : 'People (a change of web address)';
  const failed = [];
  const said = (what) => (e) => { if (/no such table/i.test(e?.message || '')) return; console.error(`[board-rename] ${what}`, e?.message || e); failed.push(what); };
  // What actually moved, by kind (`report`, for the words a Move says: ./_rename-finish.js settleStuck), never counts read
  // beforehand
  const tell = (kind, words, n, folded = 0) => { if (report && (n || folded)) report.push({ kind, owner: 'board', words, moved: n, folded }); };
  // (a table Board hasn't made yet keeps nothing: never made here)
  // (each through its place: a row the new address already has for the same thing, from a rename undone or a stuck
  // rename's Move, is folded in by the clash rule, the newer kept and the older in the audit log, never left behind)
  for (const p of BOARD_PLACES) {
    if (!p.move) continue;
    try {
      for (const e of await p.move(DB, from, to, { by })) { moved += e.moved + e.folded; tell(e.kind, e.words, e.moved, e.folded); }
    } catch (e) { said(p.kind)(e); }
  }
  const files = await DB.prepare("UPDATE board_files SET slug = ? WHERE slug = ? AND owner_type IN ('signed', 'record')").bind(to, from).run().catch(said('board_files'));
  moved += files?.meta?.changes || 0;
  tell('board_files', FILES_WORDS, files?.meta?.changes || 0);

  // The meetings: as each is now (patchMeeting: a save made meanwhile stays, and an editor open on it merges)
  // (instr, not LIKE: D1 refuses a LIKE pattern over 50 bytes, and an address can be 80)
  const quoted = `"${from}"`;
  const rows = (await DB.prepare('SELECT id, data FROM board_meetings WHERE instr(data, ?) > 0').bind(quoted).all().catch(said('meetings')))?.results || [];
  let meetingsMoved = 0;
  let todosMoved = 0;
  for (const { id, data } of rows) {
    try {
      const m = await getMeeting(DB, id);
      // (as it's stored, too: a meeting ahead shows its roll as People has it now, so the copy read can look moved while
      // what's kept still names the old address, and the address stayed held. Board QA round 9)
      if (!m || !(movedIn(m, from, to) || movedIn(readJson(data, {}), from, to))) continue;
      let todos = 0;
      await patchMeeting(DB, id, (cur) => { todos = todosIn(cur, from); return movedIn(cur, from, to) || cur; }, { by: byRename });
      moved += 1;
      meetingsMoved += 1;
      todosMoved += todos;
    } catch (e) { said(`meeting ${id}`)(e); }
  }
  tell('board_meetings', MEETING_WORDS, meetingsMoved);
  tell('board_todos', TODO_WORDS, todosMoved);
  // Practice meetings (the admins' own table): as each is now, as every meeting is (patchPractice: a save made meanwhile
  // stays, and its time moves on, so an editor open on it merges instead of writing the old address back: Board QA round 8).
  // One that keeps changing under it throws, and is said and left for the finish note, never left with their address
  for (const row of (await DB.prepare('SELECT id FROM board_practice WHERE instr(data, ?) > 0').bind(quoted).all().catch(said('practice')))?.results || []) {
    try {
      const m = await getPractice(DB, row.id);
      if (!m || !movedIn(m, from, to)) continue;
      if (await patchPractice(DB, row.id, (cur) => movedIn(cur, from, to) || cur, { by: byRename })) { moved += 1; tell('board_practice', PRACTICE_WORDS, 1); }
    } catch (e) { said(`practice ${row.id}`)(e); }
  }

  // The secretary's notes: each box saved on its own (json_patch), so written only over the draft and record as read
  // (a mark is under `r:<slug>`, so looked for as it's written there, not only as a value)
  for (const row of (await DB.prepare("SELECT meeting_id, data, sent FROM board_minutes_notes WHERE instr(data, ?) > 0 OR instr(COALESCE(sent, ''), ?) > 0").bind(from, from).all().catch(said('notes')))?.results || []) {
    let went = false;
    let left = false;
    for (let i = 0, cur = row; i < 5 && cur; i++) {
      let data = {};
      let sent = null;
      try { data = JSON.parse(cur.data || '{}') || {}; } catch { /* none */ }
      try { sent = cur.sent ? JSON.parse(cur.sent) : null; } catch { /* none */ }
      const next = notesMoved(data, sent, from, to);
      left = !!next;
      if (!next) break;
      const r = await DB.prepare("UPDATE board_minutes_notes SET data = ?, sent = ? WHERE meeting_id = ? AND data = ? AND COALESCE(sent, '') = ?")
        .bind(JSON.stringify(next.data), next.sent == null ? cur.sent : JSON.stringify(next.sent), cur.meeting_id, cur.data, cur.sent || '').run().catch(said(`notes ${cur.meeting_id}`));
      if (r?.meta?.changes) { moved += 1; went = true; tell('board_minutes_notes', NOTES_WORDS, 1); break; }
      cur = await DB.prepare('SELECT meeting_id, data, sent FROM board_minutes_notes WHERE meeting_id = ?').bind(row.meeting_id).first().catch(() => null);
    }
    // (written over five times running by someone typing in them: not moved yet, so it's finished later)
    if (left && !went) failed.push(`notes ${row.meeting_id}`);
  }

  // (how many items they present on the agenda template before the block below moves them, for the report)
  const presenting = report ? await templatePresents(DB, from).catch(() => 0) : 0;
  // The agenda template: who presents each item. Only its presenters change, and it's a save of the template like any
  // other (./_board.js changeTemplate): written only over the settings as read, never the whole settings from a copy read
  // earlier, which undid a founder's save made meanwhile, Who runs Board included (Board QA round 7); and its time moves
  // on, saying it was this rename, so a template editor open from before meets the 409 and merges item by item, never
  // writing the old address back over it (Board QA round 8). One that can't get its write in is left for the finish note
  // (./_rename-finish.js), never the old address left in the template
  try {
    const by = byRename;
    const presenters = (template) => template.map((sec) => ({ ...sec, items: (sec.items || []).map((it) => (Array.isArray(it.who) && it.who.includes(from) ? { ...it, who: it.who.map((x) => (x === from ? to : x)) } : it)) }));
    if (await changeTemplate(DB, presenters, by)) moved += 1;
  } catch (e) { said('template')(e); }
  if (presenting) tell('board_template', TEMPLATE_WORDS, presenting - await templatePresents(DB, from).catch(() => presenting));
  if (strict && failed.length) throw Object.assign(new Error(`Board records not moved yet: ${failed.join(', ')}`), { failed });
  return moved;
}
