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

// A title before the name ("Dr. Jordan Smith", "Pastor John Smith", "Det. Jordan Ames"): not what to call them on its
// own. Hon, Gen, Rep, Sen, Det and Gov are names too (Hon Lam, Gen Tanaka, Amartya Sen): titles only with their dot
// ("Hon. Jordan Smith"); "The" goes with one after it ("The Honorable Jordan Ames")
export const TITLE = /^(?:(?:dr|drs|mr|mrs|ms|mx|miss|messrs|mmes|rev|prof|fr|judge|sir|dame|capt|col|maj|lt|sgt|supt|amb)\.?|(?:hon|gen|rep|sen|det|gov|sr|sra|srta|dra|lic|ing|arq|msgr|atty)\.|honorable|honourable|reverend|doctor|professor|captain|lieutenant|sergeant|colonel|admiral|pastor|father|rabbi|bishop|deacon|elder|minister|chaplain|imam|cantor|canon|sister|brother|coach|chef|senator|representative|governor|mayor|officer|detective)$/i;
// Of those, words that are names too (Bishop Briggs, Deacon Phillippe, Coach Lee): a title only before a whole name
// ("Bishop John Briggs"), or before a first name written after the family name ("Quill, Pastor Jordan")
const RANK = /^(?:pastor|father|rabbi|bishop|deacon|elder|minister|chaplain|imam|cantor|canon|sister|brother|coach|chef|senator|representative|governor|mayor|officer|detective)$/i;
// After a name, never part of it: a generation, or letters for a degree or credential ("Jordan Ames Jr", "Pat Lee
// PhD", "Dana Price CCIM", "Sam Roe SHRM-CP", "Dana Quill, DrPH")
export const AFTER_NAME = /^(jr|sr|ii|iii|iv|esquire|ret|retired|cpa|phd|pharmd|thd|eds|dds|dmd|dvm|jd|esq|mpa|mph|mha|msw|lcsw|lmsw|lpc|lcpc|lmft|psyd|edd|med|msc|bsc|bba|dba|dnp|rn|bsn|msn|np|pt|dpt|ot|otr|otrl|rd|ld|dc|od|rph|drph|scd|dsc|dmin|dma|mpp|mhs|msed|macc|mtax|pac|crna|cnm|fnp|aprn|lpn|lvn|emt|facs|facp|faap|fache|bcba|cccslp|atc|cscs|aia|faia|ncarb|ncidq|asid|ifma|cfp|cfa|cfe|cfre|cae|caia|frm|cia|chfc|clu|cdfa|ricp|cltc|aif|cpwa|crps|pmp|shrm|shrmcp|shrmscp|sphr|phr|cpcu|leed|cgma|ccim|sior|gri|crs|abr|srs|sres|cips|cma|cisa|cissp|mfa|llm|mdiv)$/;
// Letters for a degree, or a generation, that are also family names (Chioma Mba, Jack Ma, Minh Do, Ken Iida, Annalisa
// Cima, Olive Senior): letters only as written for one, after a comma, with dots, or in capitals in a name written in
// small letters ("Dana Price, MA", "Jordan Ames M.D.", "Dana Price MBA", "Jordan Quill, Senior"), and never the only
// word left after the first
export const ALSO_A_NAME = /^(mba|ma|ms|md|do|pa|ra|pe|ba|bs|ap|ea|iida|cima|senior|junior)$/;
// What someone does, or their company, written after a comma ("Jordan Quill, Realtor", "Dana Price, Acme Inc."): never a
// first name, whatever comes before the comma
const NOT_A_FIRST_NAME = /^(inc|llc|llp|pllc|ltd|corp|co|company|group|realty|realtor|owner|founder|cofounder|president|vice|vp|svp|evp|ceo|cfo|coo|cto|cmo|director|manager|partner|principal|broker|agent|designer|architect|engineer|attorney|lawyer|consultant|advisor|adviser|pastor|reverend|coach|chair|chairman|chairwoman|chairperson|trustee|member|volunteer|student)$/;
// A family name in parts, written last name first ("Van Buren, Martin", "De La Cruz, Maria", "St. James, Jordan"): a
// name of more than one word before a comma is a family name only when it starts with one of these (never "Maria de la
// Cruz, Wells Fargo", a first name before it)
const FAMILY_PART = /^(van|von|vander|der|den|de|del|della|degli|dei|des|di|da|das|dos|du|la|le|lo|st|ste|saint|sainte|ter|ten|bin|ibn|y)$/;
const bare = (w) => String(w).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const afterName = (raw, { comma = false, caps = false } = {}) => {
  const w = bare(raw);
  // ("J.R." with a dot between is initials, never "Jr.")
  if (/^(jr|sr)$/.test(w) && /^\p{L}\.\p{L}/u.test(raw)) return false;
  if (AFTER_NAME.test(w)) return true;
  // (a degree written with its dots, a word of more than one letter among them: "Pharm.D.", "M.Arch.", "D.Min." Names
  // have dots only as initials, "J.R.")
  if (/^(\p{L}+\.){2,}$/u.test(raw) && !/^(\p{L}\.)+$/u.test(raw)) return true;
  return ALSO_A_NAME.test(w) && (comma || raw.includes('.') || (caps && raw === raw.toUpperCase()));
};
/**
 * A name as it's said, first name first, as written: "Ames, Jordan" (and "De La Cruz, Maria") is written last name
 * first; titles before it set apart ("Dr.", "The Honorable", "Mr. and Mrs."), and letters after it ("Dana Price, CPA",
 * "Jane Doe, ASID", "Jordan Ames M.D.", "Dana Price MBA"). → { words, titles, shown, could, also }
 *   shown: the name to show, first name first ("Ames, Jordan Jr." is "Jordan Ames Jr."; anything else as written)
 *   could: the words with a last word kept that might be a family name in capitals ("Anh Van DO"), when one was set
 *   apart as letters: matching tries both
 *   also: the words read last name first, when what's after the comma might be a first name or might not ("Garcia
 *   Lopez, Maria", "Jordan Quill, McKinsey"): matching tries both, the name stays as written
 */
export function readName(full) {
  // (a title typed against the name, "Dr.Jordan Ames", "Rev.Dr.Jordan Ames", "Dr.jordan Ames", is still a title; and
  // initials typed against it are initials, "J.K.Rowling", "F.Scott Fitzgerald")
  const apart = (t) => {
    const m = t.match(/^(\p{L}+\.)(\p{L}.*)$/u);
    if (m && TITLE.test(m[1])) return `${m[1]} ${apart(m[2])}`;
    // (never a degree written with its dots, "M.Ed.", "D.Min.": a name after initials has no full stop of its own)
    const i = t.match(/^((?:\p{L}\.)+)(\p{L}{2,}(?:['’-]\p{L}+)*)$/u);
    return i ? `${i[1]} ${i[2]}` : t;
  };
  const s = String(full || '').replace(/\s+/g, ' ').trim().split(' ').map(apart).join(' ');
  const parts = s.split(',').map((x) => x.trim()).filter(Boolean);
  const shouting = !/\p{Ll}/u.test(s);
  // Titles set apart; a couple ("Jordan & Amy Quill", "Jordan Quill & Amy Lee", "Quill, Jordan and Dr. Amy") read as
  // the first one's name, the other's kept (`partner`: their name's words, titles set apart)
  const lead = (p, { tail = false } = {}) => {
    const w = (p || '').split(' ').filter((x) => bare(x) || x === '&');
    const t = [];
    // (the name after a title word that's also a name, its letters or generation left out: "Deacon Phillippe Jr." is
    // Deacon Phillippe, "Bishop John Briggs PhD" is Bishop + John Briggs)
    const nameAfter = (k) => { let e = w.length; while (e > k + 2 && afterName(w[e - 1], { caps: /\p{Ll}/u.test(w.join(' ')) })) e--; return e - k - 1; };
    const titleAt = (k) => TITLE.test(w[k]) && (!RANK.test(w[k]) || nameAfter(k) >= (tail ? 1 : 2));
    // (after a comma, a title on its own is one too: "Ames, Dr." is Dr. Ames)
    const lone = () => tail && w.length === 1 && TITLE.test(w[0]) && !RANK.test(w[0]);
    while ((w.length > 1 || lone()) && (titleAt(0) || lone() || (/^the$/i.test(w[0]) && TITLE.test(w[1])) || (t.length && /^(and|&)$/i.test(w[0]) && TITLE.test(w[1])))) t.push(w.shift());
    const at = w.findIndex((x, k) => k >= 1 && k < w.length - 1 && /^(&|and)$/i.test(x));
    let partner = null;
    if (at > 0) {
      const them = w.slice(at + 1).filter((x) => bare(x));
      while (them.length > 1 && TITLE.test(them[0])) them.shift();
      // (one first name before the "&": the family name is the one after the other's, "Jordan & Amy Quill")
      const initialsOf = (x) => { let k = 0; while (k < x.length - 1 && /^\p{L}\.?$/u.test(x[k])) k++; return k; };
      const theirs = initialsOf(them) >= 2 ? them.slice(0, initialsOf(them)) : them.slice(0, 1);
      partner = theirs;
      const family = at === 1 ? them.slice(theirs.length) : [];
      w.splice(at, w.length - at, ...family);
    }
    return [w.filter((x) => bare(x)), t, partner];
  };
  // Letters after a name, set apart (never the only word left after the first; a last word that might be a family
  // name in capitals kept as `could`)
  const trail = (w, { first = false } = {}) => {
    const caps = /\p{Ll}/u.test(w.join(' ')); // (capitals mean letters only in a name that has small letters)
    const out = [...w];
    const off = [];
    let could = null;
    const end = () => out[out.length - 1];
    // (a first name after a comma has no family name to keep: "Quill, Amy MD" is Amy, MD set apart)
    while (out.length > 1 && afterName(end(), { caps }) && (out.length > 2 || first || AFTER_NAME.test(bare(end())))) {
      if (!could && !AFTER_NAME.test(bare(end())) && !end().includes('.')) could = [...out];
      off.unshift(out.pop());
    }
    return [out, off, could];
  };
  // After a comma: letters after the name ("PE, CCIM", "Jr.", any of three or more capitals: "ASID", or ending in one:
  // "PharmD"; two capitals the site doesn't know are a name, "Quill, TJ"), or what they do ("Realtor", "Acme Inc.",
  // "Interior Designer"), else their first name, written last name first: after one word ("Ames, Jordan"), or one first
  // name after a family name in parts ("Van Buren, Martin", "DE LA CRUZ, MARIA", "St. James, Jordan"). After any other
  // name of more than one word it's words about them, never their first name ("Jordan Quill, Realtor", "Jordan Quill,
  // McKinsey", "Van Jones, Dream Corps"), and matching tries it both ways. (Initials with dots, "J.R.", are a first
  // name, never letters: those it knows, "M.D.", it knows as letters)
  const initials = (t) => /^(\p{L}\.)+\p{L}?\.?$/u.test(t);
  const capsLetters = (t) => !shouting && !initials(t) && t.replace(/[^\p{L}]/gu, '').length >= 3 && !/\p{Ll}/u.test(t);
  const letters = (p) => p.split(' ').every((t) => afterName(t, { comma: true }) || capsLetters(t) || /\p{Ll}\p{Lu}\.?$/u.test(t));
  const what = (p) => p.split(' ').some((t) => NOT_A_FIRST_NAME.test(bare(t)));
  // (a name typed all in small letters has its shape in small letters: "de la cruz, maria"; one in capitals, in capitals)
  const quiet = !/\p{Lu}/u.test(s);
  const nameShaped = (p) => { const w = p.split(' '); return w.length <= 3 && w.every((t) => (shouting ? /^\p{Lu}+(['’-]\p{Lu}+)*$/u.test(t) : (quiet ? /^\p{Ll}/u : /^\p{Lu}/u).test(t) && /\p{Ll}/u.test(t))); };
  // (one first name: after a family name in parts, more words are a company or a place as often as two first names:
  // "Van Jones, Dream Corps", "Del Taylor, Home Depot", never "Dream Corps Van Jones")
  // (a first name with initials, or initials alone, count as one: "Van Dyke, Jordan T.", "Du Bois, W. E. B.", "Van Dyke, TJ")
  const initialLike = (t) => /^\p{L}\.?$/u.test(t) || /^(\p{L}\.)+$/u.test(t) || /^\p{Lu}{2,3}$/u.test(t);
  const oneName = (p) => { const w = p.split(' ').filter(Boolean); const given = w.filter((t) => !initialLike(t)); return w.length > 0 && w.length <= 4 && given.length <= 1 && given.every((t) => nameShaped(t)); };
  const inParts = (h) => h.length > 1 && FAMILY_PART.test(bare(h[0]));
  const [head, t1, pair1] = lead(parts[0]);
  // (the family name's own words, its letters or generation set apart: "Ames Jr., Jordan" is one)
  const family = trail(head)[0];
  // What's after the comma, its titles set apart ("Quill, Pastor Jordan" is judged on "Jordan")
  const [tail, t2, pair2] = parts.length > 1 ? lead(parts[1], { tail: true }) : [[], [], null];
  const after = tail.join(' ');
  const flipped = parts.length > 1 && !!after && !letters(after) && !what(after) && (family.length === 1 || (inParts(family) && oneName(after)));
  if (!flipped) {
    const [words, , could] = trail(head);
    // (a name after the comma that could be theirs or could be a company or a place, "Garcia Lopez, Maria" as against
    // "Jordan Quill, McKinsey": left as written, matching tries it last name first too (`also`), and nothing guesses
    // which is their first name (`sure` false: greeted without one))
    const either = parts.length > 1 && family.length > 1 && !!after && !letters(after) && !what(after) && (nameShaped(after) || oneName(after));
    const also = either ? [...trail(tail, { first: true })[0], ...words] : null;
    // (a title alone after the comma, "Ames, Dr.", goes with the name)
    return { words, titles: after ? t1 : [...t1, ...t2], shown: s, could, also, partner: pair1, sure: !either };
  }
  const [first, firstOff] = trail(tail, { first: true });
  const [last, lastOff] = trail(head);
  const titles = [...t1, ...t2];
  const rest = parts.slice(2);
  const shown = `${[...titles, ...(pair2 ? [first[0], '&', ...pair2, ...first.slice(1)] : first), ...last, ...lastOff, ...firstOff].join(' ')}${rest.length ? `, ${rest.join(', ')}` : ''}`;
  return { words: [...first, ...last], titles, shown, could: null, also: null, partner: pair2, sure: true };
}
// What someone types for a name they don't have, or to say "the same" ("N/A", "None.", "Same as above", "Not
// applicable", "No preference"): never a name. ("Nil" is one: Turkish)
const NOT_A_NAME = /^(?:n\s?\/?\s?a|none|nope|no|null|nothing|same|ditto|tbd|x|-+|\?+|not applicable|no preference|no nickname|(?:same|as|see) above|same as (?:above|before|my (?:full |first |legal )?name|(?:full|first|legal) name|the full name))$/i;
/**
 * What a thank-you calls them: the name they go by, else their first name past a title ("Mrs. Lee", alone, stays so).
 * '' when the name can't say which is their first name ("Garcia Lopez, Maria"): greeted without one, never a guess
 */
export function greetName(a) {
  const pref = String(a?.preferredName || '').trim().replace(/\s+/g, ' ');
  // (one typed in small letters is greeted in ordinary ones, as a full name is)
  const tidy = (x) => (/\p{Lu}/u.test(x) ? x : x.replace(/(^|[\s\-'’])(\p{L})/gu, (m, p, c) => p + c.toUpperCase()));
  if (pref && /\p{L}/u.test(pref) && !NOT_A_NAME.test(pref.replace(/[.!,;:]+$/, '').trim())) return tidy(pref).slice(0, 60);
  const { words, titles, partner, sure } = readName(a?.fullName);
  if (!words.length || sure === false) return '';
  // (a name typed all in capitals is greeted in ordinary ones: "AMES, JORDAN" is "Jordan", "MARY-KATE" is "Mary-Kate",
  // whatever titles or letters came with it)
  // (and one typed all in small letters, "jordan ames", in ordinary ones too)
  const shouted = !/\p{Ll}/u.test(words.join(' ')) || !/\p{Lu}/u.test(words.join(' '));
  const cap = (w) => w.replace(/^\p{Ll}/u, (c) => c.toUpperCase()); // (a greeting never starts in a small letter: "Dr.jordan Ames")
  const calm = (w) => (shouted ? w.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (m, p, c) => p + c.toUpperCase()) : w);
  // (a first initial before the name they go by is never what to call them: "F. Scott Fitzgerald" is Scott; two or more
  // initials are the name they go by, together and in capitals: "J. K. Rowling" is J.K., "t j brooks" is TJ)
  const named = (ws, { more = true } = {}) => {
    const initial = (w) => /^\p{L}\.?$/u.test(w || '');
    let lead = 0;
    while (initial(ws[lead]) && lead < ws.length - (more ? 1 : 0)) lead++;
    if (lead >= 2) return ws.slice(0, lead).every((w) => w.endsWith('.')) ? `${ws.slice(0, lead).map((w) => w[0].toUpperCase()).join('.')}.` : ws.slice(0, lead).map((w) => w[0].toUpperCase()).join('');
    const w = ws.length >= 3 && lead === 1 ? ws[1] : ws[0];
    // (dotted initials as one word, "t.j.", in capitals)
    return /^(\p{L}\.)+$/u.test(w) ? w.toUpperCase() : calm(w);
  };
  const own = named(words);
  // (a title before one word: "Mrs. Lee"; a couple's titles before one family name: "Dr. and Mrs. Quill")
  const both = titles.some((x) => /^(and|&)$/i.test(x));
  const one = (titles.length && words.length === 1 ? `${(both ? titles : titles.slice(-1)).map((x) => (/^&$/.test(x) ? 'and' : calm(x))).join(' ')} ${own}` : own)
    // (an initial never ends in a full stop of its own, "J.": the sentence it's in has one)
    .replace(/[,;:]+$/, '').replace(/^(\p{L})\.$/u, '$1');
  // (a couple is greeted both: "Jordan and Amy", "Jordan and T.J.")
  return partner?.length ? `${cap(one)} and ${cap(named(partner, { more: false }))}` : cap(one);
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
