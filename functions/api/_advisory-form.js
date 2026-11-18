/**
 * The Advisory Board application: its questions in order, and the checks
 * both the page (/advisory-board/apply/) and the server run on the answers.
 * Its imports (the applications' web-address rule, and People's smallest
 * sharp photo) import nothing, so the page's script can share it.
 *
 * The headshot (a 'photo' question) isn't words: its answer here is only
 * 'added' or not. The page holds the photo itself and sends it as a file;
 * the server sets 'added' from that file, never from what the page says.
 *
 * It asks what the Jotform application asked (form 261805783731058, used
 * July to October 2026), grouped into the page's five steps. JOTFORM_FIELDS
 * maps that form's questions to these ids, so the applications sent there
 * read the same in the admin (./_advisory-applications.js imports them).
 * Applications are always open: nothing here has a deadline.
 */

import { isWebAddress } from './_application-constants.js';
import { PHOTO_MIN, PHOTO_GOOD } from '../../public/admin/team-shared.js';

export const OVERVIEW_PDF = 'https://files.sunshineonaranneyday.com/advisory/SOARD_Advisory%20Board%20Overview.docx.pdf';

const YES_NO = ['Yes', 'No'];
const YES_MAYBE_NO = ['Yes', 'Maybe', 'No'];

export const ADVISORY_STEPS = [
  {
    id: 'you',
    short: 'About you',
    title: 'About you',
    intro: 'How to reach you, what you do, and a photo of you.',
    fields: [
      { id: 'fullName', label: 'Full name', type: 'text', required: true, autocomplete: 'name', max: 120 },
      { id: 'preferredName', label: 'Preferred name', hint: 'What you like to be called, if it’s different.', type: 'text', autocomplete: 'nickname', max: 60 },
      { id: 'email', label: 'Email address', type: 'email', required: true, autocomplete: 'email', max: 200 },
      { id: 'phone', label: 'Phone number', type: 'tel', required: true, autocomplete: 'tel', max: 40 },
      // One line that finds the address as it's typed (the application's suggestions); any words typed still count
      { id: 'address', label: 'Home address', type: 'address', autocomplete: 'street-address', max: 300 },
      { id: 'company', label: 'Employer or company', type: 'text', autocomplete: 'organization', max: 160 },
      { id: 'jobTitle', label: 'Job title', type: 'text', autocomplete: 'organization-title', max: 160 },
      { id: 'link', label: 'LinkedIn profile or website', hint: 'If you have one.', type: 'url', autocomplete: 'url', max: 300 },
      // Peter, Nov 16 2026: "headshot required". If they join, it's their photo on People → Advisory and the site
      { id: 'headshot', label: 'A headshot', hint: 'A clear, recent photo of your face. If you join the Advisory Board, it goes on our website. A phone photo works.', type: 'photo', required: true },
    ],
  },
  {
    id: 'interest',
    short: 'Interest',
    title: 'Your interest',
    intro: 'What draws you to SOARD and to the Advisory Board.',
    fields: [
      { id: 'heardFrom', label: 'How did you hear about the Advisory Board?', type: 'text', required: true, max: 300 },
      { id: 'why', label: 'Why are you interested in serving on the Advisory Board?', type: 'textarea', required: true, max: 3000 },
      { id: 'connection', label: 'What connects you to SOARD’s mission?', type: 'textarea', required: true, max: 3000 },
      { id: 'involved', brief: 'Involved before', label: 'Have you supported, volunteered with, attended an event for, or been involved with SOARD before?', type: 'choice', options: YES_NO, required: true },
      { id: 'involvedHow', label: 'How have you been involved with SOARD?', type: 'textarea', showIf: { involved: ['Yes'] }, max: 2000 },
    ],
  },
  {
    id: 'bring',
    short: 'Strengths',
    title: 'What you’d bring',
    intro: 'The board works together to fund one SOARD makeover every year.',
    fields: [
      { id: 'strengths', label: 'What strengths, experience, relationships, or skills would you hope to bring to the Advisory Board?', type: 'textarea', required: true, max: 3000 },
      { id: 'fundraising', label: 'How could you help the board reach its shared fundraising goal of $25,000?', type: 'textarea', required: true, max: 3000 },
      { id: 'introductions', brief: 'Introductions', label: 'Are you comfortable making introductions to potential donors, sponsors, partners, vendors, or volunteers?', type: 'choice', options: YES_MAYBE_NO, required: true },
      { id: 'networks', brief: 'Networks', label: 'Do you have relationships with people, businesses, foundations, community groups, or professional networks that may want to learn about SOARD?', type: 'choice', options: YES_MAYBE_NO, required: true },
      { id: 'networksMore', label: 'Tell us about the people or groups who may want to learn about SOARD', hint: 'Share only what you’re comfortable sharing.', type: 'textarea', showIf: { networks: ['Yes', 'Maybe'] }, max: 2000 },
      { id: 'conflict', brief: 'Conflict of interest', label: 'Do you have any relationship that could create a real or perceived conflict of interest with your service on the Advisory Board?', hint: 'Personal, professional, financial, or organizational: for example with vendors, contractors, donors, sponsors, partner organizations, grantmakers, board members, staff, or families SOARD serves.', type: 'choice', options: YES_NO, required: true },
      { id: 'conflictMore', label: 'Please briefly explain the possible conflict of interest', type: 'textarea', required: true, showIf: { conflict: ['Yes'] }, max: 2000 },
    ],
  },
  {
    id: 'commitment',
    short: 'Commitment',
    title: 'Commitment',
    intro: 'A one-year renewable term, with at least four meetings a year.',
    fields: [
      { id: 'hostEvent', brief: 'Hosting an event', label: 'Would you be interested in hosting or helping organize a small fundraiser, awareness event, or peer-to-peer campaign?', type: 'choice', options: YES_MAYBE_NO, required: true },
      { id: 'meetings', brief: 'Four meetings a year', label: 'Can you attend at least four meetings a year?', type: 'choice', options: YES_NO, required: true },
      { id: 'ambassador', brief: 'Ambassador', label: 'Will you serve as a positive ambassador for SOARD?', hint: 'Sharing our mission, supporting events and campaigns when you can, and helping grow awareness in the community.', type: 'choice', options: YES_NO, required: true },
      { id: 'meetingTimes', label: 'What days or times usually work best for meetings?', type: 'text', max: 300 },
      { id: 'hopeToGain', label: 'What do you hope to gain from serving on the Advisory Board?', type: 'textarea', max: 3000 },
      { id: 'anythingElse', label: 'Is there anything else you’d like us to know about you?', type: 'textarea', max: 3000 },
    ],
  },
  {
    id: 'reference',
    short: 'Reference',
    title: 'Reference and signature',
    intro: 'Someone who knows your work or your heart for service.',
    fields: [
      { id: 'refName', group: 'reference', label: 'Reference’s name', type: 'text', required: true, max: 120 },
      { id: 'refRelationship', group: 'reference', label: 'How you know them', type: 'text', required: true, max: 160 },
      { id: 'refEmail', group: 'reference', label: 'Reference’s email', type: 'email', required: true, max: 200 },
      { id: 'refPhone', group: 'reference', label: 'Reference’s phone', type: 'tel', max: 40 },
      { id: 'acknowledge', label: 'I have read and understand the Advisory Board expectations in the overview.', type: 'check', required: true },
      { id: 'signature', label: 'Type your full name to sign', type: 'text', required: true, autocomplete: 'name', max: 120 },
    ],
  },
];

export const ADVISORY_FIELDS = ADVISORY_STEPS.flatMap((s) => s.fields.map((f) => ({ ...f, step: s.id })));
/** The questions answered with a photo (the headshot) */
export const PHOTO_FIELDS = ADVISORY_FIELDS.filter((f) => f.type === 'photo');
/** A photo's answer: there or not */
export const PHOTO_ADDED = 'added';
/** The smallest a headshot may be on its shorter side: People's own least for a sharp photo on the site */
export const HEADSHOT_MIN = PHOTO_MIN;
/** From this size on its shorter side it's sharp at any size the site shows it (People's own) */
export const HEADSHOT_GOOD = PHOTO_GOOD;
/** The largest file the server takes for one (the page sends a JPEG at most 2400 pixels across, well under it) */
export const HEADSHOT_MAX_BYTES = 10 * 1024 * 1024;

/** A photo that didn't come whole (cut off partway), in words for the applicant */
export const HEADSHOT_CUT = 'That photo didn’t come through whole. Please choose it again, or another one.';
/** Any file that isn't a photo the site can use */
export const HEADSHOT_NOT_PHOTO = 'That file isn’t a photo we can use. Please choose a JPEG, PNG, WebP or HEIC photo.';

/** What's wrong with a headshot's size, in words for the applicant, or null */
export function headshotProblem(size) {
  const w = Number(size?.width) || 0;
  const h = Number(size?.height) || 0;
  if (!w || !h) return HEADSHOT_NOT_PHOTO;
  if (Math.min(w, h) < HEADSHOT_MIN) return `This photo is too small (${w} × ${h} pixels). Please choose a larger one, at least ${HEADSHOT_MIN} pixels on each side.`;
  // (a wide or tall photo is fine: the site uses the square around their face, as big as its short side)
  return null;
}
const BY_ID = Object.fromEntries(ADVISORY_FIELDS.map((f) => [f.id, f]));

/** Is this field asked, given the answers so far? (follow-ups show after a Yes) */
export function isShown(field, answers) {
  if (!field.showIf) return true;
  return Object.entries(field.showIf).every(([id, values]) => values.includes(answers?.[id]));
}

// A title before the name ("Dr. Jordan Smith"): not what to call them on its own. Hon and Gen are first names too
// (Hon Lam, Gen Tanaka): titles only with their dot ("Hon. Jordan Smith"); "The" goes with one after it ("The Honorable
// Jordan Ames")
export const TITLE = /^(?:(?:dr|mr|mrs|ms|mx|miss|rev|prof|fr|judge|sir|dame|capt|col|maj|lt|sgt)\.?|(?:hon|gen)\.|honorable|honourable|reverend)$/i;
// After a name, never part of it: a generation, or letters for a degree or credential ("Jordan Ames Jr", "Pat Lee
// PhD", "Dana Price CCIM", "Sam Roe SHRM-CP")
export const AFTER_NAME = /^(jr|sr|ii|iii|iv|cpa|phd|dds|dmd|dvm|jd|esq|mpa|mph|mha|msw|lcsw|lpc|lmft|psyd|edd|med|msc|dnp|rn|bsn|msn|np|pt|ot|aia|faia|cfp|cfa|cfe|cfre|cae|chfc|clu|pmp|shrm|shrmcp|shrmscp|sphr|phr|cpcu|leed|cgma|ccim|sior|cma|cisa|cissp|mfa|llm|mdiv)$/;
// Letters for a degree that are also family names (Chioma Mba, Jack Ma, Minh Do): letters only as written for one,
// after a comma, with dots, or in capitals in a name written in small letters ("Dana Price, MA", "Jordan Ames M.D.",
// "Dana Price MBA"), and never the only word left after the first
export const ALSO_A_NAME = /^(mba|ma|ms|md|do|pa|ra|pe|ba|bs|ap|ea)$/;
const bare = (w) => String(w).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const afterName = (raw, { comma = false, caps = false } = {}) => {
  const w = bare(raw);
  // ("J.R." with a dot between is initials, never "Jr.")
  if (/^(jr|sr)$/.test(w) && /^\p{L}\.\p{L}/u.test(raw)) return false;
  if (AFTER_NAME.test(w)) return true;
  return ALSO_A_NAME.test(w) && (comma || raw.includes('.') || (caps && raw === raw.toUpperCase()));
};
/**
 * A name as it's said, first name first, as written: "Ames, Jordan" (and "De La Cruz, Maria") is written last name
 * first; titles before it set apart ("Dr.", "The Honorable", "Mr. and Mrs."), and letters after it ("Dana Price, CPA",
 * "Jane Doe, ASID", "Jordan Ames M.D.", "Dana Price MBA"). → { words, titles, shown, could }
 *   shown: the name to show, first name first ("Ames, Jordan Jr." is "Jordan Ames Jr."; anything else as written)
 *   could: the words with a last word kept that might be a family name in capitals ("Anh Van DO"), when one was set
 *   apart as letters: matching tries both
 */
export function readName(full) {
  const s = String(full || '').replace(/\s+/g, ' ').trim();
  const parts = s.split(',').map((x) => x.trim()).filter(Boolean);
  const shouting = !/\p{Ll}/u.test(s);
  const lead = (p) => {
    const w = (p || '').split(' ').filter((x) => bare(x) || x === '&');
    const t = [];
    while (w.length > 1 && (TITLE.test(w[0]) || (/^the$/i.test(w[0]) && TITLE.test(w[1])) || (t.length && /^(and|&)$/i.test(w[0]) && TITLE.test(w[1])))) t.push(w.shift());
    return [w.filter((x) => bare(x)), t];
  };
  // Letters after a name, set apart (never the only word left after the first; a last word that might be a family
  // name in capitals kept as `could`)
  const trail = (w) => {
    const caps = /\p{Ll}/u.test(w.join(' ')); // (capitals mean letters only in a name that has small letters)
    const out = [...w];
    const off = [];
    let could = null;
    const end = () => out[out.length - 1];
    while (out.length > 1 && afterName(end(), { caps }) && (out.length > 2 || AFTER_NAME.test(bare(end())))) {
      if (!could && !AFTER_NAME.test(bare(end())) && !end().includes('.')) could = [...out];
      off.unshift(out.pop());
    }
    return [out, off, could];
  };
  // After a comma: letters after the name ("PE, CCIM", "Jr.", any in capitals: "ASID", "RD", or ending in one: "PharmD"),
  // else their first name, written last name first: after one word ("Ames, Jordan"), or, after more, a name's shape
  // ("De La Cruz, Maria"). A name all in capitals can't say which after more than one word: left as written
  // (initials with dots, "J.R.", are a first name, never letters: those it knows, "M.D.", it knows as letters)
  const initials = (t) => /^(\p{L}\.)+\p{L}?\.?$/u.test(t);
  const letters = (p) => p.split(' ').every((t) => afterName(t, { comma: true }) || (!shouting && !initials(t) && /\p{L}/u.test(t) && !/\p{Ll}/u.test(t)) || /\p{Ll}\p{Lu}\.?$/u.test(t));
  const nameShaped = (p) => { const w = p.split(' '); return w.length <= 3 && w.every((t) => /^\p{Lu}/u.test(t) && /\p{Ll}/u.test(t)); };
  const [head, t1] = lead(parts[0]);
  const flipped = parts.length > 1 && !letters(parts[1]) && (head.length === 1 || (!shouting && nameShaped(parts[1])));
  if (!flipped) {
    const [words, , could] = trail(head);
    return { words, titles: t1, shown: s, could };
  }
  const [tail, t2] = lead(parts[1]);
  const [first, firstOff] = trail(tail);
  const [last, lastOff] = trail(head);
  const titles = [...t1, ...t2];
  const rest = parts.slice(2);
  const shown = `${[...titles, ...first, ...last, ...lastOff, ...firstOff].join(' ')}${rest.length ? `, ${rest.join(', ')}` : ''}`;
  return { words: [...first, ...last], titles, shown, could: null };
}
/** What a thank-you calls them: the name they go by, else their first name past a title ("Mrs. Lee", alone, stays so) */
export function greetName(a) {
  const pref = String(a?.preferredName || '').trim().replace(/\s+/g, ' ');
  if (pref) return pref.slice(0, 60);
  const { words, titles } = readName(a?.fullName);
  if (!words.length) return '';
  // (a name typed all in capitals is greeted in ordinary ones: "AMES, JORDAN" is "Jordan", "MARY-KATE" is "Mary-Kate",
  // whatever titles or letters came with it)
  const shouted = !/\p{Ll}/u.test(words.join(' '));
  const calm = (w) => (shouted ? w.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (m, p, c) => p + c.toUpperCase()) : w);
  return (titles.length && words.length === 1 ? `${calm(titles[titles.length - 1])} ${calm(words[0])}` : calm(words[0])).replace(/[,;:]+$/, '');
}
export const EMAIL_RE = /^[^\s@<>",;]+@[^\s@<>"',;]+\.[a-z]{2,}$/i; // (an apostrophe is fine before the @: o'brien@)
// The mailer's own rule (_broadcast-notify.js isEmail, the one the sign-in list and private emails use too; a test keeps
// them the same): an address it would drop, or a person couldn't sign in with, is never taken from the form
export const MAILER_EMAIL = /^(?!\.)(?!.*\.\.)(?!.*\.@)[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:".]+(?:\.[^\s@<>()[\],;:".]+)*\.[^\s@<>()[\],;:".]{2,}$/;

/** A link people typed without https:// still works */
export function normalizeLink(s) {
  const t = String(s || '').trim();
  if (!t) return '';
  return /^https?:\/\//i.test(t) ? t : `https://${t.replace(/^\/+/, '')}`;
}

/** One answer, cleaned to what the field takes ('' when it's empty) */
function clean(field, raw) {
  if (field.type === 'check') return raw === true || raw === 'true' || raw === 'on' || raw === 'yes';
  if (field.type === 'photo') return raw === PHOTO_ADDED ? PHOTO_ADDED : '';
  // Words only: anything else sent as an answer (an object, a list) is no answer, never "[object Object]"
  if (raw != null && typeof raw !== 'string' && typeof raw !== 'number') return '';
  let v = String(raw ?? '').replace(/\r\n?/g, '\n');
  v = field.type === 'textarea' ? v.replace(/[ \t]+\n/g, '\n').trim() : v.replace(/\s+/g, ' ').trim();
  if (field.type === 'url') v = normalizeLink(v);
  if (field.type === 'email') v = v.toLowerCase();
  return v.slice(0, field.max || 500);
}

/** What's wrong with one answer, in words for the applicant, or null */
export function fieldProblem(field, value) {
  const empty = field.type === 'check' ? value !== true : !value;
  if (empty) {
    if (!field.required) return null;
    if (field.type === 'check') return 'Please confirm you’ve read the overview.';
    if (field.type === 'choice') return 'Please choose one.';
    if (field.type === 'photo') return 'Please add a headshot.';
    return 'Please fill this in.';
  }
  // (an ending no address has, "gmail.con", is a typo: the page's "Did you mean" says the fix)
  if (field.type === 'email' && (!EMAIL_RE.test(value) || !MAILER_EMAIL.test(value) || /^\.|\.\.|\.@|@[.-]/.test(value) || /\.(?:con|cmo|ocm|vom|xom|comm|coom|cpm|cim|nte|ent|nett|ogr|rog|orgg)$/i.test(value))) return 'That doesn’t look like an email address.';
  if (field.type === 'tel') {
    // Ten digits (a 1 before them, or a + number from abroad, is fine; so is a work line's extension), as the family application asks
    const d = String(value).replace(/\s*(?:x|ext\.?|extension)\s*\d{1,6}\s*$/i, '').replace(/[^\d+]/g, '');
    if (!/^(?:\+\d{8,15}|1?\d{10})$/.test(d)) return d.replace(/\D/g, '').length === 7 ? 'Please add the area code, like (404) 555-0123.' : 'Please enter a 10-digit phone number.'; // "555-1234", as the family form says it
    // Ten digits no one can dial (an area code or exchange starting 0 or 1, "123-456-7890")
    if (!d.startsWith('+') || d.startsWith('+1')) { const us = d.replace(/^\+?1(?=\d{10}$)/, ''); if (/^\d{10}$/.test(us) && !/^[2-9]\d{2}[2-9]/.test(us)) return 'That doesn’t look like a US phone number. Please check it.'; }
  }
  // A name (theirs, or typed to sign): at least two letters, never just "x"
  if (field.autocomplete === 'name' && (String(value).match(/\p{L}/gu) || []).length < 2) return 'Please type your full name.';
  // (an email address typed here, "jordan@example.com", isn't a link: said so, as the community form's website does)
  if (field.type === 'url' && /^(?:https?:\/\/)?(?:mailto:)?[^\s/@]+@[^\s/@]+\.[a-z]{2,}\/?$/i.test(value)) return 'That’s an email address. Please enter a web address, like linkedin.com/in/yourname.';
  if (field.type === 'url' && !isWebAddress(value)) return field.required ? 'That doesn’t look like a web address.' : 'That doesn’t look like a web address. Leave this blank if you don’t have one.';
  if (field.type === 'choice' && !field.options.includes(value)) return 'Please choose one.';
  return null;
}

/**
 * Clean every answer and check it. Unknown fields and follow-ups that don't
 * apply are left out. Returns { answers, problems } where problems maps a
 * field id to its message; `step` limits the check to one step's fields.
 */
/** A send turned back, in one line: the one answer's own words, or how many need a look (heard, and shown) */
export function problemsSaid(problems) {
  const all = Object.values(problems || {}).filter(Boolean);
  return all.length === 1 ? String(all[0]) : `${all.length} answers need a look.`;
}

export function checkAnswers(raw, { step = null } = {}) {
  const answers = {};
  for (const f of ADVISORY_FIELDS) answers[f.id] = clean(f, raw?.[f.id]);
  const problems = {};
  for (const f of ADVISORY_FIELDS) {
    if (!isShown(f, answers)) { delete answers[f.id]; continue; }
    if (step && f.step !== step) continue;
    const p = fieldProblem(f, answers[f.id]);
    if (p) problems[f.id] = p;
  }
  for (const [k, v] of Object.entries(answers)) if (v === '' || v === false) delete answers[k];
  return { answers, problems };
}

/** An answer as words for an email or the admin */
export function answerText(id, value) {
  const f = BY_ID[id];
  if (value == null || value === '') return '';
  if (f?.type === 'check') return value ? 'Yes' : 'No';
  return String(value);
}

/** The questions and answers, step by step, for an email or the admin (empty answers left out; the headshot is a picture, shown on its own) */
export function answerSections(answers) {
  return ADVISORY_STEPS.map((s) => ({
    id: s.id,
    title: s.title,
    items: s.fields.filter((f) => answers?.[f.id] != null && answers[f.id] !== '' && f.id !== 'acknowledge' && f.type !== 'photo').map((f) => ({ id: f.id, label: f.label, value: answerText(f.id, answers[f.id]) })),
  })).filter((s) => s.items.length);
}

/**
 * The Jotform application's questions → these ids (by the start of each
 * question, so small wording changes still match). Order matters: the first
 * pattern that fits wins.
 */
export const JOTFORM_FIELDS = [
  [/^full name/i, 'fullName'],
  [/^preferred name/i, 'preferredName'],
  [/^email address/i, 'email'],
  [/^phone number/i, 'phone'],
  [/^home address/i, 'address'],
  [/^employer/i, 'company'],
  [/^job title/i, 'jobTitle'],
  [/^linkedin/i, 'link'],
  [/^how did you hear/i, 'heardFrom'],
  [/^why are you interested/i, 'why'],
  [/^what connects you/i, 'connection'],
  [/^have you previously supported/i, 'involved'],
  [/^if yes, please describe/i, 'involvedHow'],
  [/^what strengths/i, 'strengths'],
  [/^how do you feel you could contribute/i, 'fundraising'],
  [/^are you comfortable making introductions/i, 'introductions'],
  [/^do you have relationships/i, 'networks'],
  [/^if yes or maybe/i, 'networksMore'],
  [/^would you be interested in hosting/i, 'hostEvent'],
  [/^are you able to commit/i, 'meetings'],
  [/^are you willing to serve/i, 'ambassador'],
  [/^what days or times/i, 'meetingTimes'],
  [/^what do you hope to gain/i, 'hopeToGain'],
  [/^is there anything else/i, 'anythingElse'],
  [/^reference name/i, 'refName'],
  [/^relationship$/i, 'refRelationship'],
  [/^reference email/i, 'refEmail'],
  [/^reference phone/i, 'refPhone'],
  [/^i have read and understand/i, 'acknowledge'],
  [/^applicant signature/i, 'signature'],
  [/^date$/i, 'signedOn'],
  [/^do you have any personal, professional/i, 'conflict'],
  [/^if yes, please briefly explain/i, 'conflictMore'],
];
