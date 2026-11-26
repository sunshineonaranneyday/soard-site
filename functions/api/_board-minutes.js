/**
 * Board meetings' minutes, read into the meeting
 * ===========================================================================
 * Peter, Oct 2026: "i am not the secretary. i will upload meeting minutes with
 * all that information for you to do the attendance and fill in the minutes."
 * So a minutes file (PDF or Word) fills the meeting by itself, with nothing to
 * look over first:
 *   - who was there: the attendee table's x marks, or "Present: …",
 *     "Absent – …" lines (parseAgendaText, attendanceIn), else Workers AI
 *   - each agenda item's notes: the minutes' numbered outline
 *     (parseAgendaText), else Workers AI's reading of what each part said
 *   - the motions (who moved and seconded, passed, failed or tabled) and the
 *     action items (whose, by when): Workers AI, else the usual wording
 *     ("Motion to approve … by Alex, seconded by Sam. Motion passed.") and the
 *     minutes template's Action items, one to a line (actionsIn). The
 *     template's Motions and Action items parts never become agenda parts
 *   - whether the board approved the last meeting's minutes
 * readMinutes reads; applyMinutes (pure) puts what was read onto a meeting:
 * the minutes are the record of who was there, the agenda keeps its items and
 * their documents, each taking its notes from the minutes. readMinutesInto is
 * the admin's upload (POST /api/board-admin read-minutes). Board's email reader
 * (./_board-mail.js) uses the same two for
 * minutes that come in by themselves, leaving attendance a person marked as it is.
 * Without Workers AI (or when it fails) the rules alone read them; never throws.
 */

import { fileText, attendanceIn, dateIn } from './_board-mail.js';
import { getMeeting, patchMeeting, listMeetings, roster, boardFiles, updateFile, approveMinutes, putFile, deleteFile, fileLocked, MAX_FILE, ID } from './_board.js';
import { readState, writeState } from './_board-roles.js';
import { parseAgendaText, agendaIsDraft, meetingName, shortDate, isDate, uid, LIVE_TITLES, todayEastern, cleanMeeting, mergeMeeting, minutesHeld, approvedFileOf, FILE_KINDS, FILE_STAYS, minutesFilesOf } from '../../public/admin/board-shared.js';
import { viaGateway, aiCapped, AI_REST_MS } from './_ai.js';

const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
// How long the model may take. Read by hand (the person is waiting, Cloudflare allows 100 seconds): up to 70 seconds
// in all, most of it for the first try. On the heartbeat (`quick`): one try that fits its 30 seconds; minutes it
// didn't finish are read again later by maybeFinishMinutes
const AI_BUDGET_MS = 70000;
const AI_TRY_MS = 55000;
const QUICK_TIMEOUT_MS = 24000;
const MAX_TEXT = 24000; // characters of the minutes the model reads (about 6,000 tokens)

const plain = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const one = (s, max = 300) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const STATUSES = ['present', 'remote', 'absent', 'excused'];
const RESULTS = ['passed', 'failed', 'tabled'];

// ─── People ─────────────────────────────────────────────────────────

/** The board and staff as minutes name them: [{ slug, name, org, kind }] (the way readFileAsAgenda builds it) */
export async function minutesPeople(DB) {
  const r = await roster(DB);
  return [
    ...r.board.map((p) => ({ slug: p.slug, name: p.name, org: p.organization || '', kind: 'board' })),
    ...r.staff.map((p) => ({ slug: p.slug, name: p.name, org: 'SOARD', kind: 'staff' })),
  ];
}

/**
 * A name as minutes write it ("Alex", "Alex R.", "Alex Rivera (Rivera Builders)", "Ms. Rivera") → the person, or null.
 * Full name first; then a first name with the last name's initial; then a first or last name only one person has.
 */
export function matchPerson(name, people = []) {
  const p0 = plain(String(name || '').replace(/\([^)]*\)/g, ' ').replace(/\b(mr|mrs|ms|miss|dr)\b\.?/gi, ' '));
  if (!p0) return null;
  const list = people.map((p) => ({ p, full: plain(p.name) })).filter((x) => x.full);
  const exact = list.find((x) => x.full === p0) || list.find((x) => p0.startsWith(`${x.full} `)) || list.find((x) => ` ${p0} `.includes(` ${x.full} `));
  if (exact) return exact.p;
  const words = p0.split(' ');
  const firstOf = (x) => x.full.split(' ')[0];
  const lastOf = (x) => x.full.split(' ').at(-1);
  if (words.length === 2 && words[1].length === 1) {
    const hit = list.filter((x) => firstOf(x) === words[0] && lastOf(x).startsWith(words[1]));
    if (hit.length === 1) return hit[0].p;
  }
  if (words.length === 1) {
    const byFirst = list.filter((x) => firstOf(x) === words[0]);
    if (byFirst.length === 1) return byFirst[0].p;
    const byLast = list.filter((x) => x.full.includes(' ') && lastOf(x) === words[0]);
    if (byLast.length === 1) return byLast[0].p;
  }
  return null;
}
/** A matched person's full name, or the name as written */
const nameOf = (name, people) => matchPerson(name, people)?.name || one(name, 120);

/** The model's attendance as the meeting keeps it: the board and staff by their slug, anyone else present as a guest */
function attendanceFrom(list, people) {
  const out = new Map();
  for (const a of Array.isArray(list) ? list : []) {
    const status = STATUSES.includes(a?.status) ? a.status : '';
    const name = one(a?.name, 120);
    if (!status || !name) continue;
    const p = matchPerson(name, people);
    if (p) {
      if (!out.has(p.slug)) out.set(p.slug, { slug: p.slug, name: p.name, org: p.org || '', kind: p.kind === 'staff' ? 'staff' : 'board', status });
    } else if (status === 'present' || status === 'remote') {
      const key = `guest:${name.toLowerCase()}`;
      if (!out.has(key)) out.set(key, { name, org: '', kind: 'guest', status });
    }
  }
  return [...out.values()];
}

// ─── The usual wording, without Workers AI ──────────────────────────

const NAME = "([A-Z][\\w'’.-]*(?:\\s+[A-Z][\\w'’-]*)?)";
const MOTION_TO = new RegExp(`\\b[Mm]otion\\s+(?:was\\s+)?(?:made\\s+)?(?:by\\s+${NAME}\\s+)?to\\s+(.+?)(?:,?\\s+(?:made\\s+)?by\\s+${NAME})?(?:[,;]?\\s+(?:and\\s+)?(?:was\\s+)?second(?:ed)?(?:\\s+by\\s+${NAME})?)?\\s*[.;]?\\s*$`);
const MOVED = new RegExp(`\\b${NAME}\\s+(?:made\\s+a\\s+motion|moved)\\s+(?:to\\s+)?(.+?)(?:[,;]?\\s+(?:and\\s+)?${NAME}\\s+seconded(?:\\s+it|\\s+the\\s+motion)?|[,;]?\\s+(?:and\\s+)?(?:it\\s+was\\s+)?second(?:ed)?\\s+by\\s+${NAME})?\\s*[.;]?\\s*$`);
const resultIn = (s) => (/\b(failed|did not pass|defeated|was not approved)\b/i.test(s) ? 'failed'
  : /\btabled\b/i.test(s) ? 'tabled'
  : /\b(passed|carried|approved|unanimous(ly)?|all in favor|so moved)\b/i.test(s) ? 'passed' : '');
const cleanMotion = (s) => {
  const t = one(s, 1000).replace(/\s+(?:and\s+)?(?:it\s+)?was\s+second(?:ed)?$/i, '')
    .replace(/(?:[,;]|\s)\s*(?:and\s+)?(?:the\s+motion\s+)?(?:was\s+)?(?:passed|carried|failed|tabled)(?:\s+unanimously)?$/i, '')
    .replace(/[\s.,;:]+$/, '');
  return t ? t[0].toUpperCase() + t.slice(1) : '';
};
// Capitalized words that open a sentence but aren't anyone ("The board moved to …")
const NOT_A_NAME = /^(the|a|an|it|this|that|board|motion|meeting|everyone|all|members?|chair|someone)\b/i;
const MENTIONS_MOTION = /\b(motion|moved)\b/i;

/** The motions minutes write the usual ways, each with its result from the same sentence or the ones after it → [{ text, by, second, result }] */
export function motionsIn(text, people = []) {
  const sentences = String(text || '').replace(/\r\n?/g, '\n').split(/\n+|(?<=[.!?])\s+(?=[A-Z])/).map((s) => s.trim().replace(/^[-•*\d.)\s]+(?=[A-Za-z])/, '')).filter(Boolean);
  const who = (s) => { const t = one(s, 120); return !t || NOT_A_NAME.test(t) ? '' : nameOf(t, people); };
  const out = [];
  sentences.forEach((s, i) => {
    let m = s.match(MOTION_TO);
    let motion = null;
    if (m) motion = { text: m[2], by: m[1] || m[3] || '', second: m[4] || '' };
    else if ((m = s.match(MOVED))) motion = { text: m[2], by: m[1], second: m[3] || m[4] || '' };
    if (!motion) return;
    const said = cleanMotion(motion.text);
    if (!said || said.length < 6) return;
    // Its result: in its own sentence ("… carried unanimously"), else the next two, up to the next motion
    const after = [];
    for (const x of sentences.slice(i + 1, i + 3)) { if (MENTIONS_MOTION.test(x) && !/^(the\s+)?motion\s+(passed|carried|failed|was)/i.test(x)) break; after.push(x); }
    const result = resultIn(motion.text) || resultIn(after.join(' ')) || 'passed';
    out.push({ text: said, by: who(motion.by), second: who(motion.second), result });
  });
  return dedupe(out, (x) => x.text);
}

/**
 * The minutes template's own motions (board-minutes-template.js): an item's "Motion: …" (or the printed form's "The board
 * votes on …") with the template's record line under it, "Moved by: … Seconded by: … For: … Against: … Abstain: …
 * Passed / Failed", as the secretary filled it in. Only a motion with that record line is the template's: any other
 * "Motion …" sentence is left to the usual wording and the model. The result is the word left after the template's own
 * "Passed / Failed" pair (passed, carried, unanimous; failed, defeated; tabled), else from the counts. A record left as it
 * was printed (nothing written in) is no decision: `open`, so a model's reading can't make it one either.
 * → { motions: [{ text, by, second, result, tally? }], open: [texts] }
 */
const LIST_MARK = /^(?:[-•*▪◦]|\d{1,3}[.)]|[a-z][.)]|[ivx]{1,4}[.)])\s+/i;
const TEMPLATE_MOTION = /^(?:motion|the board votes on)\s*:?\s+(.{6,})$/i;
const RECORD = /\bmoved\s+by\b/i;
const RECORD_REST = /\b(?:for|against|abstain)\s*:|\bpassed\b|\bfailed\b|\btabled\b|\bcarried\b/i;
export function templateMotionsIn(text, people = []) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim().replace(LIST_MARK, '').trim());
  const motions = [];
  const open = [];
  const isMotionLine = (l) => TEMPLATE_MOTION.test(l) && !/^motion\s+(?:carried|passed|failed|tabled|was)\b/i.test(l);
  lines.forEach((line, i) => {
    if (!isMotionLine(line)) return;
    // Its record: the next lines up to the next motion, and only the template's (Moved by … Seconded by …)
    const window = [];
    for (const l of lines.slice(i + 1, i + 5)) { if (isMotionLine(l)) break; window.push(l); }
    const at = window.findIndex((l) => RECORD.test(l));
    if (at < 0) return;
    // A record carried onto the lines under it (the printed form has a line per field: Seconded by, the counts, the result)
    let rec = window[at];
    for (const l of window.slice(at + 1)) {
      if (!/^(?:seconded\s+by|for\b|against\b|abstain\b|passed\b|failed\b|tabled\b|carried\b|result\b|unanimous)/i.test(l)) break;
      rec = `${rec} ${l}`;
    }
    // The template's record has more than a mover: who seconded, the counts or the result
    if (!/\bseconded\s+by\b/i.test(rec) && !RECORD_REST.test(rec)) return;
    const text = cleanMotion(TEMPLATE_MOTION.exec(line)[1].replace(/^(?:i\s+)?(?:move|motion)\s+(?:to\s+|that\s+)?/i, ''));
    if (!text) return;
    const field = (name, next2) => (rec.match(new RegExp(`${name}\\s*:?\\s*(.*?)\\s*(?=${next2}|$)`, 'i'))?.[1] || '').replace(/^[_\s:]+|[_\s:]+$/g, '');
    const STOP = 'seconded\\s+by|\\bfor\\s*:|\\bagainst\\s*:|\\babstain\\b|\\bpassed\\b|\\bfailed\\b|\\btabled\\b|\\bcarried\\b';
    const by = field('moved\\s+by', STOP);
    const second = field('seconded\\s+by', STOP.replace('seconded\\s+by|', ''));
    const word = (name) => (rec.match(new RegExp(`\\b${name}\\b\\s*:?\\s*([A-Za-z]+|\\d{1,3})\\b`, 'i'))?.[1] || '');
    const count = (v) => (/^\d+$/.test(v) ? Number(v) : /^(all|unanimous(ly)?)$/i.test(v) ? 'all' : /^(none|no|nobody|zero)$/i.test(v) ? 0 : null);
    const f = count(word('for'));
    const a = count(word('against'));
    const ab = count(word('abstain'));
    // The result: what's left once the template's own "Passed / Failed" is taken out
    const said = rec.replace(/\bpassed\s*(?:\/|\s)\s*failed\b/i, ' ');
    const result = /\btabled\b/i.test(said) ? 'tabled'
      : /\b(failed|defeated|did not pass)\b/i.test(said) ? 'failed'
      : /\b(passed|carried|approved|unanimous(ly)?)\b/i.test(said) ? 'passed'
      : f === 'all' || a === 0 && typeof f === 'number' && f > 0 ? 'passed'
      : typeof f === 'number' && typeof a === 'number' && f !== a ? (f > a ? 'passed' : 'failed')
      : '';
    const blank = !by && !second && f === null && a === null && ab === null;
    if (!result) { if (blank) open.push(text); return; }
    // A name as written, or initials ("SO") when one person has them
    const initialsOf = (n) => String(n || '').split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase()).join('');
    const name = (t) => {
      if (!t || NOT_A_NAME.test(t)) return '';
      const caps = t.replace(/\./g, '').replace(/\s+/g, '');
      if (/^[A-Z]{2,3}$/.test(caps)) { const hit = people.filter((p) => initialsOf(p.name) === caps); if (hit.length === 1) return hit[0].name; }
      return nameOf(one(t, 120), people);
    };
    const counted = typeof f === 'number' && typeof a === 'number';
    motions.push({ text, by: name(by), second: name(second), result, ...(counted ? { tally: { for: f, against: a, abstain: typeof ab === 'number' ? ab : 0 } } : {}) });
  });
  return { motions, open };
}

/** An item's notes without the template's "Motion: …" and "Moved by: … Seconded by: …" lines */
export function withoutVoteLines(notes) {
  const lines = String(notes || '').split('\n');
  const plain_ = (l) => l.trim().replace(LIST_MARK, '').trim();
  const isRecord = (l) => RECORD.test(plain_(l)) && (/\bseconded\s+by\b/i.test(l) || RECORD_REST.test(l));
  return lines.filter((l, i) => !isRecord(l) && !(TEMPLATE_MOTION.test(plain_(l)) && lines[i + 1] !== undefined && isRecord(lines[i + 1]))).join('\n');
}

/** The last meeting's minutes approved: a passed motion to approve minutes, or "approved" under the minutes part of the outline */
export function approvalIn(sections = [], motions = []) {
  if (motions.some((x) => x.result === 'passed' && /\bminutes\b/i.test(x.text) && /\bapprov/i.test(x.text))) return true;
  return sections.some((s) => (/minutes/i.test(s.title) ? s.items : s.items.filter((it) => /minutes/i.test(it.title)))
    .some((it) => /\bapproved\b/i.test(`${it.title}\n${it.notes || ''}`) && !/\bnot\s+(been\s+)?approved\b|\btabled\b/i.test(`${it.title}\n${it.notes || ''}`)));
}

// ─── Workers AI ─────────────────────────────────────────────────────

const PROMPT = `You read the minutes of a board meeting of SOARD (Sunshine on a Ranney Day), a nonprofit, and write down only what the minutes say. Never guess, add or improve anything.
- attendance: each person the minutes say was present, on video or phone ("remote"), absent, or excused. [] when the minutes don't say who attended.
- motions: each motion the board voted on. "text" is what was moved as a short sentence starting with a verb ("Approve the 2027 budget"). "by" and "second" are the names as written ("" when not said). "result": "passed" when the minutes say passed, carried, approved or unanimous; "failed"; or "tabled".
- actions: each follow-up someone agreed to do after the meeting. "text" is the task as a short sentence, "owner" the person's name as written ("" when nobody is named), "due" the date it's due as YYYY-MM-DD ("" when no date is given).
- approvedPrev: true only when the minutes say the board approved the minutes of the previous meeting.`;
const TOPICS_PROMPT = `
- topics: the minutes' parts in order: "section" (the heading it's under, "" if none), "title" (the agenda item, using the agenda's wording when the minutes cover one of its items) and "points" (what was said, each a short sentence, in the minutes' own words).`;
const PERSON = { type: 'object', properties: { name: { type: 'string' }, status: { type: 'string', enum: STATUSES } }, required: ['name', 'status'] };
const MOTION = { type: 'object', properties: { text: { type: 'string' }, by: { type: 'string' }, second: { type: 'string' }, result: { type: 'string', enum: RESULTS } }, required: ['text', 'by', 'second', 'result'] };
const ACTION = { type: 'object', properties: { text: { type: 'string' }, owner: { type: 'string' }, due: { type: 'string' } }, required: ['text', 'owner', 'due'] };
const TOPIC = { type: 'object', properties: { section: { type: 'string' }, title: { type: 'string' }, points: { type: 'array', items: { type: 'string' } } }, required: ['section', 'title', 'points'] };
const schemaFor = (topics, attendance = true) => ({
  type: 'object',
  properties: {
    ...(attendance ? { attendance: { type: 'array', items: PERSON } } : {}), motions: { type: 'array', items: MOTION }, actions: { type: 'array', items: ACTION }, approvedPrev: { type: 'boolean' },
    ...(topics ? { topics: { type: 'array', items: TOPIC } } : {}),
  },
  required: [...(attendance ? ['attendance'] : []), 'motions', 'actions', 'approvedPrev', ...(topics ? ['topics'] : [])],
});

function withTimeout(p, ms) {
  let timer;
  return Promise.race([p, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); })]).finally(() => clearTimeout(timer));
}
/** The model's answer as an object, whichever shape it came back in */
function answerOf(out) {
  const r = out?.response ?? out?.choices?.[0]?.message?.content ?? out;
  if (r && typeof r === 'object' && !Array.isArray(r)) return r;
  const m = String(r || '').match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
}

const KEY_LINE = /\b(motion|moved|second(ed)?|vote[ds]?|approv\w*|action items?|follow[- ]?up|will\s+(send|reach|follow|contact|schedule|draft|prepare|share|look)|to do|task|due|deadline|present|absent|excused|attend\w*)\b/i;
/** Minutes too long for the model: the start (who was there, the first business), then every line about a motion, a vote, a task or attendance */
export function excerpt(text, max = MAX_TEXT) {
  const s = String(text || '');
  if (s.length <= max) return s;
  const head = s.slice(0, Math.floor(max / 4));
  const lines = s.slice(head.length).split('\n');
  const keep = [];
  let size = head.length;
  for (let i = 0; i < lines.length && size < max; i++) {
    if (!KEY_LINE.test(lines[i])) continue;
    const chunk = lines.slice(Math.max(0, i - 1), i + 2).join('\n').trim();
    keep.push(chunk);
    size += chunk.length + 1;
    i += 1;
  }
  return `${head}\n…\n${keep.join('\n')}`.slice(0, max);
}

/** Workers AI's reading of the minutes, or null (no model, no answer in time, nothing usable) */
async function askMinutes(env, { text, meeting, prev, people, topics, quick, attendance = true, capThrows = false }) {
  if (!env?.AI?.run) return null;
  const agenda = (meeting?.sections || []).flatMap((s) => s.items.map((it) => `${s.title ? `${s.title}: ` : ''}${it.title}`)).filter(Boolean);
  const input = [
    meeting?.date ? `This meeting: the ${meetingName(meeting)} on ${shortDate(meeting.date)}.` : '',
    prev?.date ? `The previous meeting: the ${meetingName(prev)} on ${shortDate(prev.date)}.` : '',
    people.length ? `SOARD's board and staff: ${people.map((p) => p.name).join(', ')}.` : '',
    topics && agenda.length ? `The agenda's items:\n${agenda.slice(0, 60).join('\n')}` : '',
    `The minutes:\n\n${excerpt(text)}`,
  ].filter(Boolean).join('\n\n');
  // Attendance the outline already has isn't asked for again: a shorter answer comes back sooner
  const prompt = attendance ? PROMPT : PROMPT.replace(/^- attendance:.*\n/m, '');
  const messages = [{ role: 'system', content: `${prompt}${topics ? TOPICS_PROMPT : ''}\nAnswer with JSON only.` }, { role: 'user', content: input }];
  const until = Date.now() + (quick ? QUICK_TIMEOUT_MS : AI_BUDGET_MS);
  for (const json of quick ? [true] : [true, false]) {
    const ms = Math.min(quick ? QUICK_TIMEOUT_MS : AI_TRY_MS, until - Date.now());
    if (ms < 5000) break;
    try {
      const out = await withTimeout(env.AI.run(MODEL, {
        messages, max_tokens: topics ? 3000 : attendance ? 1500 : 1000, temperature: 0,
        ...(json ? { response_format: { type: 'json_schema', json_schema: schemaFor(topics, attendance) } } : {}),
      }, viaGateway('board-minutes')), ms);
      const a = answerOf(out);
      if (a && (Array.isArray(a.motions) || Array.isArray(a.attendance) || Array.isArray(a.actions) || Array.isArray(a.topics))) return a;
    } catch (err) {
      if (capThrows && aiCapped(err)) throw err;
      console.error('[board-minutes]', err.message);
      // Out of time: another try won't fit what's left
      if (err.message === 'timeout') break;
    }
  }
  return null;
}

/** The model's parts of the minutes as sections and items with notes (each point a "- " line) */
function sectionsFrom(topics) {
  const out = [];
  for (const t of Array.isArray(topics) ? topics : []) {
    const title = one(t?.title, 200);
    const points = (Array.isArray(t?.points) ? t.points : []).map((p) => one(p, 1000)).filter(Boolean);
    if (!title && !points.length) continue;
    const head = one(t?.section, 200);
    let s = out.at(-1);
    if (!s || s.title !== head) { s = { id: uid('s_'), title: head, items: [] }; out.push(s); }
    s.items.push({ id: uid('i_'), title: title || head || 'Discussion', presenter: '', notes: points.map((p) => `- ${p}`).join('\n'), staffNote: '', confidential: false, live: '' });
  }
  return out;
}

// ─── Reading ────────────────────────────────────────────────────────

/**
 * What a minutes file says. `bytes` (read with fileText) or `text` when it's read already; `meeting` and `prev` (the
 * meeting before) tell the model which meeting it is and its agenda; `people` as minutesPeople builds them. `quick`
 * (Board's own readers, on the heartbeat): one try of the model, sooner given up on.
 * → { attendance, sections, motions, actions, approvedPrev, said: { by: 'ai' | 'rules', chars, date, start, end, location } }
 */
export async function readMinutes(env, { name = '', bytes = null, text = null, meeting = null, people = [], prev = null, quick = false, paragraphs = /\.docx$/i.test(name), capThrows = false } = {}) {
  const words = text != null ? String(text) : bytes ? await fileText(env, { name, bytes }) : '';
  if (!words.trim()) return { attendance: [], sections: [], motions: [], actions: [], approvedPrev: false, said: { by: 'rules', chars: 0, date: '', start: '', end: '', location: '' } };
  const parsed = parseAgendaText(words, people, { paragraphs });
  let attendance = parsed.attendance.length ? parsed.attendance : attendanceIn(words, people);
  // The motions and action items listed as parts of their own (the minutes template's, or minutes kept that way) are
  // read for what they are, never put on the agenda as parts; a part the agenda itself has keeps its place
  const logs = parsed.sections.filter((s) => LOG_PART.test(s.title) && !(meeting?.sections || []).some((x) => likeness(x.title, s.title) >= 0.5));
  let sections = parsed.sections.filter((s) => !logs.includes(s));
  // The template's own motions as the secretary recorded them first (exact), then any the minutes say the usual ways
  const fromTemplate = templateMotionsIn(words, people);
  const isTemplate = (t) => [...fromTemplate.motions.map((x) => x.text), ...fromTemplate.open].some((x) => likeness(x, t) >= 0.6);
  // The template's vote lines are its vote, read just above: not what was said under the item
  sections = sections.map((sec) => ({ ...sec, items: sec.items.map((it) => (it.notes ? { ...it, notes: withoutVoteLines(it.notes) } : it)) }));
  let motions = dedupe([...fromTemplate.motions, ...motionsIn(words, people).filter((x) => !isTemplate(x.text))], (x) => x.text);
  let actions = actionsIn(logs.filter((s) => ACTION_PART.test(s.title)), people, meeting?.date);
  let approvedPrev = false;
  let by = 'rules';
  // The outline read by the rules is kept as it is; the model fills in the outline only when the rules found none
  const topics = !sections.some((s) => s.items.length);
  const ai = await askMinutes(env, { text: words, meeting, prev, people, topics, quick, attendance: !attendance.length, capThrows });
  if (ai) {
    by = 'ai';
    if (!attendance.length) attendance = attendanceFrom(ai.attendance, people);
    const said = (Array.isArray(ai.motions) ? ai.motions : []).map((x) => ({
      text: cleanMotion(x?.text), by: x?.by ? nameOf(x.by, people) : '', second: x?.second ? nameOf(x.second, people) : '', result: RESULTS.includes(x?.result) ? x.result : 'passed',
    })).filter((x) => x.text);
    // The model's, beside the template's: never one the template has (recorded, or left open: not a decision)
    if (said.length) motions = dedupe([...fromTemplate.motions, ...said.filter((x) => !isTemplate(x.text))], (x) => x.text);
    const theirs = dedupe((Array.isArray(ai.actions) ? ai.actions : []).map((x) => {
      const p = x?.owner ? matchPerson(x.owner, people) : null;
      return { text: one(x?.text, 1000), owner: p?.slug || '', ownerName: p?.name || one(x?.owner, 120), due: isDate(String(x?.due || '')) ? x.due : '' };
    }).filter((x) => x.text), (x) => x.text);
    if (theirs.length) actions = theirs;
    if (topics) sections = sectionsFrom(ai.topics);
    approvedPrev = ai.approvedPrev === true;
  }
  approvedPrev = approvedPrev || approvalIn(sections, motions);
  const other = meeting ? otherMeetingIn(meeting, { text: words, name, date: parsed.date }) : null;
  return { attendance, sections, motions, actions, approvedPrev, said: { by, chars: words.length, date: parsed.date || '', start: parsed.start || '', end: parsed.end || '', location: parsed.location || '', other } };
}

const DAY_MS = 86400000;
const QUARTER = /\bQ([1-4])(?:\s*[-–]?\s*(20\d{2}))?\b/i;
/** The lines above the minutes' first part ("1. CALL TO ORDER"): their own heading, never the agenda under it */
function headingOf(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const first = lines.findIndex((l) => { const t = l.trim().match(/^\d{1,2}\.\s*(.+)$/); return !!t && t[1] === t[1].toUpperCase() && /[A-Z]{3}/.test(t[1]); });
  return lines.slice(0, first < 0 ? 12 : first).join('\n');
}
/**
 * Minutes that say they're another meeting's: the date in their heading (or file name) more than ten days from the
 * meeting's, or another quarter in their title (or file name), as when the Q3 minutes are dropped on the Q4 meeting.
 * The agenda inside them ("Minutes of the Q3 2026 Board Meeting" up for approval) never counts.
 * `date`: what parseAgendaText found in the heading. → { date, name } (either may be '') | null
 */
export function otherMeetingIn(m, { text = '', name = '', date = '' } = {}) {
  if (!m || !isDate(m.date)) return null;
  const head = headingOf(text);
  const year = Number(m.date.slice(0, 4));
  const dateLine = (head.match(/^[^\S\n]*(?:meeting\s+)?date\b[^\n]*/im) || [''])[0];
  const said = [date, dateIn(dateLine, year), dateIn(String(name).replace(/\.[a-z0-9]{2,5}$/i, ''), year)].find(isDate) || '';
  const far = said && Math.abs(Date.parse(`${said}T12:00:00Z`) - Date.parse(`${m.date}T12:00:00Z`)) > 10 * DAY_MS;
  const ours = meetingName(m).match(QUARTER);
  const theirs = String(name).match(QUARTER) || head.split('\n').slice(0, 3).join(' ').match(QUARTER);
  const otherQuarter = !!ours && !!theirs && (theirs[1] !== ours[1] || (!!theirs[2] && !!ours[2] && theirs[2] !== ours[2]));
  if (!far && !otherQuarter) return null;
  // A quarter written without its year ("Q3 minutes") is the year of the date they give, else the meeting's
  return { date: far ? said : '', name: otherQuarter ? `Q${theirs[1]} ${theirs[2] || (said ? said.slice(0, 4) : year)} Board Meeting` : '' };
}
/** "These look like the minutes of the Q3 2026 Board Meeting (Aug 6, 2026), not this meeting’s (Nov 5, 2026)" */
export function otherMeetingWords(m, other) {
  const which = [other.name, other.date ? shortDate(other.date) : ''].filter(Boolean);
  const them = which.length === 2 ? `${which[0]} (${which[1]})` : which[0] || 'another meeting';
  return `These look like the minutes of ${/^Q/.test(them) ? 'the ' : ''}${them}, not this meeting’s (${meetingName(m)}, ${shortDate(m.date)}).`;
}
// Parts that list the motions or the action items (or say when it ended) rather than an agenda's business
const LOG_PART = /^(motions?|decisions?|votes?|action items?|follow[- ]?ups?|to[- ]?dos?|adjourn\w*)\b/i;
const ACTION_PART = /^(action items?|follow[- ]?ups?|to[- ]?dos?)\b/i;

/**
 * The action items a part lists, one to a line ("Pat will send the bylaws to the board by Nov 15"): whose (the
 * person it names first, by full name or a first name only one person has) and by when (a date in it, the year
 * after the meeting's when the month has passed by then and no year is written)
 */
export function actionsIn(parts, people = [], meetingDate = '') {
  const out = [];
  for (const s of parts) {
    for (const it of s.items) {
      const text = one(it.title, 1000);
      if (!text) continue;
      const words = ` ${plain(text)} `;
      let who = null;
      for (const p of people) {
        const full = plain(p.name);
        const first = full.split(' ')[0];
        let at = words.indexOf(` ${full} `);
        if (at < 0 && first && people.filter((q) => plain(q.name).split(' ')[0] === first).length === 1) at = words.indexOf(` ${first} `);
        if (at >= 0 && (!who || at < who.at)) who = { p, at };
      }
      const year = isDate(meetingDate) ? Number(meetingDate.slice(0, 4)) : undefined;
      let due = dateIn(text, year);
      if (due && isDate(meetingDate) && due < meetingDate && !/\b20\d{2}\b/.test(text)) due = `${Number(due.slice(0, 4)) + 1}${due.slice(4)}`;
      out.push({ text, owner: who?.p.slug || '', ownerName: who?.p.name || '', due: isDate(due) ? due : '' });
    }
  }
  return dedupe(out, (x) => x.text);
}

/**
 * How many of a meeting's items the minutes put notes under (`read`: readMinutes' answer; `m`: the meeting with them
 * read in, or as it would be): each item whose notes are the minutes' own, never an item's background notes written on
 * the agenda before the meeting, which minutes with nothing under it leave as they were. The "notes under N items" a
 * read says (the founders' drop, its look first, and the secretary's send). QA round 7, Nov 21 2026: minutes with only
 * who was there said "notes under 1 item", counting the agenda's own notes
 */
export function notesRead(read, m) {
  const theirs = new Set((read?.sections || []).flatMap((s) => s.items).map((it) => String(it.notes || '').trim()).filter(Boolean));
  return (m?.sections || []).reduce((n, s) => n + s.items.filter((it) => theirs.has(String(it.notes || '').trim())).length, 0);
}

/** Whether a reading found anything to put on a meeting */
export const readSomething = (read) => !!read && (read.attendance.length > 0 || read.sections.some((s) => s.items.length) || read.motions.length > 0 || read.actions.length > 0);

// ─── Putting it on the meeting ──────────────────────────────────────

const STOP = new Set(['the', 'and', 'of', 'for', 'to', 'a', 'an', 'in', 'on', 'at', 'or', 'by', 'with', 'from', 'our', 'update', 'updates', 'report', 'reports', 'committee', 'meeting', 'board', 'soard', 'item', 'items']);
const stem = (w) => (w.length > 4 ? w.replace(/(ies|es|s)$/, (x) => (x === 'ies' ? 'y' : '')) : w);
const wordsOf = (s) => new Set(plain(String(s || '').replace(/\([^)]*\)/g, ' ')).split(' ').filter((w) => w.length > 1 && !STOP.has(w)).map(stem));
/** How alike two titles are: the share of the shorter one's words the other has (0..1) */
export function likeness(a, b) {
  const A = wordsOf(a);
  const B = wordsOf(b);
  // Titles made only of the usual words ("Committee reports") are alike when they're the same
  if (!A.size || !B.size) return plain(a) && plain(a) === plain(b) ? 1 : 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n += 1;
  return n / Math.min(A.size, B.size);
}
function dedupe(list, textOf) {
  const out = [];
  for (const x of list) if (!out.some((y) => likeness(textOf(x), textOf(y)) >= 0.8 && Math.abs(wordsOf(textOf(x)).size - wordsOf(textOf(y)).size) <= 2)) out.push(x);
  return out;
}
const similar = (a, b) => likeness(a, b) >= 0.6;
const hasItems = (m) => (m?.sections || []).some((s) => s.items.length);

/**
 * Whose outline a meeting keeps once minutes are read: 'minutes' (the agenda was empty or a draft nobody wrote, or
 * `whole`: an older reading of this same file) when they have at least `minSections` parts with items, else 'agenda'.
 */
export function shapeFrom(cur, read, { whole = false, minSections = 1 } = {}) {
  const enough = read.sections.filter((s) => s.items.length).length >= minSections;
  return enough && (whole || !hasItems(cur) || agendaIsDraft(cur)) ? 'minutes' : 'agenda';
}

/** Which agenda item each minutes item is: [[agenda {si, ii}, minutes {si, ii}]] by their titles, then their places */
function pairItems(agenda, minutes) {
  // A live list with no title of its own goes by what it shows ("Upcoming reveals"), as the board page and the minutes template name it
  const titleOf = (it) => it.title || LIVE_TITLES[it.live] || '';
  const A = agenda.flatMap((s, si) => s.items.map((it, ii) => ({ si, ii, it, sec: s, title: titleOf(it) })));
  const M = minutes.flatMap((s, si) => s.items.map((it, ii) => ({ si, ii, it, sec: s })));
  // The parts of the two that are the same (by their headings)
  const secPair = new Map();
  minutes.forEach((s, mi) => {
    const best = agenda.map((a, ai) => [ai, likeness(a.title, s.title)]).sort((x, y) => y[1] - x[1])[0];
    if (best && best[1] >= 0.5) secPair.set(mi, best[0]);
  });
  const minutesy = (x) => /minutes/i.test(`${x.sec.title} ${x.it.title}`);
  const scored = [];
  for (const a of A) {
    for (const m of M) {
      let score = likeness(a.title, m.it.title);
      if (a.it.live === 'minutes' && minutesy(m)) score = Math.max(score, 0.9);
      if (score < 0.5) continue;
      if (secPair.get(m.si) === a.si) score += 0.25;
      scored.push([score, a, m]);
    }
  }
  scored.sort((x, y) => y[0] - x[0]);
  const usedA = new Set();
  const usedM = new Set();
  const pairs = [];
  const key = (x) => `${x.si}.${x.ii}`;
  for (const [, a, m] of scored) {
    if (usedA.has(key(a)) || usedM.has(key(m))) continue;
    usedA.add(key(a)); usedM.add(key(m));
    pairs.push([a, m]);
  }
  // In the same place in the same part, when one of the titles says nothing of its own ("Update", "Discussion"):
  // two different titles in the same place are two different things (a deck must never move to another item)
  const generic = (x) => wordsOf(x.title ?? x.it.title).size === 0;
  for (const m of M) {
    if (usedM.has(key(m)) || !secPair.has(m.si)) continue;
    const a = A.find((x) => x.si === secPair.get(m.si) && x.ii === m.ii);
    if (!a || usedA.has(key(a)) || !(generic(a) || generic(m))) continue;
    usedA.add(key(a)); usedM.add(key(m));
    pairs.push([a, m]);
  }
  return { pairs, A, M, secPair, usedA, usedM, key };
}

/**
 * The agenda's own (what the minutes never say): who presents, its documents, live numbers, board-only, private
 * notes, and a committee's written report (who wrote it, when)
 */
const carried = (it) => ({ id: it.id, docs: it.docs || [], who: it.who || [], live: it.live || '', also: it.also || [], about: it.about || '', confidential: !!it.confidential, staffNote: it.staffNote || '', report: it.report || '', reportBy: it.reportBy || '', reportAt: it.reportAt || '', reportLook: it.reportLook || '', slideOrder: it.slideOrder || [], motion: it.motion || '' });
const carriesSomething = (it) => (it.docs || []).length > 0 || !!it.staffNote || !!it.report || !!it.motion;

function mergeSections(cur, read, shape) {
  const { pairs, A, M, secPair, usedA, usedM, key } = pairItems(cur.sections || [], read.sections);
  const byA = new Map(pairs.map(([a, m]) => [key(a), m]));
  const byM = new Map(pairs.map(([a, m]) => [key(m), a]));
  if (shape === 'minutes') {
    // The minutes' outline; an item that was on the agenda keeps the agenda's id and what only the agenda has
    const out = read.sections.map((s, si) => ({ id: s.id || uid('s_'), title: s.title, items: s.items.map((it, ii) => {
      const a = byM.get(`${si}.${ii}`);
      return a ? { ...it, ...carried(a.it), presenter: a.it.presenter || it.presenter || '' } : it;
    }) }));
    // An agenda item the minutes don't mention is kept only when something hangs off it (its documents, a private note)
    for (const a of A) {
      if (usedA.has(key(a)) || !carriesSomething(a.it)) continue;
      const mi = [...secPair].find(([, ai]) => ai === a.si)?.[0];
      let s = mi !== undefined ? out[mi] : out.find((x) => x.title === a.sec.title);
      if (!s) { s = { id: a.sec.id || uid('s_'), title: a.sec.title, items: [] }; out.push(s); }
      s.items.push(a.it);
    }
    return out;
  }
  // The agenda's outline, every item kept; each takes the minutes' notes for it
  const out = (cur.sections || []).map((s, si) => ({ ...s, items: s.items.map((it, ii) => {
    const m = byA.get(`${si}.${ii}`);
    if (!m) return it;
    return { ...it, notes: String(m.it.notes || '').trim() ? m.it.notes : it.notes, presenter: it.presenter || m.it.presenter || '' };
  }) }));
  // What the minutes cover that the agenda didn't: under the agenda's part with that heading, else a part of its own
  const added = new Map();
  // (a part with its own notes, read back from the Word file Board keeps: its lines are those notes, a word fixed or not, never new items)
  const partLines = new Map();
  for (const m of M) {
    if (usedM.has(key(m))) continue;
    const ai = secPair.get(m.si);
    if (ai !== undefined && String(out[ai].notes || '').trim()) {
      partLines.set(ai, [...(partLines.get(ai) || []), m.it.title, ...String(m.it.notes || '').split('\n')].filter((l) => String(l || '').trim()));
      continue;
    }
    if (ai !== undefined) { out[ai].items.push(m.it); continue; }
    if (!added.has(m.si)) { const s = { id: m.sec.id || uid('s_'), title: m.sec.title, items: [] }; added.set(m.si, s); out.push(s); }
    added.get(m.si).items.push(m.it);
  }
  for (const [ai, lines] of partLines) out[ai] = { ...out[ai], notes: lines.join('\n') };
  return out;
}

/**
 * The attendance once the minutes are read: they're the record. Each person they name gets what they say;
 * when they name anyone as there, the board members on the list they don't name were absent (an excused one
 * stays excused). Answers to "will you be there" stay. `keepMarked`: attendance someone marked is left as it
 * is (Board's own readers; the minutes then only fill a list nobody marked).
 */
export function mergeAttendance(cur, read, { keepMarked }) {
  const list = cur.attendance || [];
  if (!read.attendance.length || (keepMarked && list.some((p) => p.status))) return list;
  const keyOf = (p) => p.slug || `${p.kind || 'guest'}:${String(p.name || '').toLowerCase()}`;
  const had = new Map(list.map((p) => [keyOf(p), p]));
  const out = read.attendance.map((p) => {
    const was = had.get(keyOf(p));
    return { ...(was || {}), ...(p.slug ? { slug: p.slug } : {}), key: keyOf(p), name: was?.name || p.name, org: was?.org || p.org || '', kind: p.kind || was?.kind || 'guest', status: p.status, rsvp: was?.rsvp || '' };
  });
  const named = new Set(out.map(keyOf));
  const anyoneThere = read.attendance.some((p) => p.status === 'present' || p.status === 'remote');
  for (const p of list) {
    if (named.has(keyOf(p))) continue;
    out.push(p.kind === 'board' && anyoneThere ? { ...p, status: p.status === 'excused' ? 'excused' : 'absent' } : p);
  }
  return out;
}

/**
 * The meeting with its minutes read in (pure). `read` is readMinutes' answer. Motions voted on the board page stay,
 * and so does everything else already there; the minutes' motions and action items not already on it are added.
 * The meeting's outline is the agenda's, each item taking its notes from the minutes (or, when the agenda was a
 * draft, the minutes' own outline: see shapeFrom; `agendaFrom` names where it came from then, else it's
 * the person's). `minutesFrom` records the file.
 */
export function applyMinutes(cur, read, { fileName = '', now = Date.now(), keepMarked = false, whole = false, minSections = 1, agendaFrom = null } = {}) {
  const at = new Date(now).toISOString();
  const shape = shapeFrom(cur, read, { whole, minSections });
  const next = { ...cur, attendance: mergeAttendance(cur, read, { keepMarked }) };
  if (read.sections.some((s) => s.items.length)) next.sections = mergeSections(cur, read, shape);
  if (shape === 'minutes') next.agendaFrom = agendaFrom || { kind: 'typed', name: one(fileName, 200), at };
  const motions = [...(cur.motions || [])];
  for (const x of read.motions) if (!motions.some((y) => similar(y.text, x.text))) motions.push({ id: uid('v_'), text: x.text, by: x.by || '', second: x.second || '', result: x.result || 'passed', tally: x.tally ? { for: x.tally.for || 0, against: x.tally.against || 0, abstain: x.tally.abstain || 0, of: 0, at: '' } : null });
  next.motions = motions;
  const actions = [...(cur.actions || [])];
  for (const x of read.actions) if (!actions.some((y) => similar(y.text, x.text))) actions.push({ id: uid('a_'), text: x.text, owner: x.owner || '', ownerName: x.ownerName || '', due: x.due || '', done: false, doneOn: '' });
  next.actions = actions;
  // Whether the model read them (the motions and action items); minutes read by the rules alone are read again later
  next.minutesFrom = { name: one(fileName, 200), at, ai: read.said?.by === 'ai', tries: read.said?.by === 'ai' ? 0 : Math.min(9, (cur.minutesFrom?.name === one(fileName, 200) ? cur.minutesFrom.tries || 0 : 0) + 1), marks: 1 };
  return marked(cur, next);
}

/**
 * A short fingerprint of words as a minutes read put them (FNV-1a), for its marks: the same words, the same mark; a word
 * changed by a person since, another (./board-shared.js readMark)
 */
export const markOf = (s) => {
  let h = 0x811c9dc5;
  for (const c of String(s ?? '')) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
};
/**
 * The meeting a read made (`next`, from `cur`) with what the read put on it marked: each item's and part's notes it
 * set, each decision and action item it added, each attendance it gave. So Replace can tell what came from a read even
 * with no Undo record of it (Board's email reader, the heartbeat), and anything a person writes since is unmarked, or
 * no longer matches its mark, and stays theirs. Board QA round 8, Nov 21 2026
 */
function marked(cur, next) {
  const was = new Map((cur.sections || []).flatMap((s) => s.items.map((it) => [it.id, it])));
  const wasPart = new Map((cur.sections || []).map((s) => [s.id, s]));
  const note = (x, before) => (String(x.notes || '').trim() && (!before || before.notes !== x.notes) ? { ...x, notesRead: markOf(x.notes) } : x);
  const sections = (next.sections || []).map((s) => ({ ...note(s, wasPart.get(s.id) || { notes: '' }), items: s.items.map((it) => note(it, was.get(it.id))) }));
  const had = (list) => new Set((list || []).map((x) => x.id));
  const [motions, actions] = [had(cur.motions), had(cur.actions)];
  const roll = new Map((cur.attendance || []).map((p) => [p.key || p.slug || p.name, p]));
  return {
    ...next, sections,
    motions: (next.motions || []).map((x) => (motions.has(x.id) ? x : { ...x, read: markOf(x.text) })),
    actions: (next.actions || []).map((x) => (actions.has(x.id) ? x : { ...x, read: markOf(x.text) })),
    attendance: (next.attendance || []).map((p) => { const b = roll.get(p.key || p.slug || p.name); return p.status && (!b || b.status !== p.status) ? { ...p, readStatus: p.status } : p; }),
  };
}
/** What a person wrote, there being no marks to tell it from a read's: any notes, decisions, action items or attendance */
const anythingOn = (m) => (m.sections || []).some((s) => String(s.notes || '').trim() || s.items.some((it) => String(it.notes || '').trim()))
  || (m.motions || []).some((x) => !x.tally) || (m.actions || []).length > 0 || (m.attendance || []).some((p) => p.status);
/**
 * The meeting with what earlier minutes put on it taken off, by their marks (marked): notes still as the read put them
 * cleared, the decisions and action items it added (unchanged since) gone, the attendance it gave unset. What a person
 * wrote, or changed since, stays. For minutes with no Undo record of their read (pure)
 */
function readOff(m) {
  const mine = (x) => !!x.notesRead && markOf(x.notes) === x.notesRead;
  const clear = ({ notesRead, ...x }) => (mine({ ...x, notesRead }) ? { ...x, notes: '' } : notesRead ? { ...x, notesRead } : x);
  const ours = (x) => !!x.read && markOf(x.text) === x.read;
  return {
    ...m,
    sections: (m.sections || []).map((s) => ({ ...clear(s), items: s.items.map(clear) })),
    motions: (m.motions || []).filter((x) => !ours(x)),
    actions: (m.actions || []).filter((x) => !ours(x)),
    attendance: (m.attendance || []).map(({ readStatus, ...p }) => (readStatus && p.status === readStatus ? { ...p, status: '' } : readStatus ? { ...p, readStatus } : p)),
    // (their minutes are off: an Undo of the read that replaces them puts the meeting back to this, with none)
    minutesFrom: null,
  };
}


/**
 * Whether minutes from this file (`at`: when it was written or sent) may go onto a meeting: no minutes read into
 * it yet, the same file again, or a newer one than the minutes it has (never over ones read in by hand since).
 */
const TYPED_WORDS = 'These minutes were typed on the board page, so a file can’t go over them. Change them in the notes there.';
export function minutesNewer(cur, { name = '', at = '' } = {}) {
  // What was typed and sent is the record: it changes in the notes (readMinutesInto says the same)
  if (cur.minutesFrom?.typed) return false;
  const had = cur?.minutesFrom;
  if (!had?.name) return true;
  if (plain(had.name.replace(/\.[a-z0-9]{2,5}$/i, '')) === plain(String(name).replace(/\.[a-z0-9]{2,5}$/i, ''))) return true;
  return !!at && !Number.isNaN(Date.parse(at)) && Date.parse(at) > Date.parse(had.at || 0);
}

/** How many times the heartbeat reads minutes again for their motions and action items (maybeFinishMinutes) */
const FINISH_TRIES = 3;
/**
 * What a read of the model's would have added to minutes approved before it finished: the decisions and action items not
 * on them already, in its words ({ motions: [text], actions: [text] }), or null when it would have added nothing
 */
function lateOf(cur, read) {
  const motions = read.motions.filter((x) => !(cur.motions || []).some((y) => similar(y.text, x.text))).map((x) => one(x.text, 300));
  const actions = read.actions.filter((x) => !(cur.actions || []).some((y) => similar(y.text, x.text))).map((x) => one(x.text, 300));
  return motions.length || actions.length ? { motions, actions } : null;
}

/**
 * Minutes the heartbeat read without the model (it ran out of time): read again, one meeting every two minutes and
 * three tries each, so their motions and action items still come in. Nothing a person marked is changed, and minutes
 * approved (or signed) meanwhile are never changed at all: what it would have added is named beside them. → id | null
 */
export async function maybeFinishMinutes(env, { now = Date.now() } = {}) {
  let m = null;
  try {
    const runs = await readState(env.DB, 'runs');
    if (runs.minutesAt && now - Date.parse(runs.minutesAt) < 2 * 60 * 1000) return null;
    const meetings = await listMeetings(env.DB);
    m = meetings.filter((x) => x.minutesFrom?.name && !x.minutesFrom.ai && (x.minutesFrom.tries || 0) < FINISH_TRIES).sort((a, b) => b.date.localeCompare(a.date))[0] || null;
    if (!m) return null;
    // (who the minutes can name, read before a try is counted: People not answering costs none of its three)
    const people = await minutesPeople(env.DB);
    await writeState(env.DB, 'runs', { ...runs, minutesAt: new Date(now).toISOString() });
    // The try is counted before the read: a run cut off during the model's long answer would otherwise never count one, and read again every 2 minutes for good
    await patchMeeting(env.DB, m.id, (cur) => (cur.minutesFrom?.name === m.minutesFrom.name ? { ...cur, minutesFrom: { ...cur.minutesFrom, tries: (cur.minutesFrom.tries || 0) + 1 } } : cur));
    // (renamed since: the meeting's own minutes file, never the last meeting's on an agenda item. Round 9: Undo of a
    // Replace puts minutes back whose file is gone, and none is read for them)
    const f = m.files.find((x) => x.name === m.minutesFrom.name) || ownMinutesFiles(m).at(-1);
    const row = f && await env.DB.prepare('SELECT r2_key FROM board_files WHERE id = ?').bind(f.id).first();
    const obj = row && await boardFiles(env)?.get(row.r2_key);
    const prev = meetings.filter((x) => x.id !== m.id && !x.notBoard && isDate(x.date) && x.date < m.date).sort((a, b) => b.date.localeCompare(a.date))[0] || null;
    const read = obj ? await readMinutes(env, { name: f.name, bytes: new Uint8Array(await new Response(obj.body).arrayBuffer()), meeting: m, people, prev, quick: true, capThrows: true }) : null;
    // Approved (or signed) minutes are the record: a read that finishes after they were approved adds nothing. It's done
    // with (never read again), and what it would have added is kept beside the minutes it came from (minutesFrom.late)
    // for the founders' view to name, never on the board page. Board QA round 8, Nov 21 2026: approved minutes gained a
    // decision and an action item from the heartbeat, on the site and the board page, and nobody was told
    const signed = read ? !!(await env.DB.prepare('SELECT 1 AS y FROM board_minutes_signed WHERE meeting_id = ?').bind(m.id).first().catch(() => null)) : false;
    // (the meeting as this finishing found it and left it: the write that went is the last one patchMeeting made)
    let found = null;
    let left = null;
    await patchMeeting(env.DB, m.id, (cur) => {
      found = null;
      if (cur.minutesFrom?.name !== m.minutesFrom.name || cur.minutesFrom.ai || !read || read.said.by !== 'ai') return cur;
      if (cur.minutes === 'approved' || signed) return { ...cur, minutesFrom: { ...cur.minutesFrom, tries: FINISH_TRIES, late: lateOf(cur, read) } };
      // Only what the model adds: the motions and action items (the outline and attendance stay as they were read)
      found = cur;
      left = applyMinutes(cur, { ...read, attendance: [], sections: [] }, { fileName: cur.minutesFrom.name, now, keepMarked: true });
      return left;
    });
    if (found) await finishUndo(env.DB, m.id, found, left);
    return m.id;
  } catch (err) {
    // A cap reached: the try is given back and it waits, or its three would go in six minutes and it's never read again
    if (m && aiCapped(err)) {
      const name = m.minutesFrom.name;
      await patchMeeting(env.DB, m.id, (cur) => (cur.minutesFrom?.name === name ? { ...cur, minutesFrom: { ...cur.minutesFrom, tries: Math.max(0, (cur.minutesFrom.tries || 0) - 1) } } : cur)).catch(() => {});
      const runs = await readState(env.DB, 'runs').catch(() => ({}));
      await writeState(env.DB, 'runs', { ...runs, minutesAt: new Date(now + AI_REST_MS).toISOString() }).catch(() => {});
      return null;
    }
    console.error('[board-minutes] finishing', err.message);
    return null;
  }
}

// ─── The admin's upload ─────────────────────────────────────────────

/**
 * Minutes marked approved, with minutes in Board (../../public/admin/board-shared.js minutesHeld: read in, typed, or a
 * file of theirs on the approval's record, approvedFileOf), are the record, however a file comes to them: no file
 * becomes their minutes. One added as the minutes (Every file's Add files or a drop on it, an item's upload, the upload
 * API) is kept as an ordinary file of the meeting (AS_A_FILE says so), and a file's kind changed to Minutes is refused
 * (NOT_THE_MINUTES); a drop in the minutes box is refused by readMinutesInto, and the email reader keeps one for staff
 * (./_board-mail.js). A meeting marked approved with no minutes in Board yet still takes them, as minutesNotReady asks.
 * Board QA round 10, Nov 22 2026: approved minutes kept only as a file were replaced through Every file with only a
 * toast, and the board page opened the new file as "The minutes as written"
 */
export const AS_A_FILE = 'The minutes are approved, so this was added as a file, not as the minutes. Mark them as draft first to replace them.';
export const NOT_THE_MINUTES = 'The minutes are approved, so this stays a file, not the minutes. Mark them as draft first to replace them.';
export { minutesHeld };
/**
 * Why a file can't be this meeting's minutes ('' when it can): `meetingId` for one being added, `fileId` for one of its
 * files whose kind is being changed (one filed as the minutes already stays as it is)
 */
export async function minutesKindNo(env, { meetingId = '', fileId = '' } = {}) {
  let id = meetingId;
  if (fileId) {
    const row = await env.DB.prepare('SELECT owner_type, owner_id, kind FROM board_files WHERE id = ?').bind(fileId).first();
    if (!row || row.owner_type !== 'meeting' || row.kind === 'minutes') return '';
    id = row.owner_id;
  }
  const m = ID.test(String(id || '')) ? await getMeeting(env.DB, id) : null;
  return minutesHeld(m, fileId) ? (fileId ? NOT_THE_MINUTES : AS_A_FILE) : '';
}
/**
 * The kind a file sent to a meeting is kept as (Every file's Add files, an item's upload: POST /api/board-admin's
 * upload), and what's said: `kind` as asked, except the minutes of a meeting whose minutes are approved and in Board,
 * kept as an ordinary file and said (AS_A_FILE); and a minutes file going onto one of an approved meeting's agenda
 * items (`forItem`), never this meeting's own minutes (those are approved), kept as an ordinary file of that item.
 * Board QA rounds 10 and 11. → { kind, asFile: words | '' }
 */
export async function uploadKind(env, { meetingId = '', kind = 'other', forItem = false } = {}) {
  if (kind !== 'minutes') return { kind, asFile: '' };
  const asFile = await minutesKindNo(env, { meetingId });
  if (asFile) return { kind: 'other', asFile };
  if (!forItem) return { kind, asFile: '' };
  const m = ID.test(String(meetingId || '')) ? await getMeeting(env.DB, meetingId) : null;
  return { kind: m?.minutes === 'approved' ? 'other' : kind, asFile: '' };
}

/**
 * Approved minutes' own file (the approval's record: approvedFileOf) stays their minutes while they're approved: filed
 * under another kind, deleted, or put on an agenda item (./_board.js saveMeeting), each refused in FILE_STAYS's words,
 * nothing changed. Mark them as draft and it can change. Board QA round 11, Nov 23 2026: approved minutes were replaced
 * in two steps, their file filed under Other (or deleted, or put on an item) and then a new file added as the minutes
 */
export { FILE_STAYS };
/**
 * Why a meeting's file can't change so ('' when it can): `kind`, the kind it's being filed under (null: it's being
 * deleted). Filed under Minutes, or under the kind it has, it stays theirs; anything else takes it off them
 */
export async function approvedFileNo(env, fileId, { kind = null } = {}) {
  const row = await env.DB.prepare('SELECT owner_type, owner_id, kind FROM board_files WHERE id = ?').bind(fileId).first();
  if (!row || row.owner_type !== 'meeting') return '';
  if (kind !== null && (kind === 'minutes' || kind === row.kind || !FILE_KINDS.some((k) => k.id === kind))) return '';
  const m = ID.test(String(row.owner_id || '')) ? await getMeeting(env.DB, row.owner_id) : null;
  return m && approvedFileOf(m) === fileId ? FILE_STAYS : '';
}

/**
 * One of a meeting's files read as its minutes and put on it (POST /api/board-admin read-minutes): the meeting saved,
 * the file filed as the minutes, and the last meeting's minutes marked approved when these say the board approved
 * them (`prevApproved` names that meeting, for the page to say so).
 * Minutes read in here already (Replace the minutes): Undo of that read and this new read, in one step, by the same code
 * (takenOff, afterTakenOff): everything the replaced read put on (its notes, decisions, action items, attendance, the
 * last meeting's approval, what the heartbeat added to it) comes off as Undo takes it off, this file is read onto the
 * meeting as it was before that read, a change made since is kept and named (`replaced.left`), and when Undo would
 * refuse (approved since) this refuses in its words. Board QA round 8, Nov 21 2026: the replaced file's notes and
 * decisions stayed on the meeting and the board read them as the new minutes'. Minutes with no Undo record (Board's
 * email reader's, or read before Undo kept one) are read over as before. Minutes marked approved are never read over,
 * however they came onto the meeting, and the meeting's other minutes files come off here, in the same step, never by
 * a page's copy (`filesOff`). Board QA round 9, Nov 22 2026.
 * → { meeting, approvedPrev: id | null, prevApproved: { id, date, title } | null, filesOff: [file id], replaced: { name, fileId, fileKept, left, prevBack } | null,
 *     read: { attendance: { here, of }, notes, motions, actions, ai } }
 */
export async function readMinutesInto(env, id, fileId, { by = '', now = Date.now(), dry = false, anyway = false, staged = null } = {}) {
  const m = await getMeeting(env.DB, id);
  if (!m) throw Object.assign(new Error('That meeting is gone'), { status: 404 });
  // Typed and sent, the minutes change in the notes: a file read over them changes who was there, can take items off the
  // agenda, and a re-send can't put that back
  // (with the meeting as the site has it, for a tab that still shows them as a file's: Board QA round 12)
  if (m.minutesFrom?.typed) throw Object.assign(new Error(TYPED_WORDS), { status: 409, typed: true, extra: { meeting: m } });
  // (`staged`: a file whose bytes are kept and whose row goes in the meeting's own write below, { file, insert, bytes }:
  // the secretary's, so minutes that aren't read in leave no file on the meeting. Board QA round 14)
  const f = staged ? staged.file : m.files.find((x) => x.id === fileId);
  const row = staged ? { staged: true } : f && await env.DB.prepare('SELECT r2_key FROM board_files WHERE id = ? AND owner_type = ? AND owner_id = ?').bind(fileId, 'meeting', id).first();
  if (!f || !row) throw Object.assign(new Error('That file isn’t on this meeting'), { status: 404 });
  const obj = staged ? null : await boardFiles(env)?.get(row.r2_key);
  if (!staged && !obj) throw Object.assign(new Error('That file is gone'), { status: 404 });
  const bytes = staged ? staged.bytes : new Uint8Array(await new Response(obj.body).arrayBuffer());
  const [people, meetings] = await Promise.all([minutesPeople(env.DB), listMeetings(env.DB)]);
  const prev = meetings.filter((x) => x.id !== m.id && !x.notBoard && !x.practice && isDate(x.date) && x.date < m.date).sort((a, b) => b.date.localeCompare(a.date))[0] || null;
  // Minutes read in here already, whose read Undo can still take off: replaced, read onto the meeting as it was before them
  const rec = m.minutesFrom ? await readState(env.DB, UNDO_KEY(id)) : null;
  const refused = rec ? undoRefused(rec, m) : NOTHING_TO_UNDO;
  const replacing = !refused;
  // Minutes marked approved are the record, however they came onto the meeting (read in, typed, or only a file kept
  // with it, by the approval's record: minutesHeld, whatever has happened to that file since): nothing is read onto
  // them, in the words read-in minutes get (approved after their read: Undo's). A meeting marked approved with no
  // minutes in Board yet (a past meeting added from its agenda) still takes them, as minutesNotReady asks. Board QA
  // round 9, Nov 22 2026: approved minutes kept only as a file were read over with no question, and their file
  // deleted; round 11: once their file was filed under Other, deleted or put on an item, they were read over again
  const approvedNo = (x) => (!minutesHeld(x, fileId) ? ''
    : rec && undoRefused(rec, x) === APPROVED_SINCE ? APPROVED_SINCE : APPROVED_NOW);
  if (approvedNo(m) && !dry) throw Object.assign(new Error(approvedNo(m)), { status: 409, why: 'approved', extra: { meeting: m } });
  // ...and minutes with no Undo record of their read (Board's email reader's, or read before Undo kept one): what their
  // marks show came from them comes off (readOff); with no marks to tell them from what a person wrote, nothing is
  // mixed: refused in words (never read over them, so the board read both files as one). Coordinator, round 8
  const bare = !replacing && !!m.minutesFrom?.name && refused !== APPROVED_SINCE;
  const bareNo = (x) => (!bare ? '' : !x.minutesFrom?.marks && anythingOn(x) ? untoldWords(x) : '');
  const base = replacing ? takenOff(rec, m).next : bare && !bareNo(m) ? readOff(m) : m;
  const read = await readMinutes(env, { name: f.name, bytes, meeting: base, people, prev });
  if (!readSomething(read)) {
    throw Object.assign(new Error(read.said.chars ? 'Board couldn’t find minutes in that file: no attendance, agenda items, motions or action items. Is it the minutes?' : 'Board couldn’t read that file. Minutes can be a PDF (not a scan) or a Word file.'), { status: 422 });
  }
  // Another meeting's minutes, by their own heading or file name: nothing is put on this one unless told to
  if (read.said.other && !anyway && !dry) throw Object.assign(new Error(otherMeetingWords(m, read.said.other)), { status: 409, other: read.said.other, fileId });
  if (bareNo(m) && !dry) throw Object.assign(new Error(bareNo(m)), { status: 409, why: 'untold', extra: { meeting: m } });
  // A look only (`dry`): what the minutes would put on the meeting, nothing saved
  if (dry) {
    const would = applyMinutes(base, read, { fileName: f.name, now });
    const board = would.attendance.filter((p) => p.kind === 'board');
    return {
      dry: true, said: read.said,
      read: {
        attendance: { here: board.filter((p) => p.status === 'present' || p.status === 'remote').length, of: board.length },
        notes: notesRead(read, would),
        motions: read.motions.length, actions: read.actions.length, ai: read.said.by === 'ai',
      },
      would: { attendance: would.attendance.map((p) => ({ name: p.name, kind: p.kind, status: p.status })), motions: would.motions, actions: would.actions, sections: would.sections.map((s) => ({ title: s.title, items: s.items.map((it) => ({ title: it.title, notes: it.notes })) })), approvedPrev: read.approvedPrev },
    };
  }
  // (the meeting the read went onto, its earlier minutes off in the same write, kept for Replace to take this read off
  // again: `was`; and the meeting as the read found it, earlier minutes and all, for Undo to put back: `found`)
  let was = null;
  let found = null;
  let took = null;
  let gone = [];
  const after = await patchMeeting(env.DB, id, (cur) => {
    took = null;
    // (approved since this one began: nothing is written, in Undo's words. Other minutes read in, typed or taken off
    // meanwhile, a Replace pressed at the same moment in another tab above all: nothing is written either, said as this
    // read's own no, naming the minutes that went on (lostWords), never Undo's. Board QA round 10, Nov 22 2026: the
    // founder whose Replace lost was told "Undo would take those off too")
    const lost = !sameMinutes(cur.minutesFrom, m.minutesFrom) ? lostWords(cur, f.name) : '';
    const no = approvedNo(cur) || lost || (replacing ? undoRefused(rec, cur) : '') || bareNo(cur);
    if (no) throw Object.assign(new Error(no), { status: 409, why: no === APPROVED_NOW || no === APPROVED_SINCE ? 'approved' : no === lost ? 'lost' : bareNo(cur) ? 'untold' : '', extra: { meeting: cur } });
    if (replacing) took = takenOff(rec, cur);
    found = cur;
    // The meeting's other minutes files (never one on an agenda item: the last meeting's, up for approval), as this
    // write finds them: the replaced read's goes as Undo takes it off (afterTakenOff), the rest just after
    gone = ownMinutesFiles(cur).filter((x) => x.id !== fileId && !(took && x.id === rec.fileId));
    was = took ? took.next : bare ? readOff(cur) : cur;
    return applyMinutes(was, read, { fileName: f.name, now });
  }, { by: '', also: staged ? [staged.insert] : [] });
  // (read in from here on: what follows is kept as it can be, and a step of it that fails never turns the answer into
  // "nothing was changed" over minutes that are on the meeting. Board QA round 14)
  const after2 = (what, p) => p.catch((err) => { console.error('[board-minutes] after the read', what, id, err?.message || err); return null; });
  if (f.kind !== 'minutes' && f.kind !== 'signed') await after2('its kind', updateFile(env.DB, fileId, { kind: 'minutes' }));
  // The replaced read's own file, the last meeting's approval it made, and its Undo record: off, as Undo takes them off
  const replaced = took ? { name: rec.after.minutesFrom?.name || '', ...(await afterTakenOff(env, rec, m, after, took, { by })) } : null;
  // Which minutes file the meeting keeps is the site's to say, from the meeting as this write found it, never a page's
  // copy: the one these minutes are read from, and nothing of the minutes before them (a signed record stays). Board QA
  // round 9, Nov 22 2026: a page that hadn't seen the email reader's minutes left both files on the board page
  const filesOff = took && !replaced.fileKept ? [{ id: rec.fileId, name: m.files.find((x) => x.id === rec.fileId)?.name || replaced.name }] : [];
  for (const x of gone) if (await after2('an earlier file', (async () => !(await fileLocked(env.DB, x.id)) && deleteFile(env, x.id))())) filesOff.push({ id: x.id, name: x.name });
  let approvedPrev = null;
  let approved = null;
  // (the last meeting as it is now: the replaced read may have just put its approval back)
  const last = prev && replaced?.prev?.id === prev.id ? replaced.prev : prev;
  if (read.approvedPrev && last && last.minutes !== 'approved') {
    approved = await after2('the last meeting’s approval', approveMinutes(env, last.id, { on: m.date, by }));
    if (approved) approvedPrev = last.id;
  }
  // The last meeting's minutes as this read found them and as it leaves them (a replaced read's approval off, these
  // minutes' own on), for Undo to put back as found
  const touched = approved ? last : replaced?.prevBack ? replaced.prev : null;
  const foundPrev = touched && (touched.id === prev?.id ? approvalOf(prev) : { minutes: 'approved', approvedOn: rec?.prev?.approvedOn || '' });
  const leftPrev = touched && approvalOf(approved || touched);
  if (was && after) {
    await after2('its Undo record', writeState(env.DB, UNDO_KEY(id), {
      fileId, at: new Date(now).toISOString(), by, before: undoShape(was), after: undoShape(after),
      // Undo of a Replace (or of a read over the email reader's minutes) is the meeting as it was before it, the earlier
      // minutes on it again: never left with none. Board QA round 9, Nov 22 2026: Undo right after Replace left no minutes
      ...(found !== was ? { found: undoShape(found) } : {}), filesOff,
      prev: approved ? { id: last.id, approvedOn: approved.approvedOn, before: { minutes: last.minutes, approvedOn: last.approvedOn || '' } } : null,
      prevFound: touched && JSON.stringify(foundPrev) !== JSON.stringify(leftPrev) ? { id: touched.id, before: foundPrev, after: leftPrev } : null,
    }));
  }
  // (the meeting as it is now, or as the read's own write left it when that read fails)
  const meeting = (await after2('reading it back', getMeeting(env.DB, id))) || after;
  const board = meeting.attendance.filter((p) => p.kind === 'board');
  return {
    meeting, approvedPrev,
    // The minutes files that came off with the read, for the page to drop from its copy
    filesOff: filesOff.map((x) => x.id),
    // The last meeting whose minutes these marked approved, for the page to name (never guessed from the file)
    prevApproved: approvedPrev ? { id: last.id, date: last.date, title: meetingName(last) } : null,
    // What Replace took off first: the file it replaced, a change since kept, the last meeting's minutes a draft again
    // (unless these approved them in turn)
    replaced: replaced ? { name: replaced.name, fileId: rec.fileId, fileKept: replaced.fileKept, left: replaced.left, prevBack: approvedPrev && replaced.prevBack?.id === approvedPrev ? null : replaced.prevBack } : null,
    read: {
      attendance: { here: board.filter((p) => p.status === 'present' || p.status === 'remote').length, of: board.length },
      notes: notesRead(read, after || meeting),
      motions: read.motions.length, actions: read.actions.length, ai: read.said.by === 'ai',
    },
  };
}

// ─── Undo, right after the admin's upload ───────────────────────────

/** Where the site keeps a meeting as it was just before minutes were read into it, for Undo (one per meeting: the last read) */
const UNDO_KEY = (id) => `minutes-undo:${id}`;
/** The same reading of the same minutes: the file they were read from, at the moment they were read in */
const sameRead = (a, b) => !!a?.name && a.name === b?.name && (a.at || '') === (b?.at || '');
/**
 * What the heartbeat adds while finishing a read (maybeFinishMinutes: the model's motions and action items, or anything
 * else it puts on) is part of that read: its change (`was` → `now`) goes onto the read's Undo record, so Undo takes it
 * off too and says so, while whatever a person changed since the read is still theirs, kept and named. Only for the
 * record of this same read (minutes read in again, or put back, have a record of their own, or none). QA round 7, Nov 21
 * 2026: Undo after the heartbeat finished the minutes left their decision and to-do on the meeting
 */
async function finishUndo(DB, id, was, now) {
  const key = UNDO_KEY(id);
  const rec = await readState(DB, key);
  if (!rec?.after || !sameRead(rec.after.minutesFrom, was.minutesFrom)) return;
  const { merged } = mergeMeeting(undoShape(was), undoShape(now), rec.after);
  const ids = (list) => new Set((list || []).map((x) => x.id));
  const had = { motions: ids(rec.after.motions), actions: ids(rec.after.actions) };
  const later = {
    motions: [...(rec.later?.motions || []), ...merged.motions.filter((x) => !had.motions.has(x.id)).map((x) => x.id)],
    actions: [...(rec.later?.actions || []), ...merged.actions.filter((x) => !had.actions.has(x.id)).map((x) => x.id)],
  };
  await writeState(DB, key, { ...rec, after: { ...rec.after, ...merged, minutesFrom: undoShape(now).minutesFrom }, later });
}
/**
 * A meeting as a read and its Undo compare it: what a person or the reader writes (cleanMeeting), without what lives in
 * tables of its own (files, done ticks, answers to the invite), so only what the read changed can differ
 */
const undoShape = (m) => {
  const c = cleanMeeting(m);
  return { ...c, files: [], actions: c.actions.map((a) => ({ ...a, done: false, doneOn: '' })), attendance: c.attendance.map((p) => ({ ...p, rsvp: '' })) };
};
/** A meeting's own minutes files, by the one rule (../../public/admin/board-shared.js minutesFilesOf): a minutes file on an agenda item is the last meeting's, up for approval */
const ownMinutesFiles = (m) => minutesFilesOf(m, { staff: true });
/** Where a meeting's minutes stand, to compare: approved (on a day) or a draft */
const approvalOf = (m) => ({ minutes: m?.minutes === 'approved' ? 'approved' : 'draft', approvedOn: m?.minutes === 'approved' ? m.approvedOn || '' : '' });
const andWords = (l) => (l.length > 1 ? `${l.slice(0, -1).join(', ')} and ${l.at(-1)}` : l[0] || '');
const fileWords = (name) => String(name || '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_-]+/g, ' ').trim();

// Minutes with no Undo record of their read: approved, or with nothing to tell their words from a person's (readMinutesInto)
const APPROVED_NOW = 'These minutes are marked approved, so Board leaves them as they are. Mark them as draft first (After the meeting), then drop in the new file.';
const untoldWords = (m) => `Board can’t tell which notes came from the old minutes (${fileWords(m.minutesFrom?.name) || 'the file read in before'}), so it won’t mix the two files. Take the old notes, decisions and action items off by hand, then add the new file.`;
// The board's secretary sends from the board page, where none of that is to be done: said for their page (secretarySends)
const SECRETARY_APPROVED = 'These minutes were marked approved since. A founder can mark them a draft again if they need changing.';
const SECRETARY_UNTOLD = 'Board can’t tell these from the minutes already on this meeting, so it won’t mix the two. A founder can take the old minutes off first.';
const SECRETARY_LOST = 'Other minutes went onto this meeting just now, so these weren’t read in. Nothing was changed.';
/** The same minutes on a meeting, as a read began and as it writes: the same file, read in at the same moment (or none) */
const sameMinutes = (a, b) => (a?.name || '') === (b?.name || '') && (a?.at || '') === (b?.at || '') && !!a?.typed === !!b?.typed;
/**
 * A read refused because the minutes on the meeting changed while it was read (another tab's Replace at the same
 * moment, the email reader, the secretary's send, an Undo): what went on instead, by name, and that nothing changed
 */
const lostWords = (cur, name) => (cur.minutesFrom?.name
  ? `Other minutes went onto this meeting just now (${fileWords(cur.minutesFrom.name)}), so ${fileWords(name)} wasn’t read in. Nothing was changed.`
  : `The minutes on this meeting were taken off just now, so ${fileWords(name)} wasn’t read in. Nothing was changed.`);
// Why the last read can't be taken off now (Undo, and Replace, which is Undo and a new read): said in these words
const NOTHING_TO_UNDO = 'There’s nothing to undo here any more: these minutes were put back already, or other minutes were read in since. Change the meeting by hand if something’s wrong.';
const OTHER_SINCE = 'Other minutes went onto this meeting after these were read in, so Undo would take those off too. Nothing was changed.';
const APPROVED_SINCE = 'These minutes were marked approved after they were read in, so Undo leaves them as they are. Mark them as draft first (After the meeting), then drop in the right file.';
/**
 * Why the last read (its Undo record `rec`) can't come off the meeting as it is now (`cur`): '' when it can. `fileId`:
 * the file Undo was pressed for (null: whichever read the record is of, for Replace)
 */
function undoRefused(rec, cur, fileId = null) {
  if (!rec?.fileId || (fileId !== null && rec.fileId !== fileId) || !rec.before || !rec.after) return NOTHING_TO_UNDO;
  if (cur.minutesFrom?.typed || (cur.minutesFrom?.name || '') !== (rec.after.minutesFrom?.name || '')) return OTHER_SINCE;
  // Approved since, from what was read: never left approved with no minutes in Board
  if (cur.minutes === 'approved' && rec.after.minutes !== 'approved') return APPROVED_SINCE;
  return '';
}
/**
 * The meeting as it is now (`now`) with the last read taken off (pure): who was there, the notes, the motions, the
 * action items, which minutes it was read from and where its agenda came from put back as the read found them, and
 * everything changed since the read, by anyone, as it is now (the read's change and the later one merge item by item:
 * mergeMeeting, theirs kept). `to`: what it goes back to, the meeting the read went onto (Replace: no minutes) unless
 * Undo says the meeting as the read found it (rec.found: earlier minutes it read over). → { next, clashes }
 */
function takenOff(rec, now, to = rec.before) {
  const { merged, clashes } = mergeMeeting(rec.after, to, undoShape(now), { prefer: 'theirs' });
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  return {
    clashes,
    next: {
      ...now, sections: merged.sections, attendance: merged.attendance, motions: merged.motions, actions: merged.actions,
      minutesFrom: to.minutesFrom || null,
      // (a person who changed the agenda since made it theirs: never put back to the read's)
      agendaFrom: same(now.agendaFrom, rec.after.agendaFrom) ? to.agendaFrom || null : now.agendaFrom,
    },
  };
}
/**
 * Every change made since the read that taking it off keeps, by name, beside the ones both ways changed (`clashes`,
 * named on their own): what the meeting has, once the read is off (`put`), that it didn't have before the read
 * (`before`): a decision or action item added, changed or taken off since, an item's notes or a part changed, someone's
 * attendance. → a sentence, or '' when it's all as it was. Board QA round 8, Nov 21 2026: Undo kept an action item a
 * founder added after the read, said nothing of it, and said "Put back as it was"
 */
function keptSince(before, put, clashes) {
  const said = new Set(clashes);
  const out = [];
  const q = (s) => `“${String(s || '').slice(0, 40)}”`;
  const json = (x) => JSON.stringify(x ?? null);
  for (const [f, what] of [['motions', 'decision'], ['actions', 'action item']]) {
    const was = new Map((before[f] || []).map((x) => [x.id, x]));
    const now = new Map((put[f] || []).map((x) => [x.id, x]));
    for (const [id, x] of now) {
      if (said.has(q(x.text))) continue;
      if (!was.has(id)) out.push(`the ${what} ${q(x.text)}, added since`);
      else if (json(x) !== json(was.get(id))) out.push(`the ${what} ${q(x.text)}, changed since`);
    }
    for (const [id, x] of was) if (!now.has(id) && !said.has(q(x.text))) out.push(`the ${what} ${q(x.text)}, taken off since`);
  }
  const items = (m) => new Map((m.sections || []).flatMap((s) => s.items.map((it) => [it.id, { it, sec: s.id }])));
  const [wasItems, nowItems] = [items(before), items(put)];
  const itemLabel = (it) => `“${it.title || 'an item'}”`;
  for (const [id, { it, sec }] of nowItems) {
    if (said.has(itemLabel(it))) continue;
    const b = wasItems.get(id);
    if (!b) out.push(`the item ${itemLabel(it)}, added since`);
    else if (json(it) !== json(b.it) || sec !== b.sec) out.push(`${itemLabel(it)}, changed since`);
  }
  for (const [id, { it }] of wasItems) if (!nowItems.has(id) && !said.has(itemLabel(it))) out.push(`the item ${itemLabel(it)}, taken off since`);
  const parts = (m) => new Map((m.sections || []).map(({ items: _, ...s }) => [s.id, s]));
  const [wasParts, nowParts] = [parts(before), parts(put)];
  for (const [id, s] of nowParts) {
    const label = `the part “${s.title || 'untitled'}”`;
    if (said.has(label)) continue;
    if (!wasParts.has(id)) out.push(`${label}, added since`);
    else if (json(s) !== json(wasParts.get(id))) out.push(`${label}, changed since`);
  }
  const keyOf = (p) => p.key || p.slug || p.name;
  const wasRoll = new Map((before.attendance || []).map((p) => [keyOf(p), p]));
  for (const p of put.attendance || []) {
    const label = `${p.name}’s attendance`;
    if (said.has(label)) continue;
    const b = wasRoll.get(keyOf(p));
    if (!b ? !!p.status : (b.status || '') !== (p.status || '')) out.push(`${label}, changed since`);
  }
  if (!out.length) return '';
  const words = andWords(out);
  // ("The action item “Book the spring venue”, added since, is kept.")
  return `${words[0].toUpperCase()}${words.slice(1)}, ${out.length === 1 ? 'is' : 'are'} kept.`;
}
/**
 * The rest of taking a read off once the meeting is written (`cur`: as it was just before, `put`: as written, `took`:
 * takenOff's answer): the read's file off, the last meeting's minutes back to draft when the read approved them, its
 * Undo record gone, and what was kept or couldn't be put back said, a sentence each. `undo`: Undo's (the meeting and
 * the last meeting's minutes back as the read found them, every file it took off that can't come back named), not
 * Replace's (only this read off).
 * → { prev: the last meeting as it is now | null, prevBack / prevAgain: { id, date, title } when it's a draft again /
 *     approved again | null, left, also }
 */
async function afterTakenOff(env, rec, cur, put, took, { by = '', undo = false } = {}) {
  const left = [];
  const { clashes } = took;
  const to = undo ? rec.found || rec.before : rec.before;
  if (clashes.length) left.push(`${andWords(clashes)} ${clashes.length === 1 ? 'was' : 'were'} changed after the minutes were read, so ${clashes.length === 1 ? 'it stays' : 'they stay'} as ${clashes.length === 1 ? 'it is' : 'they are'} now.`);
  // Each change since that it keeps, by name, not only the ones both ways changed
  const kept = keptSince(to, undoShape(took.next), clashes);
  if (kept) left.push(kept);
  // What the heartbeat read from them afterwards (finishUndo) and taking them off took off as well: said, as the read
  // itself never said it ("Read from the minutes: notes under 4 items" was all the founder heard)
  const off = (f) => (rec.later?.[f] || []).filter((x) => (cur[f] || []).some((y) => y.id === x) && !(put?.[f] || []).some((y) => y.id === x)).length;
  const these = (n, one, many) => (n === 1 ? `the ${one}` : `the ${n} ${many}`);
  const [mo, ac] = [off('motions'), off('actions')];
  const later = [mo ? these(mo, 'decision', 'decisions') : '', ac ? these(ac, 'action item', 'action items') : ''].filter(Boolean);
  const also = later.length ? `${andWords(later).replace(/^t/, 'T')} Board read from them afterwards ${mo + ac > 1 ? 'are' : 'is'} off too.` : '';
  // The file goes too (unless it's become SOARD's record of a signature since)
  const locked = await fileLocked(env.DB, rec.fileId);
  if (locked) left.push(`${fileWords(cur.files.find((f) => f.id === rec.fileId)?.name) || 'The file'} stays with the meeting: ${locked.replace(/[.\s]+$/, '')}.`);
  else await deleteFile(env, rec.fileId);
  // Read over earlier minutes, whose file was taken off once these were in: their notes are back, their file isn't
  const earlier = undo ? to.minutesFrom?.name : '';
  const back = !!earlier && earlier !== rec.after.minutesFrom?.name && !cur.files.some((f) => f.name === earlier && f.id !== rec.fileId);
  if (back) left.push(`The earlier minutes (${fileWords(earlier)}) are back on the meeting, but their file was removed when these were read in: drop it in again to keep it with them.`);
  // ...and any other minutes file the read took off (one kept with the meeting, never read in): named, as it can't come
  // back. Board QA round 9, Nov 22 2026: Undo said "as it was" with the meeting's minutes file gone for good
  const files = undo ? (rec.filesOff || []).filter((x) => x.id !== rec.fileId && !(back && x.name === earlier) && !cur.files.some((f) => f.id === x.id)).map((x) => fileWords(x.name)) : [];
  if (files.length) left.push(files.length === 1 ? `The earlier minutes file (${files[0]}) was removed when these were read in: drop it in again to keep it with the meeting.` : `The earlier minutes files (${andWords(files)}) were removed when these were read in: drop them in again to keep them with the meeting.`);
  // The last meeting's minutes, approved by the read: back to draft, unless they've been marked again since. Undo puts
  // them back as the read found them (a Replace's take-off of the earlier read's approval undone too: prevFound)
  const pr = undo && 'prevFound' in rec ? rec.prevFound : rec.prev;
  let prev = null;
  let prevBack = null;
  let prevAgain = null;
  if (pr?.id) {
    const p = await getMeeting(env.DB, pr.id);
    const asLeft = (x) => (pr.after ? JSON.stringify(approvalOf(x)) === JSON.stringify(pr.after) : x?.minutes === 'approved' && x.approvedOn === pr.approvedOn);
    const goes = { minutes: pr.before?.minutes === 'approved' ? 'approved' : 'draft', approvedOn: pr.before?.approvedOn || '' };
    if (p && asLeft(p)) {
      prev = await patchMeeting(env.DB, p.id, (x) => (asLeft(x) ? { ...x, ...goes } : x), { by });
      const said = prev && { id: prev.id, date: prev.date, title: meetingName(prev) };
      if (prev && p.minutes === 'approved' && prev.minutes !== 'approved') prevBack = said;
      else if (prev && p.minutes !== 'approved' && prev.minutes === 'approved') prevAgain = said;
    } else if (p) {
      prev = p;
      if (p.minutes === 'approved' && goes.minutes !== 'approved') left.push(`The ${meetingName(p)} (${shortDate(p.date)}) minutes stay approved: they were marked approved again after these were read.`);
      else if (p.minutes !== 'approved' && goes.minutes === 'approved') left.push(`The ${meetingName(p)} (${shortDate(p.date)}) minutes stay a draft: they were marked as draft after these were read.`);
    }
  }
  await env.DB.prepare('DELETE FROM board_state WHERE key = ?').bind(UNDO_KEY(put?.id || cur.id)).run();
  return { prev, prevBack, prevAgain, left, also, fileKept: !!locked };
}

/**
 * Undo of reading minutes in (POST /api/board-admin undo-minutes { id, fileId }), in one step on the site: the meeting
 * put back as the site kept it at the read (readMinutesInto: who was there, the notes, the motions, the action items,
 * which minutes it was read from, where its agenda came from: everything applyMinutes sets), the file taken off, and
 * the last meeting's minutes back to draft when the read approved them (`prevBack` says so). Anything changed since the
 * read, by anyone, is left as it is now (takenOff), and said in `left`, a sentence each: every such change, not only
 * the ones both ways changed (keptSince). Minutes replaced since (another file, typed ones) are never undone from under
 * them. Peter's QA round 6, Nov 21 2026: Undo said "Put back as it was" and changed nothing on the site. What the
 * heartbeat added while finishing the same read is part of it (finishUndo), so it comes off too, and `also` says so. A
 * no (409) carries the meeting as it is now. Replace (readMinutesInto) is this and a new read, in one step. Undo of a
 * Replace (or of a read over the email reader's minutes) puts the earlier minutes back as the read found them (rec.found),
 * and the last meeting's minutes too (prevAgain: approved again), naming every file it can't bring back. Board QA round
 * 9, Nov 22 2026: Undo right after Replace left the meeting with no minutes at all, and said "Put back as it was"
 * → { meeting, prev: the last meeting as it is now | null, prevBack, prevAgain, left: [sentences], also: a sentence | '', fileKept }
 */
export async function undoMinutes(env, id, fileId, { by = '' } = {}) {
  const rec = await readState(env.DB, UNDO_KEY(id));
  const cur = await getMeeting(env.DB, id);
  if (!cur) throw Object.assign(new Error('That meeting is gone'), { status: 404 });
  // A no carries the meeting as the site has it now, so the page shows why (approved in another tab, other minutes read
  // in since). QA round 7, Nov 21 2026: a tab whose copy was older said "marked approved" and still showed Draft
  const why = undoRefused(rec, cur, fileId);
  if (why) throw Object.assign(new Error(why), { status: 409, extra: { meeting: cur } });
  let took = null;
  const put = await patchMeeting(env.DB, id, (now) => { took = takenOff(rec, now, rec.found || rec.before); return took.next; }, { by });
  const r = await afterTakenOff(env, rec, cur, put, took, { by, undo: true });
  return { meeting: await getMeeting(env.DB, id), ...r };
}

/**
 * The minutes the board's secretary sends from the board page (POST /api/board-portal?minutes=<id>): the copy of the
 * minutes template they typed into, kept as the meeting's minutes and read into it at once, as the founders' drop
 * in Board does. Only the secretary's seat (or one of Board's admins), only a meeting the board can see, on its day
 * or after. A board member gets back what was read, never the meeting as Board keeps it (private notes, staff-only
 * files). → { read: { attendance, notes, motions, actions, ai }, approvedPrev: boolean }
 */
export async function secretarySends(env, id, file, w, { now = Date.now(), anyway = false } = {}) {
  const no = (message, status) => Object.assign(new Error(message), { status });
  if (!w?.admin && w?.member?.seat !== 'secretary') throw no('Only the board’s secretary sends the minutes from here', 403);
  if (!ID.test(String(id || ''))) throw no('Which meeting?', 400);
  const m = await getMeeting(env.DB, id);
  if (!m || m.practice || m.notBoard || !(m.shared || w.admin)) throw no('That meeting isn’t on the board page', 404);
  if (!isDate(m.date) || m.date > todayEastern(now)) throw no('The minutes come in on the day of the meeting or after', 400);
  if (m.minutesFrom?.typed) throw no(TYPED_WORDS, 409);
  if (!file || typeof file.arrayBuffer !== 'function' || !/\.(docx|pdf)$/i.test(String(file.name || ''))) throw no('Send the minutes as the Word file (or a PDF)', 400);
  if (!file.size) throw no('That file is empty', 400);
  if (file.size > MAX_FILE) throw no('That file is over 50 MB', 413);
  // Another meeting's minutes (the wrong file picked): nothing is kept unless they say send it anyway
  if (!anyway) {
    const text = await fileText(env, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    const other = otherMeetingIn(m, { text, name: file.name, date: parseAgendaText(text).date });
    if (other) throw Object.assign(new Error(otherMeetingWords(m, other)), { status: 409, other });
  }
  const by = w.member?.email || w.adminEmail || '';
  // The file's bytes kept first, its row written in the meeting's own write (putFile's stage): minutes that aren't read
  // in leave no file on the meeting, and a database that didn't answer before that write changed nothing, said so (Board
  // QA round 14, Nov 24 2026: the file's row went in, a read after it failed, and the file stayed on the meeting as its
  // minutes, not read in, with "Something went wrong")
  const { insert, drop, ...f } = await putFile(env, { ownerType: 'meeting', ownerId: id, file, kind: 'minutes', by, stage: true });
  let r;
  try {
    r = await readMinutesInto(env, id, f.id, { by, now, anyway: true, staged: { file: f, insert, bytes: new Uint8Array(await file.arrayBuffer()) } });
  } catch (err) {
    // (not read in: its bytes go back, nothing names them; one the site can't tell yet keeps them, its row may name them)
    if (!err?.extra?.unsure) await drop().catch((e) => console.error('[board-minutes] the staged file', e?.message || e));
    // (refused as the minutes on the meeting are: in words for the secretary's page, naming nothing only founders see)
    // (never the meeting as Board keeps it, which a founder's refusal carries: its private notes and staff-only files)
    if (err?.extra?.meeting) { const { meeting: _, ...rest } = err.extra; err.extra = rest; }
    if (err?.why === 'approved') err.message = SECRETARY_APPROVED;
    else if (err?.why === 'untold') err.message = SECRETARY_UNTOLD;
    else if (err?.why === 'lost') err.message = SECRETARY_LOST;
    // A clear no (not minutes): it doesn't stay on the meeting as its minutes, for the board or the agenda email to find
    if (err?.status && err.status < 500) err.message = `${err.message.replace(/\.?$/, '.')} It wasn’t kept.`;
    throw err;
  }
  return { read: r.read, approvedPrev: !!r.approvedPrev };
}
