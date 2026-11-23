/**
 * The Advisory Board application: its questions in order, and the checks
 * both the page (/advisory-board/apply/) and the server run on the answers.
 * Its imports (the applications' web-address rule, People's smallest sharp
 * photo, and the given-names list the greeting reads) import nothing, so the
 * page's script can share it; the page never greets anyone, so its bundle
 * leaves the greeting and the list out (round 20, checked by building; round
 * 21 took out the never-greet list, which had shipped: see _given-names.js).
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
import { givenName, givenPair, familyFirst, titleToo, lettersToo, nameKey, womansName, titleBeforeNames, titlePair, familyFirstBefore, givenFamilyFirst } from './_given-names.js';

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
// More titles that go before a name (round 19, Nov 21 2026): civic, military with and without dots, religious, royal,
// courtesy and other languages' ("Commissioner", "Cmdr.", "Herr", "Doña", "Dott."). Round 20: only the greeting's check
// of the words after a first name uses them (and EITHER_TITLE's), never to find a name; the name kept on People and
// Add's web address read TITLE's alone, as before
const GREET_TITLE = /^(?:(?:cpt|cmdr|cdr|adm|cdre|brig|cpl|pvt|pfc|spc|ens|lcpl|ltc|ltg|ltjg|ssg|sfc|msg|sgm|csm|ssgt|msgt|tsgt|smsgt|cmsgt|gysgt|cwo|lcdr|radm|vadm|cllr|insp|tpr)\.?|(?:comm|commr|ald|del|dep|pres|sec|dir|evang|abp|mons|dcn|pr|br|ven|frl|dña|dott|avv|arch|geom|rag|sig|mtro|mtra|lcda|lcdo|profa|eng|engr|mag|mevr|dhr|smt|mme|mlle)\.|mme|mlle|dott\.ssa|dr\.ssa|prof\.ssa|sig\.ra|sig\.na|dr\.?-ing\.?|dipl\.?-ing\.?|univ\.?-prof\.?|priv\.?-doz\.?|co-?pastor|commissioner|councilman|councilwoman|councilmember|councilperson|councillor|councilor|alderman|alderwoman|alderperson|selectman|selectwoman|assemblyman|assemblywoman|assemblymember|congressman|congresswoman|congressperson|congressmember|delegate|speaker|sheriff|marshal|constable|trooper|deputy|inspector|superintendent|commander|commodore|general|brigadier|corporal|private|specialist|ensign|airman|seaman|chief|ambassador|consul|president|premier|provost|principal|director|secretary|magistrate|attorney|agent|nurse|apostle|evangelist|prophet|prophetess|archbishop|cardinal|monsignor|vicar|rector|curate|parson|abbot|abbess|prior|prioress|deaconess|pastora|venerable|pope|swami|guru|pandit|acharya|lama|sheikh|shaikh|shaykh|sheik|mufti|hajji|haji|hajjah|ustadh|ustaz|ustadha|maulana|mullah|mother|uncle|aunt|auntie|lady|lord|baroness|countess|count|duchess|viscount|viscountess|marchioness|emperor|empress|maharaja|mister|missus|madam|madame|mademoiselle|monsieur|herr|frau|fräulein|señor|senor|señora|senora|señorita|senorita|doña|signor|signora|signorina|mevrouw|meneer|pani)$/iu;
// (titles that are first names as often: never a family name after a first name in a greeting, "Jordan Major")
const EITHER_TITLE = /^(?:don|major|master)$/i;
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
// Degrees written with a dot inside ("M.Ed", "M.Arch", "D.Phil", "B.Arch", "M.Eng"): letters only when written so, since
// some are words or names on their own ("March", "Bed", "Arch")
const DOTTED_DEGREE = /^(med|mdiv|msc|march|barch|meng|beng|bpharm|mpharm|mdes|mphil|dphil|mlitt|dlitt|mlis|bed|bsc|bfa|mfa|mpa|mph|mba|msw|mth|thm|dmin|edd|edm|mmus|dmus|bmus|llb|llm|mcp|mup|mla|bla|mcs)$/;
// The first word of a family name in parts ("De La Cruz", "St. James", "Van Dyke"): some never a first name (`NEVER`),
// others a first name too ("Van Morrison", "Del Taylor", "La Donna", "Le Thi Hoa")
const FAMILY_START = /^(de|di|da|du|des|della|delle|degli|dei|dos|das|von|der|den|ter|ten|st|ste|saint|sainte|bin|ibn|van|vander|del|la|le|lo)$/;
const FAMILY_START_NEVER = /^(de|di|da|du|des|della|delle|degli|dei|dos|das|von|der|den|ter|ten|st|ste|saint|sainte|bin|ibn)$/;
// Degrees written without their dots, their capitals kept ("MEng", "BArch", "BPharm", "MSc", "MPhil"): letters too. A
// name never has a capital second with small letters after it ("McKenzie", "DeShawn", "March" stay names)
const CAMEL_DEGREE = /^[MBD]\p{Lu}\p{Ll}{1,6}\.?$/u;
const bare = (w) => String(w).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const afterName = (raw, { comma = false, caps = false } = {}) => {
  const w = bare(raw);
  // ("J.R." with a dot between is initials, never "Jr.")
  if (/^(jr|sr)$/.test(w) && /^\p{L}\.\p{L}/u.test(raw)) return false;
  if (AFTER_NAME.test(w)) return true;
  if (CAMEL_DEGREE.test(raw)) return true;
  // (a degree written with dots inside and none at the end: a letter or two, then more, a part of two letters or more
  // among them: "M.Ed", "M.Eng", "B.Pharm", "M.Sc.Ed", "M.Ed.S", "Dr.PH"; never all single letters, initials "J.R."; never
  // a family name in parts typed together, "St.James")
  if (/^\p{L}{1,2}\.(?:\p{L}+\.)*\p{L}+\.?$/u.test(raw) && !/^(?:\p{L}\.)+\p{L}?\.?$/u.test(raw) && !FAMILY_START.test(bare(raw.split('.')[0]))) return true;
  // (a degree written with its dots, a word of more than one letter among them: "Pharm.D.", "M.Arch.", "D.Min." Names
  // have dots only as initials, "J.R.")
  if (/^(\p{L}+\.){2,}$/u.test(raw) && !/^(\p{L}\.)+$/u.test(raw)) return true;
  return ALSO_A_NAME.test(w) && (comma || raw.includes('.') || (caps && raw === raw.toUpperCase()));
};
// Letters typed in pieces with spaces ("Ph. D.", "Ph. D", "M. Eng", "B. Arch", "M. D.", "M. B. A."): one set of letters, as
// typed together, when they're ones the file knows ("M.Eng", "M.D.", "PhD") or all have their dots with a piece of more
// than one letter among them ("Ph. D.", "Ed. D.", "D. Min."). Never a name after an initial ("T. Lee" is T. Lee), and
// single letters only where they can't be initials (`singles`: after a family name, never after a first name, "Ames,
// Jordan M. D.")
const knownLetters = (b) => AFTER_NAME.test(b) || ALSO_A_NAME.test(b) || DOTTED_DEGREE.test(b);
const inPieces = (ps, singles) => {
  if (ps.length < 2 || !ps.slice(0, -1).every((x) => /^\p{L}{1,5}\.$/u.test(x)) || !/^\p{L}{1,4}\.?$/u.test(ps[ps.length - 1])) return false;
  const longer = ps.some((x) => bare(x).length > 1);
  if (!singles && !longer) return false;
  const one = ps.join('');
  return afterName(one) && ((longer && ps.every((x) => x.endsWith('.'))) || knownLetters(bare(one)));
};
// (how many words at the end are letters in pieces, a word before them left: 0 when they aren't)
const piecesAtEnd = (ws, singles) => [3, 2].find((k) => ws.length > k && inPieces(ws.slice(-k), singles)) || 0;
// (the words with each set of letters in pieces made one word, "Ph. D." as "Ph.D.")
const joinPieces = (ws, singles) => {
  const out = [];
  for (let k = 0; k < ws.length;) {
    const n = [3, 2].find((m) => k + m <= ws.length && inPieces(ws.slice(k, k + m), singles));
    out.push(n ? ws.slice(k, k + n).join('') : ws[k]);
    k += n || 1;
  }
  return out;
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
 *   address: (round 20, rule 8) the words a new record's web address is made from, when they aren't `words`: a name
 *   written with a comma that stays in the order typed ("Jordan, Amy and Sam Rowe"); and (round 21) one with more than one
 *   word before the comma: all of it when what's after the comma starts with a given name ("De La Cruz, Maria" is
 *   de-la-cruz-maria), else the words before the comma ("Jordan Ames, she/her" is jordan-ames)
 *   apart: (round 21) for such a name, the words before the comma alone, matched only against a name that's all of them
 *   ("Del Taylor, Compass" might be Del Taylor; "De La Cruz, Jose" is never "De La Cruz, Maria"). Its `words` are all of it
 *   Round 22: a whole name before the comma (starting with a given name: "Jordan Ames, Atlanta", "Jordan Ames, Grace
 *   Church") is read as that whole name alone, for matching and the address; "Family, Given" (all of it in the address)
 *   only for a family name on its own before the comma and a given name after it, with no place or organization in it
 * Round 20 (Nov 21 2026): the greeting no longer reads names with this (greetName reads its own plain shape); and a name
 * written last name first is put first name first only when it's clearly one family name and the given names of one
 * person or of a couple who share it (rule 8, below)
 */
export function readName(full) {
  const isTitle = (w) => TITLE.test(w);
  const isRank = (w) => RANK.test(w);
  // (a title typed against the name, "Dr.Jordan Ames", "Rev.Dr.Jordan Ames", "Dr.jordan Ames", is still a title; and
  // initials typed against it are initials, "J.K.Rowling", "F.Scott Fitzgerald")
  // (with a comma typed against it too, "J.K.Rowling, PhD"; and before a name with an apostrophe, "T.J.O'Brien"). Only
  // where a name starts, nothing before it but titles: a title at the start of the name, after a comma or after "&"
  // (`titles`), initials at the start of the name or after "&" (`lead`); anywhere else it's letters, "Jordan Ames M.Eng",
  // "Jordan Ames Dr.PH", "Jordan Ames, M.Eng"
  const apart = (t, lead, titles = lead) => {
    // (the commas, semicolons and colons at its end, counted back from the end: round 21, never a pattern of two parts
    // that could each take them, which tries every way to share them out)
    let cut = t.length;
    while (cut > 0 && ',;:'.includes(t[cut - 1])) cut--;
    const [core, end] = [t.slice(0, cut), t.slice(cut)];
    const m = core.match(/^(\p{L}+\.)(\p{L}.*)$/u);
    if (m && titles && isTitle(m[1])) return `${m[1]} ${apart(m[2] + end, lead, titles)}`;
    if (!lead) return t;
    // (never a degree written with its dots, "M.Ed.", "D.Min.", "M.Ed": a name after initials has no full stop of its
    // own, and isn't a degree's letters)
    const i = core.match(/^((?:\p{L}\.)+)(\p{L}(?:\p{L}|['’-]\p{L})+)$/u);
    return i && !AFTER_NAME.test(bare(core)) && !DOTTED_DEGREE.test(bare(core)) ? `${i[1]} ${i[2]}${end}` : t;
  };
  const typed = [];
  let atName = true;
  let atPart = true;
  // (an "&" after a name starts another name, "Jordan & T.J.Amy"; one between titles only joins them, and what's after
  // them is read as it would be after the first title: "Quill, Mr. & Mrs. B.Arch" is letters after a comma, never B. Arch)
  let named = false;
  for (const t of String(full || '').replace(/\s+/g, ' ').trim().split(' ')) {
    const a = apart(t, atName, atPart);
    typed.push(a);
    if (/^(&|and)$/i.test(t)) { atName = atName || named; atPart = true; } else if (/,$/.test(t)) { atName = false; atPart = true; named = false; } else if (!a.split(' ').every((y) => isTitle(y))) { atName = false; atPart = false; named = true; }
  }
  const s = typed.join(' ');
  const parts = s.split(',').map((x) => x.trim()).filter(Boolean);
  const shouting = !/\p{Ll}/u.test(s);
  const quietName = !/\p{Lu}/u.test(s);
  // Titles set apart; a couple ("Jordan & Amy Quill", "Jordan Quill & Amy Lee", "Quill, Jordan and Dr. Amy") read as
  // the first one's name, the other's kept (`partner`: their name's words, titles set apart)
  const lead = (p, { tail = false, lone: loneOk = true } = {}) => {
    const w = (p || '').split(' ').filter((x) => bare(x) || x === '&');
    const t = [];
    // (the name after a title word that's also a name, its letters or generation left out: "Deacon Phillippe Jr." is
    // Deacon Phillippe, "Bishop John Briggs PhD" is Bishop + John Briggs, "Bishop Quill Ph. D." Bishop Quill)
    const noCase = shouting || quietName;
    const nameAfter = (k) => {
      let e = w.length;
      for (;;) {
        const n = piecesAtEnd(w.slice(k + 1, e), true);
        if (n) e -= n;
        else if (e > k + 2 && (afterName(w[e - 1], { caps: /\p{Ll}/u.test(w.join(' ')) }) || (noCase && ALSO_A_NAME.test(bare(w[e - 1]))))) e--;
        else return e - k - 1;
      }
    };
    const after = () => (tail ? 1 : 2);
    const titleAt = (k) => isTitle(w[k]) && (!isRank(w[k]) || nameAfter(k) >= after(k));
    // (after a comma, a title on its own is one too: "Ames, Dr." is Dr. Ames. Only after one family name (`lone` false
    // otherwise): after a whole name what's after the comma is letters, "Jordan Ames, Dr." never a title for it. And never
    // one written as letters are, in capitals without a dot in a name with small letters: "Ames, MS" is Ames with a
    // degree, as "Lee, MD" is Lee, and "Mrs. Quill, MS" Mrs. Quill)
    const asLetters = (x) => !shouting && !x.includes('.') && bare(x).length > 1 && x === x.toUpperCase() && knownLetters(bare(x));
    const lone = () => loneOk && tail && w.length === 1 && isTitle(w[0]) && !isRank(w[0]) && !asLetters(w[0]);
    while ((w.length > 1 || lone()) && (titleAt(0) || lone() || (/^the$/i.test(w[0]) && isTitle(w[1])) || (t.length && /^(and|&)$/i.test(w[0]) && isTitle(w[1])))) {
      t.push(w.shift());
    }
    // ("and family" after a name is no one else: "Jordan Rowe and family" is Jordan Rowe)
    const fam = w.findIndex((x, i) => i >= 1 && /^(&|and)$/i.test(x) && /^(?:(?:the|my|our) )?famil(?:y|ies)$/i.test(w.slice(i + 1).join(' ')));
    if (fam > 0) w.splice(fam);
    const at = w.findIndex((x, k) => k >= 1 && k < w.length - 1 && /^(&|and)$/i.test(x));
    let partner = null;
    if (at > 0) {
      const them = w.slice(at + 1).filter((x) => bare(x));
      const theirTitles = [];
      while (them.length > 1 && isTitle(them[0])) theirTitles.push(them.shift());
      // (a title alone after the "&", written last name first: "Quill, Jordan & Mrs." is Jordan and Mrs. Quill)
      if (tail && them.length === 1 && isTitle(them[0]) && !isRank(them[0])) theirTitles.push(them.shift());
      const initial = (x) => /^\p{L}\.?$/u.test(x);
      const initialsOf = (x) => { let k = 0; while (k < x.length && initial(x[k])) k++; return k; };
      // (their name without letters or a generation after it: "Mrs. Quill MD", "Mrs. Quill Jr.")
      const core = them.length ? trail(them, { first: true })[0] : [];
      // (a title and a family name alone: "Jordan & Mrs. Quill" is Jordan Quill and Mrs. Quill, "Jordan Quill & Mrs.
      // Lee" Jordan Quill and Mrs. Lee, "Jordan & Mrs. St. James" Jordan St. James and Mrs. St. James: no first name of
      // theirs to call them by, or to match them on People with. After a comma one word is their first name, "Quill,
      // Jordan & Dr. Amy" is Jordan and Amy, but never a family name in parts, "Quill, Jordan & Mrs. De La Cruz", nor after
      // Mr., Mrs., Ms. or Miss, which go before a family name: "Quill, Jordan & Mrs. Lee" is Jordan Quill and Mrs. Lee)
      const inParts = core.length > 1 && FAMILY_START.test(bare(core[0]));
      // (unless the first one has a title on their first name too: "Quill, Mr. Jordan & Mrs. Amy" is Mr. Jordan and Mrs.
      // Amy Quill, the titles alike on each one's first name, as "Quill, Dr. Jordan & Dr. Amy")
      const beforeFamily = !t.length && theirTitles.some((x) => /^(?:mr|mrs|ms|miss)\.?$/i.test(x));
      const titledFamily = theirTitles.length > 0 && core.length > 0 && (inParts || (core.length === 1 && (!tail || beforeFamily)));
      const titleOnly = theirTitles.length > 0 && !them.length;
      const theirs = titledFamily ? [...core] : initialsOf(them) >= 2 ? them.slice(0, initialsOf(them)) : them.slice(0, 1);
      // (one first name before the "&", or initials: the family name is the one after the other's, "Jordan & Amy
      // Quill", "T. J. & Amy Quill")
      const firstOnly = at === 1 || w.slice(0, at).every(initial);
      // (after a comma, a family name of their own is theirs alone: the first one's is the one before the comma)
      const ownFamily = tail && titledFamily;
      const family = firstOnly && !ownFamily ? (titledFamily ? [...core] : them.slice(theirs.length)) : [];
      partner = theirs;
      partner.ownFamily = ownFamily;
      // (a family name of their own after the other one's first name, letters after it aside: "Jordan, Amy and Sam
      // Rowe" has one, Sam Rowe's; "Rowe, Jordan & Amy" and "Rowe, Jordan & Amy MD" none. Rule 8, round 20)
      partner.shared = family.length > 0 && !titledFamily && core.length > theirs.length;
      // (their titles kept for their name as shown, "Rowe, Jordan & Dr. Amy" is Jordan & Dr. Amy Rowe; greeted by one
      // only with no first name to greet them by, `familyOnly`)
      partner.titles = theirTitles;
      partner.familyOnly = titledFamily || titleOnly;
      // (their own whole name, to match them on People too: "Jordan & Amy Rowe" might be Amy Rowe. Letters after it are
      // never part of it, as they're never part of the first one's: "Jordan & Amy Rowe MD", "Jordan Rowe & Amy Lee CPA",
      // "Rowe, Jordan & Amy MD" are Amy Rowe and Amy Lee, and a last word that might be a family name in capitals is
      // kept as `could`, "Jordan & Anh Van DO", as the first one's is. After a comma their first name has no family name
      // of its own to keep, "Rowe, Jordan & Amy MD": the one before the comma is theirs)
      partner.whole = null;
      if (!titledFamily && !titleOnly) {
        const [own, , could] = trail(firstOnly ? [...theirs, ...family] : them, { first: tail });
        partner.whole = own;
        if (could) partner.could = could;
      }
      w.splice(at, w.length - at, ...family);
    }
    return [w.filter((x) => bare(x)), t, partner];
  };
  // Letters after a name, set apart (a last word that might be a family name in capitals kept as `could`). Letters that
  // are only ever letters (on AFTER_NAME's list, written with dots, a degree with its capitals: "PhD", "M.Eng", "MEng",
  // "M.B.A.") whatever is left: "Mrs. Quill M.Eng" is Mrs. Quill. Ones that are family names too ("MD", "MBA", "MA", "Do",
  // ALSO_A_NAME's) never as the only word left after the first, "Jack MA", unless a title is before it, which makes that
  // word a family name with letters after it: "Mrs. Quill MBA" is Mrs. Quill (`titles`, the ones before the name). Typed
  // in pieces they're the same letters: "Mrs. Quill Ph. D.", "Mrs. Quill M. Eng", "Jordan Ames M. D." (inPieces)
  const trail = (w, { first = false, titles: before = [] } = {}) => {
    const titled = before.length > 0;
    // (capitals mean letters only in a name that has small letters, its titles counted: "Dr. QUILL MD" has, so MD is
    // letters after a family name in capitals, as "Dr. Quill MD")
    const caps = /\p{Ll}/u.test([...before, ...w].join(' '));
    const out = [...w];
    const off = [];
    let could = null;
    const end = () => out[out.length - 1];
    const alsoAName = (x) => ALSO_A_NAME.test(bare(x)) && !x.includes('.');
    // (a first name after a comma has no family name to keep: "Quill, Amy MD" is Amy, MD set apart)
    for (;;) {
      const n = piecesAtEnd(out, !first);
      if (n) off.unshift(...out.splice(-n));
      else if (out.length > 1 && afterName(end(), { caps }) && (out.length > 2 || first || titled || !alsoAName(end()))) {
        if (!could && alsoAName(end())) could = [...out];
        off.unshift(out.pop());
      } else break;
    }
    // (after a comma, a first name typed all in capitals or all in small letters with letters that are names too after
    // it, "AMES, JORDAN MD": the letters set apart, the family name being before the comma; matching tries them kept too)
    if (first && !could && out.length > 1 && (shouting || quietName) && ALSO_A_NAME.test(bare(end()))) { could = [...out]; off.unshift(out.pop()); }
    // (and after a title, one word and letters that are names too, typed all in capitals or all in small letters, "MRS.
    // QUILL MBA": the word after the title is the family name, the letters set apart; matching tries them kept too)
    if (titled && !first && !could && out.length === 2 && (shouting || quietName) && ALSO_A_NAME.test(bare(end()))) { could = [...out]; off.unshift(out.pop()); }
    // (a name typed all in capitals or all in small letters can't say whether "MD" ends it as letters or as a family name:
    // kept, and matching tries it without them too, "JORDAN AMES MD" as Jordan Ames)
    if (!could && !first && out.length > 2 && !caps && ALSO_A_NAME.test(bare(end()))) could = out.slice(0, -1);
    else if (!could && !first && out.length > 2 && quietName && ALSO_A_NAME.test(bare(end()))) could = out.slice(0, -1);
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
  // (`titles`: a title is letters there too, after a name that can't take one after the comma, see `oneFamily`; `singles`:
  // single letters in pieces are letters, "M. D.", where they can't be a first name's initials, after a whole name)
  const letters = (p, { titles = false, singles = false } = {}) => joinPieces(p.split(' '), singles)
    .every((t) => afterName(t, { comma: true }) || capsLetters(t) || /\p{Ll}\p{Lu}\.?$/u.test(t) || (titles && isTitle(t) && !isRank(t)));
  const what = (p) => p.split(' ').some((t) => NOT_A_FIRST_NAME.test(bare(t)));
  // (one first name: after a family name in parts, more words are a company or a place as often as two first names:
  // "Van Jones, Dream Corps", "Del Taylor, Home Depot", never "Dream Corps Van Jones")
  const [head, t1, pair1] = lead(parts[0]);
  // (the family name's own words, its letters or generation set apart: "Ames Jr., Jordan" is one)
  const family = trail(head, { titles: t1 })[0];
  // One family name before the comma ("Ames", "Van Dyke", "St. James", "De La Cruz", "Mrs. Ames"): only then is a title
  // after the comma one for it ("Ames, Dr." is Dr. Ames; "Quill, Mr. & Mrs. PhD" Mr. and Mrs. Quill, the letters after the
  // titles set apart). After a whole name ("Jordan Ames, MS", "Jordan Ames, Dr.", "Dr. Jordan Ames, MS", "Jordan & Amy
  // Rowe, MS") what's after the comma is letters, never a title for it, as the live site read them (Nov 21 2026, round
  // 18). ("Mrs. Quill, MS" is Mrs. Quill too: MS in capitals is letters, `asLetters` in lead)
  const oneFamily = !pair1 && (family.length === 1 || (family.length > 1 && FAMILY_START.test(bare(family[0]))));
  const wholeName = !!pair1 || (family.length > 1 && !FAMILY_START.test(bare(family[0])));
  // What's after the comma, its titles set apart ("Quill, Pastor Jordan" is judged on "Jordan")
  const [tail, t2, pair2] = parts.length > 1 ? lead(parts[1], { tail: true, lone: oneFamily }) : [[], [], null];
  const after = tail.join(' ');
  const lettersAfter = !!after && letters(after, { titles: !oneFamily, singles: wholeName });
  // Round 22 (finding 5): a place or an organization right after the comma ("Grace Church", "Sandy Springs", "Mercy
  // Hospital", "Atlanta") is never a first name, whatever is before it ("Ames, Grace Church" is never Grace Church Ames).
  // (More after another comma is rule 8's, below: "Ames, Jordan, Atlanta" is Jordan Ames, kept in the order typed)
  const placeAfter = !!after && placeOrOrg(parts[1]);
  // Last name first only after one word ("Ames, Jordan"). After more than one, nothing can say whether it's a family
  // name in parts and a first name ("Van Buren, Martin", "Garcia Lopez, Maria") or a name and a company or place ("Del
  // Taylor, Compass", "Jordan Quill, McKinsey"): kept as written, matched both ways, and greeted with no first name
  const flipped = parts.length > 1 && !!after && !lettersAfter && !what(after) && !placeAfter && family.length === 1;
  if (!flipped) {
    const [words, , could] = trail(head, { titles: t1 });
    // (a name after the comma that could be theirs or could be a company or a place, "Garcia Lopez, Maria" as against
    // "Jordan Quill, McKinsey": left as written, matching tries it last name first too (`also`), and nothing guesses
    // which is their first name (`sure` false: greeted without one))
    const ambiguous = parts.length > 1 && family.length > 1 && !!after && !lettersAfter && !what(after);
    // (what's after the comma, its letters set apart, and whether it starts with a given name on the list or a pair)
    const tailFirst = ambiguous ? trail(tail, { first: true })[0] : [];
    const tailGiven = tailFirst.length > 0 && (!!listedGiven(tailFirst[0]) || (tailFirst.length > 1 && !!givenPair(tailFirst[0], tailFirst[1])));
    // (a family name's first word, "De", "van", "St.", or the Arabic "Al" and "El", a given name too: "Al Fayed")
    const particle = family.length > 1 && (FAMILY_START.test(bare(family[0])) || /^(?:al|el)$/u.test(bare(family[0])));
    // Round 22 (findings 5 and 6, the lead's rule): more than one word before the comma, starting with a given name or
    // initials ("Jordan Ames", "J. R. Ames", "Jordan & Amy Rowe"), is a whole name, and that whole name is the reading,
    // whatever is after the comma: its words alone are what Add matches people on and makes the web address from
    // ("Jordan Ames, Atlanta" and "Jordan Ames, Decatur" are both Jordan Ames, at jordan-ames; "Jordan Ames, Grace Church"
    // and "Jordan Ames, Edward Jones" too). Its People name stays as typed, and `sure` is as before (nothing reads it).
    // A first word that's a family name's first word as often ("Al") is the family name's when a given name follows the
    // comma ("Al Fayed, Mohammed"), the given name's otherwise ("Al Green, Atlanta")
    const headWhole = ambiguous && (!!pair1 || ((!!listedGiven(family[0]) || initials(family[0])) && !(particle && tailGiven)));
    // (else a family name on its own: in parts, "De La Cruz", "van der Berg", "St. James", "Al Fayed", or of words none of
    // which is a given name, "Garcia Lopez": the only names read "Family, Given", below)
    const headFamily = ambiguous && !headWhole && (particle || family.every((w) => !listedGiven(w)));
    const either = ambiguous && !headWhole;
    const tailWords = either ? tailFirst : [];
    const also = either ? [...tailWords, ...words] : null;
    // (a title alone after the comma, "Ames, Dr.", "Van Dyke, Dr.", goes with the name, all of it a family name; so do
    // titles with letters after them, "Quill, Mrs. PhD", "Quill, Mr. & Mrs. B.Arch")
    const withTitles = oneFamily && t2.length > 0 && (!after || lettersAfter);
    const familyOnly = parts.length > 1 && withTitles;
    // (a couple after the comma, "Garcia Lopez, Maria & Jose": the other one by their name with the family name too)
    const partnerWhole = pair1?.whole || (either && pair2?.length && !pair2.familyOnly ? [...pair2, ...words] : null);
    // (and their whole name with a last word kept that might be a family name in capitals, as `could` is the first one's)
    const partnerCould = pair1?.whole ? pair1.could || null : null;
    if (either) {
      // Round 21 (finding 6): such a name is all of it, as typed, and it's matched as all of it ("De La Cruz, Jose" is
      // never asked about "De La Cruz, Maria"). The words before the comma alone (`apart`) are matched only against a name
      // that's all of them: "Del Taylor, Compass" might be Del Taylor, and is still asked about him (round 15). Its web
      // address is every word in the order typed, its titles, letters and "&" set apart, as rule 8's are, only when it's
      // the "Family, Given" shape, what's after the comma starting with a given name on the list or a pair on the pairs
      // list ("De La Cruz, Maria" is at de-la-cruz-maria, never de-la-cruz; "Garcia Lopez, Ana" at garcia-lopez-ana);
      // otherwise, pronouns, a place, a company or a job after the comma, the words before it alone, as round 20 had it
      // ("Jordan Ames, she/her" and "Jordan Ames, Atlanta" are at jordan-ames, "Del Rey, Compass" at del-rey). The lead,
      // Nov 22 2026
      //   Round 22 (finding 5): "Family, Given" only when what's before the comma is a family name on its own (headFamily)
      // and what's after it starts with a given name and has no place or organization in it ("De La Cruz, Grace Church" is
      // at de-la-cruz). A whole name before the comma never gets here (headWhole, above)
      const given = headFamily && tailGiven && !placeOrOrg(parts.slice(1).join(' '));
      const address = given ? s.split(/[\s,]+/).filter((t) => t && t !== '&' && !isTitle(t) && !afterName(t, { caps: /\p{Ll}/u.test(s) })) : words;
      return { words: [...words, ...tailWords], titles: withTitles ? [...t1, ...t2] : t1, shown: s, could: could ? [...could, ...tailWords] : null, also,
        apart: [words, ...(could ? [could] : [])], partner: pair1, partnerWhole, partnerCould, sure: false, familyOnly, address };
    }
    return { words, titles: withTitles ? [...t1, ...t2] : t1, shown: s, could, also, partner: pair1, partnerWhole, partnerCould, sure: !ambiguous, familyOnly };
  }
  const [first, firstOff, firstCould] = trail(tail, { first: true });
  const [last, lastOff] = trail(head);
  const titles = [...t1, ...t2];
  const rest = parts.slice(2);
  // (a couple with one word for the second and more after another comma, "Quill, Jordan & Lee, Amy" as against "Quill,
  // Jordan & Amy, Atlanta": the second's first name or a place, nothing can say which; kept as written, greeted without
  // a first name)
  if (pair2?.length === 1 && !pair2.titles?.length && rest.length && !letters(rest[0]) && !what(rest[0])) {
    return { words: [...first, ...last], titles, shown: s, could: null, also: null, partner: pair2, partnerWhole: null, partnerCould: null, sure: false, familyOnly: false };
  }
  // Rule 8 (round 20, Nov 21 2026): put first name first only when it's clearly one family name and the given names of
  // one person or of a couple who share it ("Ames, Jordan" is Jordan Ames, "Rowe, Amy & Sam" Amy & Sam Rowe, "Ames,
  // Jordan, MD" Jordan Ames, MD). Anything else with a comma keeps its words in the order typed: more than two people
  // ("Rowe, Jordan & Amy & Sam", "Ames, Jordan, Amy and Sam"), a second one with a family name of their own ("Jordan, Amy
  // and Sam Rowe", "Quill, Jordan & Mrs. Lee"), or more after another comma that isn't letters or what they do ("Ames,
  // Jordan, Atlanta"). Only the name shown: the words People matches on and Add's web address read as before
  const ands = (parts[1].match(/(?:^|\s)(?:&|and)(?=\s|$)/giu) || []).length;
  // (a title and a family name for the second that's the first one's too, "Quill, Jordan & Mrs. Quill", is shared)
  const ownName = !!pair2?.ownFamily && pair2.map(bare).join(' ') !== last.map(bare).join(' ');
  const asTyped = !!(pair2 && (pair2.shared || ownName)) || ands > 1 || (rest.length > 0 && !rest.every((p) => letters(p) || what(p)));
  // (the other one with a family name of their own after a title goes after the first one's whole name: "Quill, Jordan &
  // Mrs. De La Cruz" is Jordan Quill & Mrs. De La Cruz)
  const reordered = `${(pair2?.ownFamily ? [...titles, ...first, ...last, ...lastOff, ...firstOff, '&', ...pair2.titles, ...pair2]
    : [...titles, ...(pair2 ? [first[0], '&', ...(pair2.titles || []), ...pair2, ...first.slice(1)] : first), ...last, ...lastOff, ...firstOff]).join(' ')}${rest.length ? `, ${rest.join(', ')}` : ''}`;
  const shown = asTyped ? s : reordered;
  // (a title alone for the other one, "Quill, Jordan & Mrs.": theirs is the family name before the comma)
  if (pair2?.familyOnly && !pair2.length) pair2.push(...last);
  // (the other one's whole name: with the family name before the comma when they have none of their own after it,
  // "Rowe, Jordan & Amy" and "Rowe, Jordan & Amy MD" are Amy Rowe; their letters never part of it)
  const theirFamily = pair2?.whole?.length && pair2.whole.length === pair2.length ? last : [];
  // (and Add's web address follows the name as shown, in the order typed, its titles and letters set apart as for any
  // name: "Jordan, Amy and Sam Rowe" is at jordan-amy-and-sam-rowe (the coordinator, Nov 22 2026). `words`, what Add
  // matches people on, is as before)
  const address = asTyped ? s.split(/[\s,]+/).filter((t) => t && t !== '&' && !isTitle(t) && !afterName(t, { caps: /\p{Ll}/u.test(s) })) : null;
  return { words: [...first, ...last], titles, shown, could: firstCould ? [...firstCould, ...last] : null, also: null, partner: pair2,
    partnerWhole: pair2?.whole?.length ? [...pair2.whole, ...theirFamily] : null, partnerCould: pair2?.whole?.length && pair2.could ? [...pair2.could, ...theirFamily] : null, sure: true, familyOnly: false,
    ...(address ? { address } : {}) };
}
// The greeting: only on positive evidence (round 20, Nov 21 2026; the lead's rule, replacing round 19's reader).
// Rounds 15 to 20 each found new names greeted wrongly, because the reader took any word it didn't recognise as a name
// and every round added words to lists of things that aren't. Now a word is greeted only when it's on a list of given
// names people really go by (./_given-names.js), in a name of one plain shape (below); anything else gets no name
// ("Thank you." on the page and in the copy, "Hello," in the emails). A missed name is fine; a wrong one never is.

// Rule 4: marks every keyboard can paste, read as their plain forms. Unicode's default-ignorable and format characters
// gone (a soft hyphen, the marks that set a direction, joiners, variation selectors, U+3164); spaces of every kind one
// space; every dash, apostrophe and middle-dot look-alike its plain form ("Jo−Ann" is Jo-Ann, "D’Andre" D'Andre)
const HIDDEN = /[\p{Default_Ignorable_Code_Point}\p{Cf}]/gu;
const ANY_SPACE = /[\s\p{Z}\u0085]+/gu;
const ANY_DASH = /[\p{Pd}\u2212\u2043]/gu;
const ANY_APOSTROPHE = /[`\u00B4\u02B9\u02BB\u02BC\u02BD\u02BE\u02BF\u02C8\u055A\u05F3\u1FBF\u1FEF\u2018\u2019\u201B\u2032\u2035Ꞌꞌ\uFF07]/gu;
const ANY_MIDDLE_DOT = /[\u0387\u16EB\u2022\u2027\u2219\u22C5\u2E31\u30FBㆍꞏ\uFF65]/gu;
const plainMarks = (x) => String(x ?? '').replace(HIDDEN, '').normalize('NFC').replace(ANY_SPACE, ' ')
  .replace(ANY_DASH, '-').replace(ANY_APOSTROPHE, "'").replace(ANY_MIDDLE_DOT, '\u00B7').trim();
// A word of letters (any script, accents as marks), an apostrophe, hyphen or middle dot only between letters: "Jo",
// "O'Brien", "Smith-Jones", "Gal·la". Never a digit, a full stop, a comma of any script, a bracket, "&" or anything else
const LETTER_WORD = /^[\p{L}\p{M}]+(?:['\-\u00B7][\p{L}\p{M}]+)*$/u;

// A given name on the list, as the list writes it: the word itself, or two joined by a hyphen that people go by together
// ("Jo-Ann", "Min-jun", "Anna-Maria"; never "Jo-Joanna" or "Kevin-Harrison", two names as often). '' for anything else
const listedGiven = (w) => {
  if (!LETTER_WORD.test(w)) return '';
  const whole = givenName(w);
  if (whole) return whole;
  const halves = w.split('-');
  const pair = halves.length === 2 ? givenPair(...halves) : null;
  return pair ? pair.join('-') : '';
};
// Rule 6: in the list's own capitals when the word was typed all in capitals, all in small letters, or starting with a
// small letter ("TJ AMES" is TJ, "jordan" Jordan, "MCKENZIE" McKenzie); as typed otherwise ("Deshawn" stays Deshawn).
// (The typed letters keep their accents or lack of them: "JOSE" is Jose, "JOSÉ" José)
const asListed = (typed, listed) => {
  if (/^\p{Lu}/u.test(typed) && /\p{Ll}/u.test(typed)) return typed;
  if ([...typed].length !== [...listed].length) return listed;
  const want = [...listed];
  return [...typed].map((c, k) => (/\p{Lu}/u.test(want[k]) ? c.toUpperCase() : c.toLowerCase())).join('');
};
const greeted = (typed, listed) => {
  const t = typed.split('-');
  const l = listed.split('-');
  return t.length === l.length ? t.map((x, k) => asListed(x, l[k])).join('-') : asListed(typed, listed);
};

// Words that show a full name isn't one person's plain name, after its first word (rule 5): a business, a family or an
// office (the lists below and the titles above, reused for this check only, never to find a name), and words that join
// people ("and", "y", "et", "und", "or", "with", "plus")
const STOP = /^(?:prefer|preferred|preference|preferably|not|say|no|none|nope|nah|name|names|named|nickname|nicknames|call|called|calls|me|my|mine|myself|i'm|im|i'd|please|pls|plz|just|only|simply|fine|ok|okay|good|great|is|are|am|was|be|or|either|neither|nor|but|matter|matters|doesn't|doesnt|don't|dont|does|did|first|last|middle|full|legal|given|real|actual|birth|go|goes|going|by|needed|need|necessary|required|same|any|anything|anyone|anybody|whatever|whichever|both|all|it|its|it's|this|that|these|those|here|there|above|below|see|as|to|too|also|the|of|for|with|from|in|on|at|up|you|your|yours|choice|thanks|thank|thx|yes|yeah|yep|sure|nothing|nobody|null|undefined|unknown|anonymous|anon|test|testing|tbd|tba|applicable|use|used|usual|usually|regular|normal|default|etc|et|wife|wives|husband|husbands|hubby|kids|kiddos|kid|children|child|son|sons|daughter|daughters|spouse|spouses|partner|partners|fiance|fiancé|fiancee|fiancée|boyfriend|girlfriend|fam|family|families|household|households|folks|parents|parent|mom|mum|mommy|dad|daddy|grandma|grandpa|granny|baby|friend|friends|team|crew|gang|clan|guest|guests|plus|other|others|foundation|fdn|group|realty|inc|incorporated|llc|llp|pllc|plc|ltd|limited|co|company|companies|corp|corporation|church|churches|ministries|ministry|association|assn|society|club|fund|enterprises|holdings|industries|services|solutions|consulting|properties|investments|ventures|agency|insurance|bank|school|academy|university|college|institute|committee|coalition|alliance|network|collective|cooperative|organization|organisation|nonprofit|charity|charities|temple|synagogue|mosque|parish|chapel|fellowship|congregation|diocese|pta|pto|chamber|dba|center|centre|studio|studios|associates|advisors|advisers|construction|builders|roofing|plumbing|landscaping|realtors|marketing|clinic|pharmacy|bakery|restaurant|salon|logistics|technologies|software|trust|wealth|financial|management|state|former|retired|acting|interim|vice|assistant|associate|executive|most|very|right|rt|council|councilmember|member|members|lady|second|pro|tem|tempore|elect|honorable|honourable|excellency|eminence|holiness|majesty|highness|worshipful|presiding|superior|emeritus|emerita|county|city|district|federal|national|congressional|petty|warrant|command|gunnery|rear|flight|squadron|staff|grand|past|youth|head|lead|police|fire|special|supervisory|us|u\.s|med|dent|rer|jur|iur|theol|habil|pronoun|pronouns)$/u;
const COMMON = /^(?:new|old|own|good|bad|big|small|long|short|high|low|next|other|same|well|way|day|days|time|year|years|week|today|now|then|here|there|where|when|what|which|who|whom|whose|why|how|some|such|each|every|again|once|about|after|before|below|between|into|through|during|without|within|along|across|behind|beyond|near|far|over|under|down|out|off|we|us|they|them|their|his|her|him|she|he|have|has|had|having|doing|done|get|gets|got|make|makes|made|went|gone|come|comes|came|take|takes|took|see|sees|saw|seen|know|knows|knew|think|thinks|thought|says|said|tell|tells|told|give|gives|gave|find|finds|found|uses|work|works|worked|try|tries|tried|ask|asks|asked|needs|feel|feels|felt|leave|leaves|left|put|puts|keep|keeps|kept|let|lets|begin|seem|seems|help|helps|show|shows|shown|hear|play|run|runs|move|moves|live|lives|believe|hold|holds|bring|happen|write|writes|sit|stand|lose|pay|meet|include|continue|set|learn|change|understand|watch|follow|stop|create|speak|read|allow|add|spend|grow|open|walk|win|offer|remember|consider|appear|buy|wait|serve|send|expect|build|stay|fall|cut|reach|remain|suggest|raise|pass|sell|report|decide|pull|fit|fits|box|boxes|thing|things|man|woman|world|life|hand|place|case|point|number|problem|fact|room|area|money|story|lot|book|eye|job|word|words|business|issue|side|kind|house|service|hour|game|line|end|law|car|idea|body|information|face|level|office|door|result|morning|reason|research|girl|moment|air|teacher|force|education|foot|boy|age|policy|everything|process|music|market|sense|nation|plan|interest|death|experience|effect|class|control|care|development|role|effort|rate|heart|drug|light|voice|mind|price|decision|view|relationship|town|road|arm|difference|value|building|action|model|season|tax|position|player|record|paper|space|ground|form|event|official|couple|site|project|activity|table|court|situation|cost|industry|figure|street|image|phone|data|picture|practice|piece|land|product|wall|patient|worker|news|movie|north|south|east|west|support|technology|step|computer|type|attention|film|tree|source|hair|window|evidence|population|truth|email|address|note|photo|large|young|important|public|hard|free|able|better|best|easy|clear|recent|certain|personal|difficult|available|likely|single|current|wrong|private|foreign|common|poor|natural|significant|similar|hot|dead|happy|serious|ready|simple|physical|cold|final|nice|huge|popular|never|always|often|sometimes|maybe|perhaps|really|sorry|hello|hi|dear|isn|aren|wasn|can't|cant|won't|wont|didn't|didnt|isn't|aren't|wasn't|again|less|least|many|much|few|very|lots)$/u;
const STOP_END = /(?:woman|women|person|persons|member|members)$/u;
const ORG = /^(?:family|families|household|households|foundation|fdn|group|realty|inc|incorporated|llc|llp|pllc|plc|ltd|limited|co|company|companies|corp|corporation|church|churches|ministries|ministry|association|assn|society|club|fund|enterprises|holdings|industries|services|solutions|consulting|properties|investments|ventures|agency|insurance|bank|school|academy|university|college|institute|committee|coalition|alliance|network|collective|cooperative|organization|organisation|nonprofit|charity|charities|temple|synagogue|mosque|parish|chapel|fellowship|congregation|diocese|pta|pto|chamber|dba|center|centre|studio|studios|team|partners|sons|associates|advisors|advisers|construction|builders|homes|roofing|plumbing|electric|landscaping|realtors|design|designs|media|marketing|capital|clinic|dental|medical|health|pharmacy|bakery|cafe|restaurant|salon|motors|auto|logistics|technologies|tech|systems|software|labs|trust|wealth|financial|management)$/u;
// Words that are never a family name or a given name and mark a place or an organization (round 21, finding 7: "Sandy
// Springs", "Mercy Hospital", "Trinity Lutheran", "Olive Garden", "Austin Texas"). Round 22 (finding 4: "Grace Baptist",
// "Hope Dermatology", "Jordan Contracting", "Ashley Furniture", "Grace Photography", "Faith Farms" were greeted): written out
// by kind, each kind whole, not word by word from a report. Never one that's a family name or a given name as well ("Park",
// "Stanley", "Lee", "Mercer", "Farmer", "Kitchens", "Pool", "Woods", "Stone", "Glass", "Plaza", "Arena", "Christian",
// "Art", "Marina"): "Grant Park", "Morgan Stanley", "Robert E. Lee", "Jordan Farmer", "Grace Christian" can be people, and
// are greeted. Plain strings, split when a greeting first asks (placeWord), so the page's bundle, which never greets
// anyone, leaves them out (as _given-names.js's lists are)
const PLACE_WORDS = [
  // Churches and other congregations: denominations, their buildings and their work, other faiths' own words
  `baptist baptists methodist methodists lutheran lutherans presbyterian presbyterians episcopal episcopalian episcopalians
  anglican anglicans catholic catholics orthodox reformed apostolic pentecostal pentecostals adventist adventists evangelical
  evangelicals nazarene nazarenes mennonite mennonites wesleyan wesleyans moravian moravians congregational congregationalist
  unitarian unitarians universalist quaker quakers amish brethren nondenominational interdenominational ecumenical interfaith
  charismatic missionary missionaries coptic maronite melkite mormon lds assembly assemblies disciples witnesses saints holy
  tabernacle cathedral basilica seminary seminaries sanctuary priory monastery convent friary mission missions outreach
  revival worship gospel bible bibles biblical scripture covenant redeemer redemption resurrection salvation deliverance
  calvary cornerstone lighthouse harvest messiah spiritual spiritualist theological divinity masjid islamic muslim muslims
  jewish judaism hebrew chabad mandir gurdwara sikh hindu buddhist buddhism vihara sangha`,
  // Medical and care: specialties, the people who practise them and where
  `hospital hospitals hospice hospices healthcare medicine clinics pediatric pediatrics paediatrics pediatrician
  pediatricians orthodontic orthodontics orthodontist orthodontists dentistry dentist dentists chiropractic chiropractor
  chiropractors veterinary veterinarian veterinarians dermatology dermatologist dermatologists cardiology cardiologist oncology
  neurology radiology urology gastroenterology endocrinology nephrology pulmonology rheumatology ophthalmology optometry
  optometrist optometrists audiology podiatry orthopedics orthopaedics obstetrics gynecology gynaecology psychiatry psychiatric
  psychology psychological psychotherapy counseling counselling therapy therapies therapeutics rehab rehabilitation
  physiotherapy wellness nursing eldercare homecare caregivers caregiving care pharmacies pharmaceuticals apothecary surgical
  surgery surgeons anesthesia anesthesiology imaging diagnostics laboratory laboratories dialysis fertility maternity
  midwifery eyecare vision hearing physicians clinicians memorial infirmary`,
  // Trades and home services
  `contracting contractors remodeling remodelling renovations renovation restoration restorations electrical electricians hvac
  heating cooling landscapes lawncare gardening pest exterminating extermination cleaning janitorial maids painting painters
  flooring floors carpentry cabinetry cabinets millwork masonry concrete paving excavating excavation grading fencing decking
  siding gutters drywall insulation waterproofing septic drilling welding fabrication machining mechanical engineering
  surveying inspections inspection movers moving hauling towing trucking transport transportation storage junk handyman
  repair repairs appliance appliances locksmith locksmiths security alarm alarms solar pools spas irrigation sprinklers
  interiors decor décor staging upholstery drapery blinds closets countertops granite tile tiling carpet carpets rugs plumbers
  roofers demolition exteriors homebuilders developers`,
  // Shops and services
  `furniture mattress mattresses hardware lumber supply supplies wholesale wholesalers retail store stores shop shoppe shops
  mart boutiques jewelers jewellers jewelry jewellery florist florists bakeries cafes coffeehouse deli delicatessen grille pub
  breweries brewing wineries distillery cantina eatery catering caterers foods food groceries liquor liquors wines spirits
  salons barbershop beauty cosmetics nails tailoring cleaners laundry laundromat optical opticians pawn thrift consignment
  autos tires tire collision dealerships rentals rental leasing mortgages banking finance accounting accountants bookkeeping
  taxes payroll lawyers attorneys notary staffing recruiting recruitment advertising printing graphics signs signage
  embroidery apparel clothing fashions fashion footwear shoes sporting outfitters toys gifts crafts hobbies pets grooming
  kennel kennels boarding childcare tutoring montessori fitness gym crossfit yoga pilates karate taekwondo cycling travel
  tours travels cruises hotels suites events weddings wedding bridal limousine limo taxi shipping couriers delivery computers
  electronics wireless telecom communications digital hosting`,
  // Studios and media
  `photography photographs photographers photos films pictures productions production recordings records audio video videos
  videography cinematography creative creatives arts framing publishing publishers publications magazine radio broadcasting
  broadcast television tv podcast podcasts theaters theatres entertainment animation branding interactive ensemble orchestra
  choir chorale musical`,
  // Farms and the outdoors, and places people go
  `farms farm ranch ranches orchards vineyard vineyards nursery nurseries greenhouse greenhouses acres plantation dairy
  creamery apiary apiaries stables equestrian outdoors campground campgrounds trails creek creeks valley falls harbor harbour
  landing landings crossing commons mall station coliseum pavilion amphitheater amphitheatre fairgrounds golf preserve`,
  // (and round 21's: gardens, schools, neighborhoods and kinds of home, places to eat and stay, banks, the country, and
  // states that are nobody's name: anywhere after the first word)
  `springs garden gardens elementary preschool daycare kindergarten library museum zoo aquarium stadium theater theatre
  cinema hotel motel resort inn spa outlet outlets marketplace supermarket grocery café cafe diner bistro pizzeria pizza
  tavern brewery winery steakhouse barbecue bbq taqueria boutique galleries apartments condos townhomes estates subdivision
  township borough village heights highlands island islands airport terminal depot automotive dealership bancorp savings
  mortgage lending loans union consultants international worldwide global america american usa league sisters manhattan
  alabama alaska arizona arkansas california connecticut florida hawaii idaho illinois indiana iowa kansas kentucky
  louisiana maryland massachusetts michigan minnesota mississippi missouri nebraska ohio oklahoma oregon pennsylvania
  tennessee texas utah vermont wisconsin wyoming mexico`,
];
// States, and the US's large cities and Georgia's own: a place when written last, after another word (round 22, finding 4:
// "Hope Atlanta", "Austin Georgia", "Tucker Georgia", "Jordan Atlanta"). Never one that's a family name too (Washington,
// Austin, Houston, Dallas, Denver, Madison, Jackson, Lincoln, Cleveland, Decatur, Tucker, Dunwoody, Montana, Maine,
// Colorado): "Jordan Austin" is Jordan. WHERE_NAMED's are given names too (Georgia, Virginia, Savannah, Augusta,
// Charlotte): last they're a place; first, or after a comma, still a name ("Ames, Savannah" is Savannah Ames)
const WHERE = `atlanta alpharetta smyrna kennesaw lawrenceville duluth suwanee doraville lilburn snellville loganville
  jonesboro riverdale fayetteville carrollton douglasville mableton austell acworth woodstock gainesville dahlonega
  cartersville athens columbus valdosta albany brunswick statesboro hinesville pooler thomasville tifton americus
  milledgeville vidalia waycross roswell brookhaven gwinnett dekalb stonecrest peachtree chattahoochee lithonia clarkston
  hapeville palmetto fairburn grovetown jesup kingsland folkston cordele swainsboro metter homerville toccoa demorest
  clarkesville blairsville ellijay elberton senoia thomaston barnesville hogansville chicago philadelphia jacksonville
  indianapolis seattle nashville louisville memphis baltimore milwaukee albuquerque tucson fresno sacramento omaha miami
  oakland minneapolis tulsa bakersfield wichita tampa honolulu anaheim cincinnati pittsburgh greensboro anchorage plano
  scottsdale chesapeake boise spokane tacoma modesto huntsville yonkers oxnard amarillo knoxville akron shreveport
  chattanooga tempe detroit portland buffalo newark laredo lubbock tallahassee pensacola sarasota hialeah gulfport biloxi
  topeka naperville pasadena glendale riverside springfield lexington norfolk arlington charleston greenville wilmington
  harrisburg allentown syracuse annapolis providence boulder delaware`;
const WHERE_NAMED = `georgia virginia carolina dakota nevada savannah augusta marietta charlotte aurora alexandria phoenix
  eugene trenton odessa hiram`;
// (and places of two words, each a family name or a given name alone: "Charlotte North Carolina", "Jordan New York",
// "Virginia Beach", "Grace Fort Worth")
const PLACE_TWO = /^(?:north carolina|south carolina|north dakota|south dakota|west virginia|new york|new jersey|new mexico|new hampshire|new orleans|new england|rhode island|los angeles|san francisco|san diego|san antonio|las vegas|st louis|saint louis|palm beach|stone mountain|peachtree city|peachtree corners|virginia beach|kansas city|oklahoma city|salt lake|fort worth|el paso|long beach|baton rouge|corpus christi|jersey city|grand rapids|little rock|des moines|fort lauderdale|fort wayne|warner robins|east point|union city|forest park|sugar hill|richmond hill|st marys|saint marys|st simons|saint simons|south fulton|santa ana|santa rosa|santa clarita|chula vista|newport news|winston salem|st petersburg|saint petersburg|huntington beach|overland park|cape coral)$/u;
let PLACES = null;
let WHERES = null;
let WHERES_NAMED = null;
const splitWords = (s) => s.split(/\s+/).filter(Boolean);
const buildPlaces = () => {
  PLACES = new Set(PLACE_WORDS.flatMap(splitWords));
  WHERES = new Set(splitWords(WHERE));
  WHERES_NAMED = new Set(splitWords(WHERE_NAMED));
};
/** A word (as `plain` has it) that marks a place or an organization wherever it is after a name's first word */
export const placeWord = (w) => { if (!PLACES) buildPlaces(); return PLACES.has(w); };
/** (for the tests: every word the place lists hold, by where it counts) */
export const placeLists = () => ({ anywhere: PLACE_WORDS.flatMap(splitWords), last: splitWords(WHERE), lastNamed: splitWords(WHERE_NAMED) });
/** A state or a city: a place when written last after another word; `named`: those that are given names too as well */
export const whereWord = (w, { named = true } = {}) => { if (!WHERES) buildPlaces(); return WHERES.has(w) || (named && WHERES_NAMED.has(w)); };
// (a place or an organization in what's written after a comma, round 22: "Grace Church", "Sandy Springs", "Mercy
// Hospital", "Atlanta", "Edward Jones LLC"; a family word isn't one there, "Rowe, Jordan & family" being Jordan Rowe and
// family, nor a state or city that's a given name too, "Ames, Savannah" being Savannah Ames, nor a place of two words
// after "de" or "del", a given name's own, "Reyes, Ma. de los Angeles")
const placeOrOrg = (p) => {
  const ws = String(p || '').split(/\s+/).map(plain).filter(Boolean);
  return ws.some((w, k) => placeWord(w) || (ORG.test(w) && !NOT_NAMED.test(w) && !/^households?$/u.test(w)) || whereWord(w, { named: false })
    || (k > 0 && PLACE_TWO.test(`${ws[k - 1]} ${w}`) && !(k > 1 && /^(?:de|del)$/u.test(ws[k - 2]))));
};
const NOT_NAMED = /^(?:wife|husband|hubby|spouse|partner|kids|kiddos|children|fam|family|families)$/iu;
const JOINS_PEOPLE = /^(?:and|et|und|or|with|plus|n)$/u;
// (a word as these lists have it: small letters, a curly apostrophe made straight, marks at its ends gone)
// (round 21: its ends found by counting letters in from each end, never /[^\p{L}]+$/, which starts again at each mark of
// a long run of them)
const IS_LETTER = /\p{L}/u;
const plain = (w) => {
  const cs = [...String(w).normalize('NFC').toLowerCase().replace(/\u2019/g, "'")];
  let a = 0;
  let b = cs.length;
  while (a < b && !IS_LETTER.test(cs[a])) a++;
  while (b > a && !IS_LETTER.test(cs[b - 1])) b--;
  return cs.slice(a, b).join('');
};
const notOnePersonsName = (w) => [w, ...w.split(/['\-\u00B7]/u)].some((x) => {
  const p = plain(x);
  return !!p && (STOP.test(p) || STOP_END.test(p) || ORG.test(p) || placeWord(p) || NOT_A_FIRST_NAME.test(p) || NOT_NAMED.test(p) || JOINS_PEOPLE.test(p)
    || TITLE.test(p) || GREET_TITLE.test(p) || RANK.test(p) || EITHER_TITLE.test(p) || COURTESY.test(p));
});
// (in a name with capitals and small letters, a word after the first is written as a name is: a capital first, or a
// family name's small first word, "Jordan de la Rosa" being too long anyway, "Ana da Silva", "Omar al-Masri", "Gina
// d'Amico". "Jordan wants in" has none)
const PARTICLE = /^(?:de|di|da|du|des|del|della|dos|das|von|van|der|den|ter|ten|la|le|lo|al|el|bin|ibn|abu|ben|bat|d|l|o)$/u;
const writtenAsName = (w) => /^\p{Lu}/u.test(w) || !/\p{Ll}/u.test(w[0]) || PARTICLE.test(w.split(/['\-]/u)[0]);

// Rule 5's courtesy titles: at most one, before the name, with or without its full stop. Hon, Gen, Rep, Sen, Det and
// Gov only with theirs, being names too ("Hon Lam", "Gen Tanaka", "Amartya Sen"), as TITLE has them
const COURTESY = /^(?:(?:mr|mrs|ms|mx|miss|missus|mister|dr|doctor|rev|revd|reverend|prof|professor|fr|father|pastor|judge|rabbi|imam|bishop|elder|deacon|minister|chaplain|sister|brother|coach|capt|captain|col|colonel|maj|major|lt|sgt|adm|cmdr|honorable|honourable|senator|governor|mayor|officer|detective|amb|ambassador|atty|msgr|sir|dame|lady|lord|herr|frau|fräulein|frl|mme|mlle|madame|madam|mademoiselle|monsieur|señor|senor|señora|senora|señorita|senorita|sra|srta|dra|lic|don|doña|dona|dott|signora|signorina|sig\.ra|sig\.na|senhora|mevrouw|mevr|shri|sri|smt|shrimati)\.?|(?:hon|gen|rep|sen|det|gov)\.)$/iu;
// Of those, a woman's (round 21, finding 2: the older formal style writes a wife by her husband's name, "Mrs. John Ames",
// "Madame Jean Dupont", "Frau Hans Müller"): after one, the next word is greeted only when it's a woman's name or one
// women go by as often as men (womansName: "Mrs. Amy Ames" is Amy, "Ms. Jordan Ames" Jordan); anything else is no name
const WOMANS_TITLE = /^(?:mrs|ms|miss|missus|mme|mlle|madame|madam|mademoiselle|frau|fräulein|frl|señora|senora|señorita|senorita|sra|srta|dra|doña|dona|signora|signorina|sig\.ra|sig\.na|senhora|mevrouw|mevr|smt|shrimati|lady|dame|sister)\.?$/iu;
// Letters after the name (rule 5): ones the file knows (AFTER_NAME's, ALSO_A_NAME's, DOTTED_DEGREE's), in any capitals,
// with or without their dots, typed together or in pieces ("PhD", "PHD", "Ph.D.", "Ph. D.", "Ph D", "Jr.", "III",
// "M.B.A."). Set apart only while two words of the name are left: "Anh Do" is Anh Do, never Anh with a D.O.
// (round 21: one way to match each word, so it answers at once at any length; round 20's /^(?:\p{L}+[.-]?)+$/u tried
// every way to cut a run of letters, twice as long for each letter more, before a digit or a mark said no)
const LETTERS_TYPED = /^\p{L}+(?:[.-]\p{L}+)*[.-]?$/u;
const lettersAt = (ps) => {
  // (a hyphen inside ones the file knows written so too: "CCC-SLP", "SHRM-CP", "PA-C")
  if (ps.length > 1 ? !ps.every((x) => /^\p{L}{1,4}\.?$/u.test(x)) : !LETTERS_TYPED.test(ps[0])) return false;
  return knownLetters(bare(ps.join('')));
};
const withoutLetters = (ws) => {
  const out = [...ws];
  for (let k = [3, 2, 1].find((n) => out.length - n >= 2 && lettersAt(out.slice(-n))); k; k = [3, 2, 1].find((n) => out.length - n >= 2 && lettersAt(out.slice(-n)))) out.splice(-k);
  return out;
};

// (letters the file knows and nothing else, typed together or in pieces: "PhD", "Jr.", "MBA CPA", "Ph. D.")
const onlyLetters = (ts) => {
  const out = [...ts];
  while (out.length) {
    const k = [3, 2, 1].find((n) => out.length >= n && lettersAt(out.slice(-n)));
    if (!k) return false;
    out.splice(-k);
  }
  return true;
};
// The full name's words as rule 5 reads them: one courtesy title set apart, letters after the name set apart, and after
// a comma only letters the file knows (the coordinator, Nov 22 2026: "Jordan Ames, PhD", "Jordan Ames, Jr.", "Jordan
// Ames, MBA, CPA"); one initial between a first name and a family name, with or without its stop, is a word too
// ("Jordan A. Ames", "Jordan A Ames"; never two, never first). null when a comma has anything else after it ("Ames,
// Jordan", "Jordan Ames, Realtor", "Jordan Ames, M.Tech") or a word isn't of letters
// (with the courtesy title it set apart, '' for none: round 21, the greeting reads a woman's)
const plainParts = (raw) => {
  const [head, ...tails] = plainMarks(raw).split(',').map((x) => x.trim());
  if (tails.some((x) => !x || !onlyLetters(x.split(' ')))) return null;
  let ws = head.split(' ').filter(Boolean);
  const title = ws.length && COURTESY.test(ws[0]) ? ws[0] : '';
  if (title) ws = ws.slice(1);
  ws = withoutLetters(ws);
  const initial = (w, k) => k === 1 && ws.length === 3 && /^\p{L}\.$/u.test(w);
  return ws.every((w, k) => LETTER_WORD.test(w) || initial(w, k)) ? { title, words: ws } : null;
};
export const plainWords = (raw) => plainParts(raw)?.words || null;

// Whether a name's first word is its family name, written first (round 22, finding 3: one answer, read both by the full
// name's greeting and by the check of the name they go by, so "Kato Yuki" with "Kato" as the name they go by is never
// greeted "Kato"): a family name that always comes first (rule 3: "Nguyễn Văn An", "Kim Min-jun", or a hyphenated first
// word starting with one, "Kim-Lee", unless the whole is a given name, "Jo-Ann", "Min-jun"); one that comes first only
// before a given name of its own people's ("Sam Rainsy", "Tien Yu-ting": _given-names.js FAMILY_FIRST_BEFORE), never
// when the two are given names people go by together before a family name ("Thanh Huong Ames" is Thanh Huong); or any
// first word before a given name of Hungary's at the end ("Simon Zoltán", "Balázs Péter")
const firstIsFamily = (ws) => ws.length > 1 && (familyFirst(ws[0]) || (!givenName(ws[0]) && familyFirst(ws[0].split('-')[0]))
  || (familyFirstBefore(ws[0], ws[1]) && !(ws.length === 3 && givenPair(ws[0], ws[1]))) || givenFamilyFirst(ws[ws.length - 1]));

// The words of a full name that may be its family name, whatever its shape (round 21, finding 5: "Grant, Jordan",
// "Jordan Grant (she/her)", "Jordan Grant, Realtor"): the last word of each name in it (each part between commas,
// semicolons, brackets, slashes, "&", "+" or "and"), its courtesy title, letters after it and words such as "Family" set
// apart; and a part's one word when it's marked as a family name, before a comma ("Grant, Jordan"), after a courtesy title
// ("Mr. Grant") or before "Family" ("Grant Family"). Each one's halves too when hyphenated ("Ames-Grant"). Never a given
// name written first ("Jordan Grant, Realtor" has Grant, never Jordan), nor a middle name ("Jordan Grant Ames" has Ames)
//   Round 22 (finding 3): and a part's first word when it's a family name written first, as the full name's greeting
// reads it (firstIsFamily: "Kato Yuki", "Kim Min-jun", "Sam Rainsy", "Simon Zoltán", "Dr. Simon András PhD")
const PART_BREAK = /(\s*[,;()[\]{}&+/，、،；؛]\s*|\s+(?:and|y|e|et|und)\s+)/iu;
const familyWords = (raw) => {
  const out = new Set();
  const add = (w) => { for (const x of [w, ...w.split('-')]) if (x) out.add(nameKey(x)); };
  const bits = plainMarks(raw).split(PART_BREAK);
  for (let i = 0; i < bits.length; i += 2) {
    let ws = bits[i].split(' ').filter(Boolean);
    const titled = ws.length > 0 && COURTESY.test(ws[0]);
    if (titled) ws = ws.slice(1);
    ws = ws.filter((w) => LETTER_WORD.test(w));
    let marked = titled || (i === 0 && /,/.test(bits[i + 1] || ''));
    // (a last word that's only ever letters is set apart; one that's a family name too, "Anh Van DO", is counted too)
    while (ws.length > 1 && lettersAt(ws.slice(-1))) { if (!AFTER_NAME.test(bare(ws[ws.length - 1]))) add(ws[ws.length - 1]); ws.pop(); }
    while (ws.length > 1 && (NOT_NAMED.test(plain(ws[ws.length - 1])) || ORG.test(plain(ws[ws.length - 1])))) { ws.pop(); marked = true; }
    if (ws.length > 1 || (ws.length === 1 && marked)) add(ws[ws.length - 1]);
    if (firstIsFamily(ws)) add(ws[0]);
  }
  return out;
};

/**
 * What the thank-you, the applicant's copy and the emails call them (rules 1 to 7): the name they go by when it's plainly
 * a given name, else the first word of their full name when that's plainly one; '' for no name.
 */
export function greetName(a) {
  return preferredGreeting(a?.preferredName, a?.fullName) || fullGreeting(a?.fullName);
}
// Rule 4: the name they go by, greeted when it's one or two words (or one hyphenated pair) of letters, every word on the
// given-names list, and two only as a pair people go by together: "Jo", "Mary Beth", "Jo-Ann". Anything else ("Call me Jo", "Hi Jo", "CPA", "III", "Blank", "Pass",
// "Ames, Jordan", "Jo she/her") is set aside and their full name read instead. So is one that's one of the full name's
// family-name words, whatever its shape ("Taylor" or "Jordan Taylor" for Jordan Taylor: "Jordan" from the full name;
// "Grant" for "Grant, Jordan", "Jordan Grant (she/her)" or "Jordan Ames-Grant": no name. Round 21, finding 5)
function preferredGreeting(raw, full) {
  const ws = plainMarks(raw).split(' ').filter(Boolean);
  if (!ws.length || ws.length > 2 || (ws.length === 2 && ws.some((w) => w.includes('-')))) return '';
  // (two words: only two given names people go by together, "Mary Beth", "Juan Carlos"; never a given name and a family
  // name that's a given name too, "Katie Harrison", "Dana Kim")
  const pair = ws.length === 2 && ws.every((w) => LETTER_WORD.test(w)) ? givenPair(...ws) : null;
  const listed = ws.length === 2 ? (pair || ['', '']) : ws.map(listedGiven);
  if (listed.some((x) => !x)) return '';
  // (two words, one a title or an office as often as a name, "ADA Jo"; or one all in capitals beside small letters that
  // the list doesn't write so: letters, as in a full name)
  const cased = /\p{Lu}/u.test(ws.join('')) && /\p{Ll}/u.test(ws.join(''));
  if ((ws.length === 2 && ws.some(titleToo)) || (cased && ws.some((w, k) => !/\p{Ll}/u.test(w) && w !== listed[k]))) return '';
  // (their family name: any word of the full name that may be one, in any shape; round 20 read only a plain one's last word)
  const family = familyWords(full);
  if (ws.some((w) => family.has(nameKey(w)))) return '';
  return ws.map((w, k) => greeted(w, listed[k])).join(' ');
}
// Rule 5: the full name, greeted by its first word only when it's the plain shape: at most one courtesy title, then two
// or three words of letters (one of them may be a middle initial), then at most letters the file knows, after a comma
// too. No other comma of any script, no semicolon, no "and", "&" or "+", no brackets, no digits, nothing else. The first word on the given-names list and never a family name that
// comes first (rule 3: "Nguyễn Văn An", "Kim Min-jun"); the other words never a business, family or office word
//   Round 21 (Nov 22 2026): after a woman's courtesy title only a woman's name, or one women go by as often ("Mrs. John
// Ames" is no name, "Mrs. Amy Ames" Amy); two given names people go by together, then a family name, greeted whole
// ("Mary Beth Rowe" is Mary Beth); a family name written first that's a given name elsewhere ("Kato Yuki", "Sam Rainsy"),
// or a Hungarian given name last ("Simon Zoltán"), no name; a title of two words or a title before a whole name ("Ida
// Bagus Mantra", "Malik Riaz Hussain"), no name; a place or an organization ("Sandy Springs", "Mercy Hospital"), no name
//   Round 22: every given name that's a family name first among its own people's given names ("Tien Yu-ting", "Shan
// Xiaoming", "Yong Min-jun"), and Hungary's given names written out ("Simon András"), no name; a place or an organization
// of any kind ("Grace Baptist", "Hope Dermatology", "Jordan Contracting", "Faith Farms"), or a state or city last ("Hope
// Atlanta", "Austin Georgia"), no name
function fullGreeting(raw) {
  const parts = plainParts(raw);
  const ws = parts?.words;
  if (!ws || ws.length < 2 || ws.length > 3) return '';
  const name = ws.join(' ');
  const cased = /\p{Lu}/u.test(name) && /\p{Ll}/u.test(name);
  const rest = ws.slice(1);
  if (rest.some(notOnePersonsName) || (cased && !rest.every(writtenAsName)) || (!cased && rest.some((w) => COMMON.test(plain(w))))) return '';
  // (a place of two words anywhere in it, "Charlotte North Carolina", "Virginia Beach"; and round 22: a state or a city
  // last, after another word, "Hope Atlanta", "Austin Georgia", "Tucker Georgia")
  if (ws.some((w, k) => k > 0 && PLACE_TWO.test(`${plain(ws[k - 1])} ${plain(w)}`)) || whereWord(plain(ws[ws.length - 1]))) return '';
  // ("y" and "e" join two people in Spanish and Portuguese, "José y María Cruz": in small letters, or in a name with no
  // small letters at all, never an initial)
  if (rest.some((w) => /^[ye]$/u.test(w) || (!cased && /^[YE]$/u.test(w)))) return '';
  const [first] = ws;
  // (its first word a family name written first: "Kim Min-jun", "Sam Rainsy", "Tien Yu-ting", "Simon Zoltán". The same
  // reading the name they go by is checked against: firstIsFamily, round 22)
  if (firstIsFamily(ws)) return '';
  // (a given name that's a title or an office too, "Tuan Jordan Ames"; or an office's letters, "ada jordan ames": nothing
  // says which. One that's a title before a whole name as often greeted only before a family name alone, "Malik Jones"
  // but never "Malik Riaz Hussain"; and never the first word of a title of two, "Ida Bagus Mantra")
  if (titleToo(first) || (!cased && lettersToo(first)) || (ws.length > 2 && titleBeforeNames(first)) || titlePair(first, ws[1])) return '';
  const listed = listedGiven(first);
  // (a first word all in capitals in a name with small letters is letters, an office's as often as not, "ADA Jordan
  // Ames": greeted only when the list writes it so, "TJ Ames")
  const asTheList = (w, l) => !(cased && !/\p{Ll}/u.test(w) && w !== l);
  if (!listed || !asTheList(first, listed)) return '';
  // (two given names people go by together before a family name, the pairs the name they go by is greeted by: "Mary Beth
  // Rowe" is Mary Beth, "Juan Carlos Pérez" Juan Carlos; the second as the list writes it, capital first when typed apart)
  const pair = ws.length === 3 && LETTER_WORD.test(ws[1]) ? givenPair(first, ws[1]) : null;
  const second = pair ? pair[1].charAt(0).toUpperCase() + pair[1].slice(1) : '';
  const both = !!pair && asTheList(ws[1], second) && !titleToo(ws[1]);
  // (after a woman's courtesy title: a woman's name, both of a pair, or no name)
  if (parts.title && WOMANS_TITLE.test(parts.title) && !(womansName(listed) && (!both || womansName(second)))) return '';
  return both ? `${greeted(first, pair[0])} ${greeted(ws[1], second)}` : greeted(first, listed);
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
  // Round 22 (finding 7): cut to the field's limit before anything else is done with it (the page's boxes stop there; a
  // send made by hand can hold 64 KB in one answer), and every clean-up after it reads each character once
  const max = field.max || 500;
  let v = String(raw ?? '').slice(0, max).replace(/\r\n?/g, '\n');
  v = field.type === 'textarea' ? lineEndsTrimmed(v).trim() : v.replace(/\s+/g, ' ').trim();
  if (field.type === 'url') v = normalizeLink(v);
  if (field.type === 'email') v = v.toLowerCase();
  return v.slice(0, max);
}
// (spaces and tabs at the end of each line gone, counted back from each line's end: round 22, never /[ \t]+\n/, which
// starts again at each space of a long run with no line break after it, so 60,000 spaces took seconds)
function lineEndsTrimmed(v) {
  return v.split('\n').map((line) => {
    let end = line.length;
    while (end > 0 && (line[end - 1] === ' ' || line[end - 1] === '\t')) end--;
    return line.slice(0, end);
  }).join('\n');
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
    // (round 22: no spaces matched before the extension, which the next step takes out anyway: /\s*(?:x|…)/ started again
    // at each space of a long run)
    const d = String(value).replace(/(?:x|ext\.?|extension)\s*\d{1,6}\s*$/i, '').replace(/[^\d+]/g, '');
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
