// Advisory Board round 22 (Nov 22 2026), run as a child by tests/advisory-round22-names.test.mjs: round 21's speed test
// (advisory-r21-slow-names.mjs) taken to every question of the application at the request's full size. The public
// handler takes up to 64 KB of answers in one send, so a send made by hand can put all of it in one answer (round 22's
// finding 7: 60,000 spaces in "why" took the server 2.9 s, the textarea's clean-up starting again at each space). Each
// question's answer is 64 KB of a repeated piece (spaces, tabs, line breaks, letters, marks, the shapes a pattern that
// backtracks takes long on), ended with something else, and each call the apply path makes with it is timed: the form's
// check (checkAnswers, the one the server runs), each answer's own check (fieldProblem, on the uncut answer), the
// greeting, the sections and the three notices (on what the check kept). Prints one JSON line: { calls, slowest, over }
// (over: every call over LIMIT_MS, timed again twice and its fastest kept). A root other than this checkout's can be given
// (ROOT=…), so the same child times other code.
import { pathToFileURL } from 'node:url';

const ROOT = process.env.ROOT ? pathToFileURL(`${process.env.ROOT.replace(/\/$/, '')}/`).href : new URL('../../', import.meta.url).href;
const form = await import(new URL('functions/api/_advisory-form.js', ROOT).href);
const apps = await import(new URL('functions/api/_advisory-applications.js', ROOT).href);

const LIMIT_MS = 100;
const SIZE = 64 * 1024;
// (a whole application that passes, each answer in turn replaced by the long one)
const BASE = { fullName: 'Jordan Ames', preferredName: 'Jo', email: 'jordan@example.org', phone: '(770) 555-0142', address: '12 Oak St, Decatur, GA 30030',
  company: 'Acme', jobTitle: 'Director', link: 'linkedin.com/in/jordanames', heardFrom: 'A friend', why: 'To help.', connection: 'Neighbors.', involved: 'Yes',
  involvedHow: 'Volunteered.', strengths: 'Events.', fundraising: 'A match.', introductions: 'Yes', networks: 'Yes', networksMore: 'Church.', conflict: 'Yes',
  conflictMore: 'None real.', hostEvent: 'No', meetings: 'Yes', ambassador: 'Yes', meetingTimes: 'Evenings', hopeToGain: 'Friends.', anythingElse: 'No.',
  refName: 'Sam Lee', refRelationship: 'Former manager', refEmail: 'sam@example.org', refPhone: '(404) 555-0100', acknowledge: true, signature: 'Jordan Ames', headshot: 'added' };
const UNITS = [' ', '\t', '\n', '\r', '\r\n', ' \n', '\t\n', ' \t', ' ', ' ', 'a', 'a ', ' a', 'ab.', 'a-', "a'", 'a,', '.', '-', ',', '@', 'a@', '/', ':',
  'x', 'x1', ' x', '1', '1 ', 'é', '😊', 'Mrs. ', 'Ph. D. ', 'De La ', 'and ', 'a.b', 'www.', 'http://'];
const ENDS = ['', 'To help.', '!', 'x1', '\n', '@b.co', '.com'];
const long = (u, e) => u.repeat(Math.ceil((SIZE - e.length) / u.length)).slice(0, SIZE - e.length) + e;

const time = (fn) => {
  const t = performance.now();
  try { fn(); } catch { /* (an answer it refuses is still an answer, in time) */ }
  return performance.now() - t;
};
let n = 0;
const slowest = [];
const over = [];
const record = (label, field, unit, end, fn) => {
  n++;
  let ms = time(fn);
  if (ms > LIMIT_MS) ms = Math.min(ms, time(fn), time(fn));
  const row = { fn: label, field, unit: JSON.stringify(unit), end: JSON.stringify(end), ms: Math.round(ms * 100) / 100 };
  if (ms > LIMIT_MS) over.push(row);
  if (slowest.length < 5 || ms > slowest[slowest.length - 1].ms) { slowest.push(row); slowest.sort((a, b) => b.ms - a.ms); slowest.splice(5); }
};
const fields = form.ADVISORY_FIELDS.filter((f) => f.type !== 'photo');
for (const f of fields) {
  process.stderr.write(`${f.id}\n`);
  for (const u of UNITS) for (const e of ENDS) {
    const s = long(u, e);
    const raw = { ...BASE, [f.id]: s };
    let checked = null;
    record('checkAnswers', f.id, u, e, () => { checked = form.checkAnswers(raw); });
    record('fieldProblem', f.id, u, e, () => form.fieldProblem(f, s));
    const app = { id: 'adv-r22', answers: checked?.answers || {}, headshot: null };
    record('greetName', f.id, u, e, () => form.greetName(app.answers));
    record('answerSections', f.id, u, e, () => form.answerSections(app.answers));
    record('applicantEmail', f.id, u, e, () => apps.applicantEmail(app));
    record('staffEmail', f.id, u, e, () => apps.staffEmail(app));
    record('staffSlack', f.id, u, e, () => apps.staffSlack(app));
  }
}
process.stdout.write(`${JSON.stringify({ fields: fields.map((f) => f.id), size: SIZE, calls: n, slowest, over })}\n`);
