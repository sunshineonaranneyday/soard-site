/**
 * The secretary's notes, typed on the board page itself
 * ===========================================================================
 * Peter, Nov 4 2026: "i see the board minutes can be printed, but can they be
 * kept digitally too? by the secretary?", "word file is a down load, i am
 * talking like right in the side type thing to keep notes".
 *
 * Beside the agenda (public/admin/board/notes.js) the secretary keeps what the
 * paper form and the Word file keep: who was there, notes under each item, how
 * each vote went, the action items, when it ended. It's a draft, one row per
 * meeting, the secretary's and Board's admins' alone: no board member sees a
 * word of it until it's sent.
 *
 * The draft is one flat map, each box its own key, so saving is only the boxes
 * (and only the fields of a vote) that changed, merged by SQLite in one
 * statement (json_patch). A phone and a laptop open at once can't undo each
 * other's different boxes. On any words (a row's too), a save says what it
 * started from: words someone else has saved since are never written over, they
 * come back as a clash for the person to choose.
 *   n:<item or part id>   the notes under it
 *   r:<person's key>      present | remote | excused | absent
 *   m:<item id or v_…>    a vote: { text, by, second, for, against, abstain, result }
 *   a:<a_…>               an action item: { text, owner, due, from: the item or part it was caught under }
 *   guests, adjourned
 *   skipped               the lines someone said aren't to-dos, so they aren't offered again
 *
 * "Send the minutes" (sendNotes) puts it on the meeting by exact id, with no
 * reading or guessing, and keeps a filled-in Word file as the minutes as
 * written. Every row typed lands on the meeting, and the words Board says back
 * count what did. Sending again replaces what the last send put there (`sent`
 * knows what that was), so a fix is a fix, never a second copy of a motion;
 * what a founder changed in Board since stays theirs, and is said.
 */

import { getMeeting, patchTogether, listMeetings, getSettings, putFile, stageRewrite, fileRowOf, takeFileOff, bytesOff, roster, ID, addressesNow, boardFiles } from './_board.js';
import { namesIn } from './_member-places.js';
import { asSend, readDown } from './_board-roles.js';
import { mergeAttendance, minutesPeople } from './_board-minutes.js';
import { minutesDocx, minutesFileName, approveWords, noteLines } from '../../public/admin/board-minutes-template.js';
import { isDate, todayEastern, endedClock, minutesTarget } from '../../public/admin/board-shared.js';

export const MAX_NOTE = 20000;
export const MAX_LINE = 1000;
const MAX_NAME = 120;
const MAX_KEYS = 300;
const MAX_ROW = 900000;
const ROLL = ['present', 'remote', 'excused', 'absent'];
const RESULTS = ['passed', 'failed', 'tabled'];
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const no = (message, status) => Object.assign(new Error(message), { status });
// A send or a correction is one step (patchTogether): one that stopped before it landed left nothing done, and says so
// (round 11's words for a step refused whole). Board QA round 12, Nov 23 2026
export const NOTES_NOT_SENT = 'We couldn’t send the minutes just now, so nothing was changed. Please try again in a moment.';
const KEPT_CHANGING = 'The meeting kept changing while this was saved, so nothing was changed. Try again in a moment.';
/** A step whose Word file was made from a copy of the meeting that changed before it was written: made again */
export const AGAIN = Symbol('made again');
// (a vertical tab or a form feed from a paste is a line break, never nothing: words on either side stay apart)
const words = (v, max) => String(v ?? '').replace(/\r\n?|[\u000B\u000C]/g, '\n').replace(/[\u0000-\u0008\u000E-\u001F]/g, '').slice(0, max);
const one = (v, max) => words(v, max).replace(/\s+/g, ' ').trim();
const parse = (s) => { try { const v = JSON.parse(s || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } };
const count = (v) => { const n = Math.floor(Number(v)); return v === '' || v == null || !Number.isFinite(n) || n < 0 ? '' : Math.min(n, 999); };
const asId = (s) => String(s).slice(0, 40);
const iso = (t) => new Date(t).toISOString();
const voteOf = (key) => (key.startsWith('v_') ? key : asId(`vn_${key}`));
// The boxes a save says what it started from: words, a person's mark, the time (a vote's result the same way)
const guarded = (key) => key === 'guests' || key === 'adjourned' || key[0] === 'n' || key[0] === 'r';
/** A note the same in what it says, whatever a person's list marks or the meeting's tidying made of its edges */
const sameNote = (a, b) => noteLines(a).join('\n') === noteLines(b).join('\n');
/** The same words, whatever the capitals and spaces */
const sameWords = (a, b) => one(a, MAX_LINE).toLowerCase() === one(b, MAX_LINE).toLowerCase();
const print = (x) => JSON.stringify([one(x.text, MAX_LINE), x.by || '', x.second || '', x.result || '', x.owner || '', x.due || '', x.tally?.for ?? x.for ?? '', x.tally?.against ?? x.against ?? '']);

/** The meeting, for the secretary's seat or one of Board's admins (who the board page offers it to) */
async function meetingFor(env, id, w) {
  if (!w?.admin && w?.member?.seat !== 'secretary') throw no('Only the board’s secretary keeps the minutes here', 403);
  if (!ID.test(String(id || ''))) throw no('Which meeting?', 400);
  const m = await getMeeting(env.DB, id);
  if (!m || m.practice || m.notBoard || !(m.shared || w.admin)) throw no('That meeting isn’t on the board page', 404);
  return m;
}
/** A founder's or staff member's name from their sign-in: staff have no email on the roster, so their first name (peter@ → Peter Ranney) */
const staffName = (staff, email) => (email ? staff.find((p) => String(email).toLowerCase().startsWith(`${String(p.name).split(/\s+/)[0].toLowerCase()}@`))?.name || '' : '');
const rowOf = (DB, id) => DB.prepare('SELECT data, sent, updated_at, updated_by, took FROM board_minutes_notes WHERE meeting_id = ?').bind(id).first();
const checkinsOf = async (DB, id) => Object.fromEntries(((await DB.prepare('SELECT slug, how FROM board_checkins WHERE meeting_id = ?').bind(id).all()).results || []).map((c) => [c.slug, c.how]));

/** One box as it's kept: a key nobody's box has is refused, and an empty box is taken off (null). A vote or an action item is the fields that changed */
export function cleanChange(key, v) {
  const refused = () => { throw no('That didn’t look like the minutes', 400); };
  if (key !== 'guests' && key !== 'adjourned' && key !== 'skipped' && !/^(?:[nma]:[a-z0-9_]{3,40}|r:[^\u0000-\u001F]{1,210})$/i.test(key)) refused();
  if (v === null || v === undefined || v === '') return null;
  // The lines someone said aren't to-dos (../../public/admin/board-todos.js)
  if (key === 'skipped') return [...new Set(String(v).split('\n').map((x) => one(x, 120)).filter(Boolean))].slice(-200).join('\n') || null;
  if (key === 'guests') { const t = words(v, MAX_LINE); return t.trim() ? t : null; }
  if (key === 'adjourned') return one(v, 20) || null;
  if (key[0] === 'n') { const t = words(v, MAX_NOTE); return t.trim() ? t : null; }
  if (key[0] === 'r') return ROLL.includes(v) ? v : refused();
  if (typeof v !== 'object' || Array.isArray(v)) refused();
  const out = {};
  const put = (f, x) => { if (f in v) out[f] = x === '' ? null : x; };
  if (key[0] === 'm') {
    put('text', words(v.text, MAX_LINE));
    put('by', words(v.by, MAX_NAME));
    put('second', words(v.second, MAX_NAME));
    for (const f of ['for', 'against', 'abstain']) put(f, count(v[f]));
    put('result', RESULTS.includes(v.result) ? v.result : '');
  } else {
    put('text', words(v.text, MAX_LINE));
    put('owner', /^[a-z0-9-]{1,80}$/.test(String(v.owner || '')) ? v.owner : '');
    put('ownerName', one(v.ownerName, MAX_NAME));
    put('due', isDate(v.due) ? v.due : '');
    put('from', /^[a-z0-9_]{3,40}$/i.test(String(v.from || '')) ? v.from : '');
  }
  return out;
}

/** The items a send put words on (`on`) and those whose words have changed in Board since (`fixed`: Board's stand) */
function wordsOnMeeting(m, last) {
  const put = last.put || {};
  const left = last.left || null;
  const flat = (m.sections || []).flatMap((s) => s.items);
  return {
    on: flat.filter((it) => it.id in put && sameNote(it.notes, put[it.id])).map((it) => it.id),
    fixed: flat.filter((it) => (it.id in put ? !sameNote(it.notes, put[it.id]) : !!left && !sameNote(it.notes, left[it.id]))).map((it) => it.id),
  };
}

/**
 * GET ?notes=<meeting>: the draft, when it was last saved and last sent, who the meeting already has as there
 * (marked on it, or checked in on the board page), and (not `quick`) the vote the agenda's minutes item asks for
 */
export async function notesFor(env, id, w, { quick = false } = {}) {
  const m = await meetingFor(env, id, w);
  const [row, checkins] = await Promise.all([rowOf(env.DB, id), checkinsOf(env.DB, id)]);
  const roll = { ...checkins };
  for (const p of m.attendance) if (p.status) roll[p.key] = p.status;
  const last = parse(row?.sent);
  const out = { notes: parse(row?.data), at: row?.updated_at || '', sent: last.at || '', roll, meetingAt: m.updatedAt || '', ...wordsOnMeeting(m, last) };
  if (!quick) {
    const target = minutesTarget(m, (await listMeetings(env.DB)).filter((x) => !x.practice));
    out.approving = approveWords(target);
    // Its own notes typed and never sent: a passed vote on it closes them, so the send says so first
    out.approvingWaiting = !!target && (await notesWaiting(env.DB)).includes(target.id);
    // …and corrections nobody has decided: the vote closes those too
    out.approvingCorrections = target && target.minutes !== 'approved' ? await (await import('./_board-corrections.js')).waitingOn(env.DB, target.id) : 0;
  }
  return out;
}

/**
 * POST { action: 'notes-save', meetingId, changes, was, wasText }: the boxes that changed, merged in one statement. `was`:
 * what each box of words started from; `wasText`: the same for a row's words. Words saved over it since by someone else
 * stay: → { at, clashes: [{ key, theirs, field }] } (`field: 'text'`: a row's words, and the whole row waits for the choice)
 */
export async function saveNotes(env, id, { changes: sentChanges, was: sentWas = null, wasText = null } = {}, w, { now = Date.now() } = {}) {
  const m = await meetingFor(env, id, w);
  if (m.minutes === 'approved') throw no('These minutes are approved, so they can’t change here', 409);
  if (!sentChanges || typeof sentChanges !== 'object' || Array.isArray(sentChanges)) throw no('What changed?', 400);
  if (Object.keys(sentChanges).length > MAX_KEYS) throw no('That’s too much to save at once', 413);
  const at = iso(now);
  if (!Object.keys(sentChanges).length) return { at, clashes: [] };
  // A person's mark and a to-do's owner at the address their person has now: a page whose roll was read before a rename
  // never keeps the old one (Board QA round 9: Sam's "Here" was lost, and the minutes said he wasn't there)
  const { changes, was, from, gone, moved } = await notesFollow(env.DB, m, sentChanges, sentWas);
  const entries = Object.entries(changes);
  const patch = Object.fromEntries(entries.map(([k, v]) => [k, cleanChange(k, v)]));
  const clashes = [];
  const asked = (map) => !!map && typeof map === 'object' && entries.some(([k]) => k in map);
  if (asked(was) || asked(wasText)) {
    const cur = parse((await rowOf(env.DB, id))?.data);
    for (const [k] of entries) {
      if (asked(wasText) && k in wasText && patch[k] && 'text' in patch[k]) {
        const theirs = one(cur[k]?.text, MAX_LINE);
        if (![].concat(wasText[k]).map((x) => one(x, MAX_LINE)).includes(theirs) && theirs !== one(patch[k].text, MAX_LINE)) { clashes.push({ key: k, theirs: cur[k]?.text ?? '', field: 'text' }); delete patch[k]; continue; }
      }
      if (!asked(was) || !(k in was)) continue;
      // What it started from, and what it tried to save with no answer back (the server may well have it)
      const started = [].concat(was[k]);
      if (guarded(k)) {
        // (a mark followed to its person's new address: what's there, else what's still at the old one)
        const theirs = (k in cur || !from[k] ? cur[k] : cur[from[k]]) ?? '';
        if (!started.map((x) => cleanChange(k, x) ?? '').includes(theirs) && theirs !== (patch[k] ?? '')) { clashes.push({ key: k, theirs }); delete patch[k]; }
      } else if (k[0] === 'm' && patch[k] && 'result' in patch[k]) {
        const theirs = cur[k]?.result ?? '';
        if (!started.map((x) => String(x ?? '')).includes(theirs) && theirs !== (patch[k].result ?? '')) { clashes.push({ key: k, theirs }); delete patch[k].result; }
      }
    }
  }
  const told = Object.keys(moved).length ? { addressesNow: moved } : {};
  if (!Object.keys(patch).length) return { at, clashes, ...told };
  // (the old address's box goes with it: nobody's now, and never left to bring them back)
  for (const k of gone) if (!(k in patch)) patch[k] = null;
  const json = JSON.stringify(patch);
  if (json.length > MAX_ROW) throw no('That’s too much to save at once', 413);
  const by = w.member?.email || w.adminEmail || '';
  // The secretary's name, the first time they type: it's who took these minutes, whoever saved last, or sits in that seat later
  const took = w.member?.seat === 'secretary' ? w.member.name || '' : '';
  // Saying a line isn't a to-do changes nothing the minutes say: sent minutes stay sent
  const quiet = entries.every(([k]) => k === 'skipped') ? 1 : 0;
  const r = await env.DB.prepare(`INSERT INTO board_minutes_notes (meeting_id, data, updated_at, updated_by, took) VALUES (?1, json_patch('{}', ?2), ?3, ?4, NULLIF(?6, ''))
    ON CONFLICT(meeting_id) DO UPDATE SET data = json_patch(data, ?2), updated_at = CASE WHEN ?7 = 1 THEN updated_at ELSE ?3 END, updated_by = ?4, took = CASE WHEN json_patch(data, ?2) = '{}' THEN NULL ELSE COALESCE(took, NULLIF(?6, '')) END WHERE length(data) + length(?2) < ?5`).bind(id, json, at, by, MAX_ROW, took, quiet).run();
  if (!((r?.meta?.changes ?? r?.changes ?? 0) > 0)) throw no('These notes have grown too long to keep here. Send what you have, then keep going in a Word file.', 413);
  return { at: quiet ? '' : at, clashes, ...told };
}

// (any rename at all: a mark the meeting's roll can't have is followed whenever its person's new address is on it)
const EVER = '1970-01-01T00:00:00.000Z';
/**
 * The notes' person keys (`r:<key>`) and to-do owners followed through People's renames (./_board.js addressesNow): an
 * address the meeting doesn't name, whose person was renamed to one it does, is theirs, whoever has the old one now (a
 * newcomer given it is never marked there in their place). A read that fails throws, a 503 in words, and nothing is saved.
 * → { changes, was, from: { newKey: oldKey }, gone: [old keys], moved: { old: new } }
 */
export async function notesFollow(DB, m, changes, was = null) {
  const slugOk = (x) => typeof x === 'string' && /^[a-z0-9-]{1,80}$/.test(x) && !namesIn(m, x);
  const asked = new Set();
  for (const [k, v] of Object.entries(changes)) {
    if (k.startsWith('r:') && slugOk(k.slice(2))) asked.add(k.slice(2));
    if (k.startsWith('a:') && v && typeof v === 'object' && slugOk(v.owner)) asked.add(v.owner);
  }
  const moved = asked.size ? await addressesNow(DB, [...asked], { since: EVER, moved: (slug) => namesIn(m, slug) }) : {};
  if (!Object.keys(moved).length) return { changes, was, from: {}, gone: [], moved };
  const out = {};
  const wasOut = was && typeof was === 'object' ? {} : was;
  const from = {};
  const gone = [];
  for (const [k, v] of Object.entries(changes)) {
    let key = k;
    let val = v;
    if (k.startsWith('r:') && moved[k.slice(2)]) {
      key = `r:${moved[k.slice(2)]}`;
      gone.push(k);
      // (the page sent the new address's box too: that one stands)
      if (key in changes) continue;
      from[key] = k;
    }
    if (k.startsWith('a:') && v && typeof v === 'object' && moved[v.owner]) val = { ...v, owner: moved[v.owner] };
    out[key] = val;
    if (wasOut && was && k in was) wasOut[key] = was[k];
  }
  if (wasOut && was) for (const [k, v] of Object.entries(was)) if (!(k in changes)) wasOut[k] = v;
  return { changes: out, was: wasOut, from, gone, moved };
}

const said = (v) => (typeof v === 'string' ? words(v, MAX_NOTE).trim() : '');
/** Guests, one to a line ("Dr. Pat Ames, CPA" is one person) */
const guestsIn = (s) => String(s || '').split(/[;\n]+/).map((x) => one(x, MAX_NAME)).filter(Boolean);
const keysWith = (notes, kind) => Object.keys(notes).filter((k) => k.startsWith(`${kind}:`));

/**
 * What the draft puts on the meeting (pure). `sent`: what the last send put there, taken back first. Whatever's been
 * changed or deleted in Board since stays as Board has it, this send and the ones after, and `kept` counts where the
 * draft says otherwise. `target`: the meeting the agenda's minutes vote is about. `checkins`: slug → how they checked
 * in on the board page.
 *   Notes go on their item by id.
 *   The roll: what the secretary marked, over what the meeting had, and who checked in. With anyone there, the board
 *     nobody marked weren't. With nobody marked and nobody checked in, the attendance is left alone.
 *   Each vote with a result is a motion, each action item with words is one: all of them, none folded into another.
 *     One with the very words of a motion already on the meeting is that motion (who moved it filled in), and a vote
 *     taken on the board page keeps its own result.
 *   `approves`: a passed vote on the agenda's minutes item, and only that, approves the meeting it's about.
 * → { next, sent, approves, kept, read, record }
 */
export function applyNotes(cur, notes, { sent = null, people = [], target = null, checkins = {}, taker = '', fileName = '', now = Date.now() } = {}) {
  const was = sent || {};
  const at = iso(now);
  let kept = 0;

  const anything = anythingIn(notes);
  // The notes, and the words each item had before notes went on it (an item's notes taken out give them back). What's
  // noted about a part itself is the part's own
  // (taken back altogether: words a correction took out come back with the rest)
  const had = { ...(was.items || {}), ...(anything ? {} : was.cleared || {}) };
  const lastPut = was.put || {};
  const put = {};
  const shown = {};
  // What each item the last send left alone had under it: words that differ now went on in Board since
  const lastLeft = was.left || null;
  const left = {};
  const lastParts = was.parts || null;
  const parts = {};
  const flat = (cur.sections || []).flatMap((s) => s.items);
  const sections = (cur.sections || []).map((s) => {
    const items = s.items.map((it) => {
      const text = said(notes[`n:${it.id}`]);
      if (it.id in lastPut && !sameNote(it.notes, lastPut[it.id])) {
        put[it.id] = lastPut[it.id];
        shown[it.id] = it.notes || '';
        if (!sameNote(text, it.notes)) kept += 1;
        return it;
      }
      if (lastLeft && !(it.id in lastPut) && !sameNote(it.notes, lastLeft[it.id])) {
        left[it.id] = lastLeft[it.id] ?? '';
        shown[it.id] = it.notes || '';
        if (text && !sameNote(text, it.notes)) kept += 1;
        return it;
      }
      if (text) { if (!(it.id in had)) had[it.id] = it.notes || ''; put[it.id] = text; shown[it.id] = text; return { ...it, notes: text }; }
      if (it.id in had) { const back = had[it.id]; delete had[it.id]; left[it.id] = back; return { ...it, notes: back }; }
      left[it.id] = it.notes || '';
      return it;
    });
    const part = said(notes[`n:${s.id}`]);
    // A part's own notes changed since the last send (a founder's Word file): theirs stand, the same as an item's
    if (lastParts && !sameNote(s.notes, lastParts[s.id])) {
      parts[s.id] = lastParts[s.id] ?? '';
      if (s.notes) shown[s.id] = s.notes;
      if (part && !sameNote(part, s.notes)) kept += 1;
      return { ...s, items };
    }
    if (part) shown[s.id] = part;
    parts[s.id] = part;
    return { ...s, items, notes: part };
  });

  // Who was there: everyone on the meeting (the board as People has it when it has no list), as it was before the last send
  const noList = !(cur.attendance || []).some((p) => p.kind === 'board');
  const everyone = noList ? [...(cur.attendance || []), ...people.filter((p) => p.kind === 'board').map((p) => ({ key: p.slug, slug: p.slug, name: p.name, org: p.org || '', kind: 'board', status: '', rsvp: '' }))] : cur.attendance || [];
  const lastExtra = new Set(was.extra || []);
  const lastRollWas = was.rollWas || {};
  const lastRollPut = was.rollPut || {};
  const inBoard = new Set();
  const list = everyone.filter((p) => !lastExtra.has(p.key)).map((p) => {
    if (!(p.key in lastRollWas)) return p;
    if ((p.status || '') !== (lastRollPut[p.key] ?? '')) { inBoard.add(p.key); return p; }
    return { ...p, status: lastRollWas[p.key] };
  });
  // (everything cleared and sent takes the last send back, marks with it)
  const marked = new Map(anything ? keysWith(notes, 'r').map((k) => [k.slice(2), notes[k]]).filter(([, s]) => ROLL.includes(s)) : []);
  // A guest typed who's on the roll is that person, there
  const guests = [];
  for (const g of guestsIn(notes.guests)) {
    const p = list.find((x) => x.name.toLowerCase() === g.toLowerCase()) || people.find((x) => x.name.toLowerCase() === g.toLowerCase());
    if (!p) { if (!guests.some((x) => x.toLowerCase() === g.toLowerCase())) guests.push(g); continue; }
    if (!marked.has(p.key || p.slug)) marked.set(p.key || p.slug, 'present');
  }
  // Whoever took the minutes was there, unless they said otherwise. Settled by the first send: a correction never changes it.
  // (with nobody at all marked or checked in, the list is left as it is, the person keeping it with the rest)
  const keeperKey = was.at ? was.keeper || '' : list.find((p) => p.name === taker)?.key || '';
  const keeper = keeperKey && (marked.size > 0 || list.some((p) => p.status || checkins[p.slug])) ? list.find((p) => p.key === keeperKey) : null;
  if (keeper && !marked.has(keeper.key) && !keeper.status) marked.set(keeper.key, 'present');
  // Corrected in Board since: what Board has stands
  for (const key of inBoard) {
    const p = list.find((x) => x.key === key);
    if (marked.has(key) && marked.get(key) !== (p?.status || '')) kept += 1;
    marked.delete(key);
  }
  const person = (p, status) => ({ ...(p.slug ? { slug: p.slug } : {}), name: p.name, org: p.org || '', kind: ['staff', 'guest'].includes(p.kind) ? p.kind : 'board', status });
  const read = [];
  for (const p of list) { const status = marked.get(p.key) || p.status || checkins[p.slug] || ''; if (status) read.push(person(p, status)); }
  // (a mark for nobody on the list or on People is never dropped without a word: `unplaced`, and the send says so. Round 9)
  const unplaced = [];
  for (const [key, status] of marked) {
    if (list.some((x) => x.key === key)) continue;
    const p = people.find((x) => x.slug === key);
    if (p) read.push(person(p, status)); else if (status !== 'absent') unplaced.push({ key, status });
  }
  const touched = marked.size > 0 || list.some((p) => !p.status && checkins[p.slug]);
  const merged = touched ? mergeAttendance({ ...cur, attendance: list }, { attendance: read }, { keepMarked: false }) : list;
  const attendance = [...merged, ...guests.filter((name) => !merged.some((p) => p.key === `guest:${name.toLowerCase()}`)).map((name) => ({ key: `guest:${name.toLowerCase()}`, name, org: '', kind: 'guest', status: 'present', rsvp: '' }))];
  const rollWas = {};
  const rollPut = {};
  for (const p of list) {
    const after = attendance.find((x) => x.key === p.key);
    if (inBoard.has(p.key)) { rollWas[p.key] = lastRollWas[p.key]; rollPut[p.key] = lastRollPut[p.key]; } else if (after && (after.status || '') !== (p.status || '')) { rollWas[p.key] = p.status || ''; rollPut[p.key] = after.status || ''; }
  }

  // The votes. Each row this draft put on stays known as its own, whatever becomes of it in Board
  const items = new Map(flat.map((it) => [it.id, it]));
  const textOf = (id, v) => { const it = items.get(id); return it?.live === 'minutes' ? approveWords(target) : one(it?.motion, MAX_LINE) || one(v?.text, MAX_LINE); };
  const wrote = keysWith(notes, 'm').map((k) => [k.slice(2), notes[k]]);
  const typedIds = new Set(wrote.map(([id]) => voteOf(id)));
  const ours = new Set(was.motions || []);
  const prints = was.votePrints || {};
  const editedVote = (x) => ours.has(x.id) && prints[x.id] !== print(x);
  const motions = (cur.motions || []).filter((x) => (ours.has(x.id) ? editedVote(x) : !typedIds.has(x.id)));
  const before = [...motions];
  const onMeeting = new Set((cur.motions || []).map((x) => x.id));
  const sentVotes = [];
  const votePrints = {};
  for (const [id, v] of wrote) {
    const text = textOf(id, v);
    const rowId = voteOf(id);
    const same = before.find((y) => y.id !== rowId && sameWords(y.text, text));
    // (a vote the board took keeps its result; so does one the notes only name who moved)
    const taken = same && (same.tally?.at || id.startsWith('t_')) ? same : null;
    if (!text || (!RESULTS.includes(v?.result) && !taken)) continue;
    const tallied = [v.for, v.against, v.abstain].some((n) => typeof n === 'number');
    const x = { id: rowId, text, by: one(v.by, MAX_NAME), second: one(v.second, MAX_NAME), result: v.result, voice: false, tally: tallied ? { for: Number(v.for) || 0, against: Number(v.against) || 0, abstain: Number(v.abstain) || 0, of: 0, at: '' } : null };
    // Changed or deleted in Board since it went on: as Board has it, and it stays known as this draft's
    if (ours.has(rowId) && (!onMeeting.has(rowId) || motions.some((y) => y.id === rowId))) {
      const row = motions.find((y) => y.id === rowId);
      sentVotes.push(rowId);
      votePrints[rowId] = prints[rowId];
      if (!row || print(row) !== print(x)) kept += 1;
      continue;
    }
    if (same) {
      // Already on the meeting: that motion, who moved it filled in. The board page's own vote keeps its result
      motions[motions.indexOf(same)] = { ...same, by: x.by || same.by, second: x.second || same.second, ...(taken ? {} : { result: x.result, tally: x.tally || same.tally }) };
      continue;
    }
    motions.push(x);
    sentVotes.push(rowId);
    votePrints[rowId] = print(x);
  }

  // The record says what the meeting says: each agenda vote under its item, every other motion after, however it came to be there
  const onRecord = (row) => ({ ...row, for: row.tally?.for, against: row.tally?.against, abstain: row.tally?.abstain });
  const votes = {};
  const placed = new Set();
  for (const it of flat) {
    const text = it.live === 'minutes' ? approveWords(target) : one(it.motion, MAX_LINE);
    if (!text) continue;
    const row = motions.find((y) => y.id === voteOf(it.id)) || motions.find((y) => sameWords(y.text, text));
    if (row && !placed.has(row.id)) { votes[it.id] = onRecord(row); placed.add(row.id); }
  }
  const floor = motions.filter((x) => !placed.has(x.id)).map(onRecord);

  // The action items, the same way
  const ownerOf = (v) => {
    const p = people.find((x) => x.slug === v.owner) || list.find((x) => x.slug === v.owner);
    return { owner: p?.slug || (v.ownerName ? v.owner || '' : ''), ownerName: p?.name || one(v.ownerName, MAX_NAME) };
  };
  const wroteActions = keysWith(notes, 'a').map((k) => [k.slice(2), notes[k]]).filter(([, v]) => one(v?.text, MAX_LINE));
  const actionIds = new Set(wroteActions.map(([id]) => id));
  const oursA = new Set(was.actions || []);
  const printsA = was.actionPrints || {};
  const editedAction = (x) => oursA.has(x.id) && printsA[x.id] !== print(x);
  const actions = (cur.actions || []).filter((x) => (oursA.has(x.id) ? editedAction(x) : !actionIds.has(x.id)));
  const beforeA = [...actions];
  const onMeetingA = new Set((cur.actions || []).map((x) => x.id));
  const sentActions = [];
  const actionPrints = {};
  for (const [id, v] of wroteActions) {
    const x = { id, text: one(v.text, MAX_LINE), ...ownerOf(v), due: isDate(v.due) ? v.due : '', done: false, doneOn: '', ...(v.from ? { from: v.from } : {}) };
    if (oursA.has(id) && (!onMeetingA.has(id) || actions.some((y) => y.id === id))) {
      const row = actions.find((y) => y.id === id);
      sentActions.push(id);
      actionPrints[id] = printsA[id];
      if (!row || print(row) !== print(x)) kept += 1;
      continue;
    }
    if (beforeA.some((y) => y.id !== id && sameWords(y.text, x.text))) continue;
    actions.push(x);
    sentActions.push(id);
    actionPrints[id] = print(x);
  }

  const minutesItem = flat.find((it) => it.live === 'minutes');
  const fromBefore = 'fromBefore' in was ? was.fromBefore : cur.minutesFrom || null;
  return {
    // (`ai`: nothing to read again: the heartbeat goes back only to minutes the model hasn't read, and these were never read)
    // (`first`: when they first went in; a correction later is its own date, and never takes that one's place)
    next: { ...cur, sections, attendance, motions, actions, minutesFrom: anything ? { name: one(fileName, 200), at, ai: true, tries: 0, typed: true, first: was.at ? cur.minutesFrom?.first || was.at : at } : fromBefore },
    sent: {
      at, items: had, put, left, parts, rollWas, rollPut, fromBefore, keeper: keeperKey, ...(was.cleared ? { cleared: was.cleared } : {}),
      // Everyone this draft added to the meeting's list, guests or not
      extra: attendance.filter((x) => !list.some((p) => p.key === x.key)).map((x) => x.key),
      motions: sentVotes, votePrints, actions: sentActions, actionPrints,
    },
    approves: target && minutesItem && votes[minutesItem.id]?.result === 'passed' ? target.id : '',
    kept,
    unplaced,
    read: { notes: Object.keys(shown).length, motions: motions.length, actions: actions.length },
    // What the Word file says: the same as the meeting, never what was only typed
    record: {
      words: shown, votes, floor, adjourned: notes.adjourned || endedClock(cur),
      guests: attendance.filter((p) => p.kind === 'guest' && (p.status === 'present' || p.status === 'remote')).map((p) => p.name),
      actions: actions.map((a) => ({ text: a.text, who: a.ownerName || '', due: a.due || '' })),
    },
  };
}

/** Whether there's anything in the draft to send: a box filled in, a person marked, a vote or an action item */
export const anythingIn = (notes) => Object.entries(notes).some(([k, v]) => {
  if (k === 'guests') return true;
  if (k[1] !== ':') return false;
  if (k[0] === 'm') return !!v?.result;
  if (k[0] === 'a') return !!one(v?.text, MAX_LINE);
  return k[0] === 'r' ? v !== 'absent' : true;
});

/** The notes with one box changed (nothing in it: the box is gone) */
export function withBox(notes, key, value) {
  const out = { ...(notes || {}) };
  if (value === '' || value === null || value === undefined) delete out[key]; else out[key] = value;
  return out;
}
/** The JSON path to a box of the notes, whatever a person's key holds */
export const boxPath = (key) => `$."${String(key).replace(/(["\\])/g, '\\$1')}"`;
/** One thing at a time writes a meeting's kept notes: a send, or a correction. → whether this one holds it */
export async function claimSending(DB, id, now = Date.now()) {
  const claim = await DB.prepare('UPDATE board_minutes_notes SET sending = ?1 WHERE meeting_id = ?2 AND (sending IS NULL OR sending < ?3)').bind(iso(now), id, iso(now - 60000)).run();
  return (claim?.meta?.changes ?? claim?.changes ?? 0) > 0;
}
export const releaseSending = (DB, id) => DB.prepare('UPDATE board_minutes_notes SET sending = NULL WHERE meeting_id = ?').bind(id).run();

/** Anything at all typed in a box, whether or not it can go in yet */
const typedIn = (notes) => Object.entries(notes).some(([k, v]) => k !== 'skipped' && (v && typeof v === 'object' ? Object.values(v).some((x) => x !== null && x !== '') : !!v && v !== 'absent'));

/**
 * What the pages say about typed notes: `waiting`, the meetings with notes typed that never went on them (for the
 * secretary, the admins, and Board's approve); `typedBy`, who typed each meeting's sent minutes, as its last send kept it
 */
export async function notesState(DB) {
  const rows = (await DB.prepare('SELECT meeting_id, data, sent, updated_at FROM board_minutes_notes').all()).results || [];
  return {
    waiting: rows.filter((r) => { const sentAt = parse(r.sent).at; return typedIn(parse(r.data)) && (!sentAt || (r.updated_at || '') > sentAt); }).map((r) => r.meeting_id),
    typedBy: Object.fromEntries(rows.flatMap((r) => { const by = parse(r.sent).by; return by ? [[r.meeting_id, by]] : []; })),
  };
}
export const notesWaiting = async (DB) => (await notesState(DB)).waiting;

/**
 * POST { action: 'notes-send', meetingId }: the draft on the meeting, and a filled-in Word file kept as the minutes as
 * written (made first: when storage fails, nothing has changed and they can send again). As secretarySends, only on
 * the meeting's day or after, and a board member gets back what went in, never the meeting as Board keeps it. Sent
 * empty after an earlier send, it takes that send back off the meeting. Only one send of a meeting's notes at a time.
 * → { read: { attendance, notes, motions, actions, ai }, approvedPrev, sent, kept, cleared }
 */
export async function sendNotes(env, id, w, { now = Date.now() } = {}) {
  let claimed = false;
  let landed = false;
  // Made before the step and taken back should it not land: this send's Word file (its bytes kept, its row going in with
  // the rest), and the Word file of the minutes its vote approves, brought up to what they say
  let staged = null;
  let fresh = null;
  const drop = async () => { await staged?.drop(); await fresh?.drop(); staged = null; fresh = null; };
  try {
    const held = await meetingFor(env, id, w);
    // (a meeting the chair ended ahead of its date has been held)
    if (!isDate(held.date) || (held.date > todayEastern(now) && !held.live?.endedAt)) throw no('The minutes come in on the day of the meeting or after', 400);
    if (held.minutes === 'approved') throw no('These minutes are approved, so they can’t change here', 409);
    const nothing = (x) => !anythingIn(parse(x?.data)) && !parse(x?.sent).at;
    if (nothing(await rowOf(env.DB, id))) throw no('Nothing is typed yet', 400);
    if (!await claimSending(env.DB, id, now)) throw no('These are being sent right now. Give it a moment.', 409);
    claimed = true;
    for (let tries = 1; ; tries++) {
      // (read with the claim held: a send or a correction that finished a moment ago is what this goes from)
      const m = await getMeeting(env.DB, id);
      const row = await rowOf(env.DB, id);
      if (!m) throw no('That meeting is gone', 404);
      if (m.minutes === 'approved') throw no('These minutes are approved, so they can’t change here', 409);
      if (nothing(row)) throw no('Nothing is typed yet', 400);
      // Marks and to-dos at the addresses their people have now (a page that saved them before a rename reached it, or a
      // draft from before saves followed them), kept that way in the draft too, so the old address is nobody's for good
      const typedNotes = parse(row?.data);
      const followed = await notesFollow(env.DB, m, typedNotes);
      const notes = followed.changes;
      if (followed.gone.length) {
        await env.DB.prepare('UPDATE board_minutes_notes SET data = ? WHERE meeting_id = ? AND data = ?').bind(JSON.stringify(notes), id, row.data).run().catch((e) => console.error('[board] notes followed', e?.message || e));
      }
      const lastSent = parse(row?.sent);
      const anything = anythingIn(notes);
      // The Word file the last send kept goes with this send (while it's still the send's: sendsFile), its row read now and
      // taken off in the same step: never left naming the minutes as they were, or bytes that are gone (Board QA round 12,
      // Nov 23 2026: its delete came after the step and failed quietly, and the board page listed the old words, or a file
      // that opened 404, or withdrawn minutes)
      const old = lastSent.fileId ? await fileRowOf(env.DB, lastSent.fileId) : null;
      // (People not answering: nothing is sent, said so: never a file or an email naming nobody, round 10)
      const [people, meetings, settings, seats, checkins] = await Promise.all([minutesPeople(env.DB), listMeetings(env.DB), getSettings(env.DB), roster(env.DB, { withEmails: true }), checkinsOf(env.DB, id)])
        .catch((e) => { throw asSend(e); });
      const target = minutesTarget(m, meetings.filter((x) => !x.practice));
      const by = w.member?.email || w.adminEmail || '';
      const fileName = minutesFileName(m);
      // Who took them is settled by the first send: fixing a word later, in whoever's hands, doesn't change it
      const taker = lastSent.at ? lastSent.taker || '' : row.took || '';
      const opts = { sent: lastSent, people, target, checkins, taker, fileName, now };
      let tookBy = '';
      let approving = null;
      if (anything) {
        const seen = applyNotes(m, notes, opts);
        // A mark for someone not on this meeting's list or on People, after following renames: named, and nothing goes,
        // never the minutes saying whoever it was for wasn't there
        if (seen.unplaced.length) throw Object.assign(no(await unplacedWords(env.DB, seen.unplaced), 409), { extra: { unplaced: seen.unplaced.map((x) => `r:${x.key}`) } });
        // The secretary, once they've typed anything; else whoever kept them, who isn't always who pressed Send (nobody known: nobody named)
        const typedBy = [...seats.board, ...seats.staff].find((p) => p.email && String(p.email).toLowerCase() === String(row.updated_by || '').toLowerCase());
        tookBy = 'by' in lastSent ? lastSent.by : row.took || typedBy?.name || staffName(seats.staff, row.updated_by) || '';
        const bytes = minutesDocx(seen.next, { meetings, quorum: settings.quorum, people, filled: { ...seen.record, by: tookBy } });
        // (a founder made the last one staff-only: this one stays that way)
        const staffOnly = !!m.files.find((f) => f.id === lastSent.fileId)?.staffOnly;
        // (its bytes kept now; its row goes in with the rest, below)
        staged = await putFile(env, { ownerType: 'meeting', ownerId: id, file: new File([bytes], fileName, { type: DOCX }), kind: 'minutes', by, staffOnly, stage: true });
        // The minutes this vote approves are approved as a Word file that says what they say: brought up to them first,
        // in the same step (Board QA round 12, Nov 23 2026: a correction stood while its Word file kept the old words, and
        // this vote approved that file as the minutes)
        approving = seen.approves && seen.approves !== lastSent.approved ? meetings.find((x) => x.id === seen.approves && x.minutes !== 'approved') || null : null;
        if (approving) fresh = await freshMinutesFile(env, approving, { people, meetings, settings, now });
      }

      // All of it in one step, or none of it (Board QA round 11, Nov 23 2026: the notes went on the meeting, then a read
      // failed, and the last minutes' approval, the send's record and the Word file the meeting named were lost or deleted):
      // the notes on the meeting, the approval the vote decides (passed approves the meeting it's about; a vote corrected
      // takes back the approval the last send made), the Word file in place of the last one, the approved minutes' own
      // Word file brought up, and the send's record. Everything it goes by is read first; each meeting is written only
      // over the copy read for it (./_board.js patchTogether), and the Word files are made from those very copies
      let done = null;
      let approved = '';
      let undone = 0;
      let withdrawn = false;
      let freshIn = false;
      let replaced = false;
      const others = [...new Set([target?.id, lastSent.approved].filter((x) => x && x !== id))];
      let r;
      try {
        r = await patchTogether(env.DB, [id, ...others], ([cur, ...rest]) => {
          if (!cur) throw no('That meeting is gone', 404);
          if (cur.minutes === 'approved') throw no('These minutes are approved, so they can’t change here', 409);
          // (changed since its Word file was made from it: made again)
          if (staged && (cur.updatedAt || '') !== (m.updatedAt || '')) throw AGAIN;
          const of = (x) => rest[others.indexOf(x)] || null;
          done = applyNotes(cur, notes, opts);
          const writes = [[cur, done.next]];
          approved = '';
          undone = 0;
          withdrawn = false;
          freshIn = false;
          if (done.approves) {
            const t = of(done.approves);
            // Approved by the last send and put back to draft in Board since: Board's word stands, and is said
            if (lastSent.approved === done.approves) { approved = done.approves; if (t?.minutes !== 'approved') undone = 1; } else if (t && t.minutes !== 'approved') {
              // (approved only as the copy its Word file was brought up from)
              if (t.id !== approving?.id || (t.updatedAt || '') !== (approving.updatedAt || '')) throw AGAIN;
              writes.push([t, { ...t, minutes: 'approved', approvedOn: isDate(m.date) ? m.date : todayEastern(now) }]);
              approved = t.id;
              freshIn = !!fresh;
            }
          }
          if (lastSent.approved && lastSent.approved !== approved) {
            const t = of(lastSent.approved);
            // (only the approval taken back, on the meeting as it is: never a copy of it read before)
            if (t?.minutes === 'approved') { writes.push([t, { ...t, minutes: 'draft', approvedOn: '' }]); withdrawn = true; }
          }
          // (what was sent, to bring the kept Word file up to a founder's fixes without what's only typed since)
          const keeps = anything ? JSON.stringify({ ...done.sent, fileId: staged.id, approved, taker, by: tookBy, notes }) : null;
          // (taken back off, nobody took these minutes: the next to type them does)
          const record = { sql: `UPDATE board_minutes_notes SET sent = ?${anything ? '' : ', took = NULL'} WHERE meeting_id = ?`, bind: [keeps, id] };
          // The last send's Word file goes only while it's still the send's: one a founder has filed under Other, put on an
          // item or renamed since is theirs and stays (Board QA round 13, Nov 24 2026: the next send deleted it however
          // Board had kept it, and an item kept naming a file that was gone). Taken off as every file is (takeFileOff):
          // its row, its bytes and every item that names it, in this one step, and only while it's still as read
          const ours = old ? sendsFile(cur, lastSent) : null;
          const off = ours ? takeFileOff(done.next, lastSent.fileId, old, { only: { kind: 'minutes', name: ours.name } }) : null;
          if (off?.next) writes[0] = [cur, off.next];
          replaced = !!ours;
          return { writes, also: [...(staged ? [staged.insert] : []), ...(off ? off.also : []), ...(freshIn ? fresh.also : []), record] };
        }, { by });
      } catch (err) {
        await drop();
        if (err === AGAIN && tries < 3) continue;
        throw err === AGAIN ? no(KEPT_CHANGING, 409) : err;
      }
      landed = true;
      // In: the meeting names its Word file now, so nothing here takes it back off. The last send's file and the approved
      // minutes' old words: their bytes go, now that no row names them (one that doesn't is the heartbeat's)
      const brought = freshIn ? fresh : null;
      if (!freshIn) await fresh?.drop();
      staged = null;
      fresh = null;
      if (replaced) await bytesOff(env, [old.r2_key]);
      await brought?.done();
      const board = r.meetings[id].attendance.filter((p) => p.kind === 'board');
      return {
        sent: anything ? done.sent.at : '',
        cleared: !anything,
        approvedPrev: !!approved && approved !== lastSent.approved,
        withdrawn,
        kept: done.kept + undone,
        read: {
          attendance: { here: board.filter((p) => p.status === 'present' || p.status === 'remote').length, of: board.length },
          ...done.read, ai: false,
        },
      };
    }
  } catch (err) {
    // Nothing went in: the Word files' bytes made for it go too (no row names them), and a database that didn't answer
    // is said in words, never "something went wrong" over a step that left nothing done
    if (landed) throw err;
    await drop();
    throw err?.status ? err : readDown(NOTES_NOT_SENT, err);
  } finally {
    if (claimed) await releaseSending(env.DB, id).catch((err) => console.error('[board-notes] the send claim', id, err?.message || err));
  }
}

const HOW_SAID = { present: 'Here', remote: 'on video', excused: 'Excused' };
/** "Sam Ortiz is marked Here in your notes, but isn’t on this meeting’s list…": who, by the name they last had on People */
async function unplacedWords(DB, list) {
  const named = [];
  for (const x of list) {
    const r = await DB.prepare("SELECT entity_name FROM audit_log WHERE entity_type = 'team' AND entity_slug = ? AND entity_name IS NOT NULL ORDER BY id DESC LIMIT 1").bind(x.key).first().catch(() => null);
    named.push(`${r?.entity_name || `“${x.key}”`} (${HOW_SAID[x.status] || x.status})`);
  }
  const who = named.length > 1 ? `${named.slice(0, -1).join(', ')} and ${named.at(-1)}` : named[0];
  return `${who} ${named.length > 1 ? 'are' : 'is'} marked in your notes but ${named.length > 1 ? 'aren’t' : 'isn’t'} on this meeting’s list, so the minutes weren’t sent. Mark them on the list again, or take that mark out, then send.`;
}

// ─── The Word file a send kept, saying what the minutes say ─────────
//
// Board QA round 12, Nov 23 2026: a correction was made and the founder told "Made. The minutes say that now.", while
// the Word file the board opens kept the old words (its rewrite came after, and failed quietly), and the next meeting's
// vote approved that file as the minutes. The file is made before the step that changes what it says, from the very copy
// that step writes over, and goes in with it: the correction, or the approval, and its file land together or not at all.

/** JSON's merge patch, as SQLite's json_patch writes it (a null takes a field off): a record as a statement will leave it */
export function mergePatch(target, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = target && typeof target === 'object' && !Array.isArray(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) { if (v === null) delete out[k]; else out[k] = mergePatch(out[k], v); }
  return out;
}
/**
 * Whether a meeting has a Word file a send kept (`last`: its notes' record of that send): typed minutes, with that file
 * still theirs: still filed as the minutes and on none of the agenda's items. One a founder has filed under something
 * else or put on an item is theirs, and its words are never written over (Board QA round 13)
 */
export const keptFile = (m, last) => {
  const f = m?.minutesFrom?.typed && last?.fileId && last.notes ? (m.files || []).find((x) => x.id === last.fileId) : null;
  return !!f && f.kind === 'minutes' && !onItem(m, f.id);
};
const onItem = (m, id) => (m?.sections || []).some((s) => s.items.some((it) => (it.docs || []).includes(id)));
const sameName = (a, b) => String(a || '').replace(/\s+/g, ' ').trim().slice(0, 200) === String(b || '').replace(/\s+/g, ' ').trim().slice(0, 200);
/**
 * The last send's Word file, when it's still the send's to replace: the kept file (keptFile), under the name the send
 * gave it (the minutes' own record of it). One a founder has filed under something else, put on an item or renamed is
 * theirs, and stays. → the file as the meeting lists it, or null
 */
const sendsFile = (m, last) => {
  if (!keptFile(m, last)) return null;
  const f = m.files.find((x) => x.id === last.fileId);
  return sameName(f.name, m.minutesFrom?.name) ? f : null;
};
/** What else a kept Word file is made from, read first (a read that fails throws, and nothing is made). `have`: what the caller has read already */
export async function fileInputs(DB, id, have = {}) {
  const [people, meetings, settings, checkins] = await Promise.all([have.people || minutesPeople(DB), have.meetings || listMeetings(DB), have.settings || getSettings(DB), checkinsOf(DB, id)]);
  return { people, meetings, settings, checkins };
}
/**
 * The kept Word file's bytes for the meeting as it is (`m`), by what the last send put there (`last`): only what was sent
 * counts, never what's typed since, and who was there and the words under each item as the meeting has them, whatever
 * going over the notes again would make of them (the notes only say which items carry words). Pure
 */
export function minutesFileBytes(m, last, { people, meetings, settings, checkins }, now = Date.now()) {
  const seen = applyNotes(m, last.notes, { sent: last, people, target: minutesTarget(m, meetings.filter((x) => !x.practice)), checkins, taker: last.taker || '', fileName: m.minutesFrom.name, now });
  const onMeeting = new Map((m.sections || []).flatMap((s) => [[s.id, s.notes || ''], ...s.items.map((it) => [it.id, it.notes || ''])]));
  const words = Object.fromEntries(Object.keys(seen.record.words).map((k) => [k, onMeeting.get(k) ?? '']));
  const guests = m.attendance.filter((p) => p.kind === 'guest' && (p.status === 'present' || p.status === 'remote')).map((p) => p.name);
  return minutesDocx(m, { meetings, quorum: settings.quorum, people, filled: { ...seen.record, words, guests, by: last.by || '' } });
}
/** The kept Word file made again for the meeting as a step will leave it, staged for that step (./_board.js stageRewrite) → { also, drop, done } | null */
export const stageMinutesFile = (env, m, last, inputs, now = Date.now(), { unlessSame = false } = {}) => stageRewrite(env, last.fileId, minutesFileBytes(m, last, inputs, now), { unlessSame });
/**
 * The one way typed minutes' Word file follows them: made from the meeting as a step will leave it (`m`), its new bytes
 * put first under a key of their own, staged for that step's own write (the file's row moved onto them with what changes
 * the minutes: ./_board.js stageRewrite). Board's save (Mark them approved, a fix to their words), Board's approve, the
 * secretary's approving send and the heartbeat all go by it. Everything it goes by is read here, before anything is
 * written: a read or the file store that fails throws, and the step doesn't go. → { also, drop, done } | null (no kept
 * Word file, or it says that already, byte for byte)
 */
export async function minutesFileStep(env, m, { now = Date.now(), last = null, ...have } = {}) {
  if (!m?.minutesFrom?.typed) return null;
  const sent = last || parse((await env.DB.prepare('SELECT sent FROM board_minutes_notes WHERE meeting_id = ?').bind(m.id).first())?.sent);
  if (!keptFile(m, sent)) return null;
  return stageMinutesFile(env, m, sent, await fileInputs(env.DB, m.id, have), now, { unlessSame: true });
}
/**
 * Typed minutes about to be approved (`t`, as read), their kept Word file brought up to what they say first, staged for
 * the approval's own step: approved minutes' file is their record, so it says what they say as it's approved (never a
 * file older than their last change). Everything it goes by is read here, before anything is written: a read that fails
 * throws, and nothing is approved. The step approves only the copy it was made from (`t.updatedAt`).
 * → { also, drop, done } | null (no kept Word file to bring up, or it says that already)
 */
export async function freshMinutesFile(env, t, opts = {}) {
  if (!t?.minutesFrom?.typed || t.minutes === 'approved') return null;
  return minutesFileStep(env, t, opts);
}

/**
 * The Word file a send kept, brought up to what the meeting says now, in one step with nothing else (its new bytes made
 * first, the row moved onto them only over the meeting they were made from: one saved since brings it up itself). The
 * heartbeat's (maybeBringUpMinutesFiles), for anything that wrote the minutes without it: every person's save carries
 * the file in its own write (./_board.js saveMeeting). → whether it was brought up
 */
export async function refreshMinutesFile(env, id, { now = Date.now(), ...have } = {}) {
  const last = parse((await env.DB.prepare('SELECT sent FROM board_minutes_notes WHERE meeting_id = ?').bind(id).first())?.sent);
  if (!last.fileId || !last.notes) return false;
  const m = await getMeeting(env.DB, id);
  if (!keptFile(m, last)) return false;
  const staged = await minutesFileStep(env, m, { now, last, ...have });
  if (!staged) return false;
  const guard = " AND (SELECT COUNT(*) FROM board_meetings WHERE id = ? AND COALESCE(updated_at, '') = ?) = 1";
  let r;
  try {
    r = await env.DB.batch(staged.also.map((s) => env.DB.prepare(`${s.sql}${guard}`).bind(...s.bind, id, m.updatedAt || '')));
  } catch (err) { await staged.drop(); throw err; }
  const moved = r[staged.also.findIndex((s) => s.sql.startsWith('UPDATE board_files'))];
  if (!((moved?.meta?.changes ?? moved?.changes ?? 0) > 0)) { await staged.drop(); return false; }
  await staged.done();
  return true;
}

/**
 * Heartbeat: every typed minutes' Word file a send kept that's behind what its minutes say now, brought up (refreshMinutesFile:
 * nothing changes for one that says it already, byte for byte). Whatever wrote the minutes without their file (a write that
 * isn't a person's save), its file follows within minutes, and the board page's "The minutes as written" never keeps
 * words the minutes don't have. Board QA round 13, Nov 24 2026: a correction saved with the file's update failing left
 * the board reading the old words until some later save, and nothing tried again. → how many were brought up
 */
export async function maybeBringUpMinutesFiles(env, { now = Date.now(), limit = 6 } = {}) {
  if (!boardFiles(env)) return 0;
  // (meetings written in the last month: a file can only fall behind when its meeting is written. What every file is
  // made from besides its meeting, read once for all of them)
  const rows = (await env.DB.prepare(`SELECT n.meeting_id AS id FROM board_minutes_notes AS n JOIN board_meetings AS m ON m.id = n.meeting_id
    WHERE (CASE WHEN json_valid(n.sent) THEN json_extract(n.sent, '$.fileId') END) IS NOT NULL AND COALESCE(m.updated_at, '') > ? ORDER BY m.updated_at DESC LIMIT ?`).bind(new Date(now - 31 * 86400000).toISOString(), limit).all()).results || [];
  if (!rows.length) return 0;
  const [people, meetings, settings] = await Promise.all([minutesPeople(env.DB), listMeetings(env.DB), getSettings(env.DB)]);
  let n = 0;
  for (const r of rows) {
    try { if (await refreshMinutesFile(env, r.id, { now, people, meetings, settings })) n += 1; } catch (err) { console.error('[board-notes] bringing up a minutes file', r.id, err?.message || err); }
  }
  return n;
}
