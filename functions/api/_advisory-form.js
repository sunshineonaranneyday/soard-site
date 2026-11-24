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
import { givenName, givenPair, familyFirst, titleToo, lettersToo, nameKey, womansName, titleBeforeNames, titlePair, familyFirstBefore, familyFirstUnsure, givenInParts, hungarianOrder, onTheLists } from './_given-names.js';

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
  const typedOf = (text) => {
    const typed = [];
    let atName = true;
    let atPart = true;
    // (an "&" after a name starts another name, "Jordan & T.J.Amy"; one between titles only joins them, and what's after
    // them is read as it would be after the first title: "Quill, Mr. & Mrs. B.Arch" is letters after a comma, never B. Arch)
    let named = false;
    for (const t of String(text || '').replace(/\s+/g, ' ').trim().split(' ')) {
      const a = apart(t, atName, atPart);
      typed.push(a);
      if (/^(&|and)$/i.test(t)) { atName = atName || named; atPart = true; } else if (/,$/.test(t)) { atName = false; atPart = true; named = false; } else if (!a.split(' ').every((y) => isTitle(y))) { atName = false; atPart = false; named = true; }
    }
    return typed.join(' ');
  };
  // Round 24 (finding 5): the name read from its own words (ownWordsOf: pronouns, brackets, what follows a slash, a job or a
  // company after a spaced dash, a place or a company after the name set apart); the name as typed kept for People's name
  // wherever it stays as typed (`typedS`), so it's either as typed or first name first from its own words, never a mix
  const typedS = typedOf(full);
  const own = ownWordsOf(full);
  const s = own === String(full || '') ? typedS : typedOf(own);
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
  // (rule 8, round 23: a part after a second comma that's the name's own, never a place, a company, pronouns, letters or a
  // job, "Ames, Jordan, Atlanta". After a family name and a given name, "Family, Given", only more given names the lists
  // have, "Ames, Jordan, Amy and Sam": never a whole name of more words or a word the lists don't say is a given name, "Ames,
  // Jordan, Edward Jones", "Ames, Jordan, Decatur", as finding 7 has it, a miss on the list being no evidence. After a given
  // name, people written one after another, their names, "Jordan, Amy, Sam Rowe", "Jordan, Amy, and Sam Rowe")
  const people = !!listedGiven(parts[0]?.split(' ').filter((y) => bare(y) && !isTitle(y))[0] || '');
  const nameStays = (p) => !letters(p) && !what(p) && !placeOrOrg(p) && !pronouns(p)
    && (people || p.replace(/^\s*(?:&|and)\s+/iu, '').split(/\s+(?:&|and)\s+|\s*&\s*/iu).filter((x) => x.trim()).every((x) => {
      const w = x.split(' ').filter((y) => bare(y) && !isTitle(y));
      return (w.length === 1 && !!listedGiven(w[0])) || (w.length === 2 && !!givenPair(w[0], w[1]));
    }));
  // (a web address's words, from the parts of the name kept for it, in the order typed: titles, letters and "&" set apart)
  const addressOf = (ps) => ps.join(' ').split(/[\s,]+/).filter((t) => t && t !== '&' && !isTitle(t) && !afterName(t, { caps: /\p{Ll}/u.test(s) }));
  // Round 23 (finding 3): after a whole name and its comma, the other one of a couple named after an "&" or "and", with
  // only the first one's letters, title or generation between ("Jordan Ames, MD & Amy Ames, PhD", "Jordan Ames, Jr. &
  // Amy", "Jordan Ames, MD, PhD and Dr. Amy Ames", nothing at all: "Jordan Ames, & Amy Ames"), is read as theirs, as
  // "Jordan Ames MD & Amy Ames PhD" reads them: whole as typed, else their first name with the first one's family name
  // ("Jordan Ames, MD & Amy" is Amy Ames). Their own letters after it, or after another comma, are never part of it.
  // Nobody with no first name to match them on ("& Mrs. Ames", "& family", "& Associates"), and never past words that
  // aren't letters ("Jordan Ames, Atlanta & Amy Ames", "Jordan Ames, she/her & Amy"). → { whole, could, at } or null (at:
  // the part of `rest` they start in). Only the other one: the first one's reading, the name shown and the address stay
  // round 22's (the whole name before the comma).
  //   Round 24 (finding 4): after every reading of the first one, "Family, Given" too: "Ames, Jordan, MD & Amy", "Ames,
  // Jordan, Jr. & Amy" and "Ames, Jordan, & Amy" are Amy Ames, as "Ames, Jordan & Amy" is (below, at each reading), and
  // their address never takes the other one's name or the letters: ames-jordan
  const partnerPast = (rest, family) => {
    let at = -1;
    let k = -1;
    for (let i = 0; i < rest.length && at < 0; i++) { k = rest[i].split(' ').findIndex((x) => /^(&|and)$/i.test(x)); if (k >= 0) at = i; }
    if (at < 0) return null;
    const ws = rest[at].split(' ');
    const before = [...rest.slice(0, at), ws.slice(0, k).join(' ')].filter(Boolean);
    if (!before.every((p) => letters(p, { titles: true, singles: true }))) return null;
    const them = ws.slice(k + 1).join(' ');
    if (!them || what(them) || placeOrOrg(them)) return null;
    const [named, theirTitles] = lead(them);
    const [own, , could] = trail(named, { titles: theirTitles });
    // (a title and one word is a family name, "& Mrs. Ames", "& Dr. Ames", as it is without the comma; a title alone,
    // letters alone, "the", or a word for someone unnamed, "& wife", "& the Ames family", is nobody to match)
    if (!own.length || (theirTitles.length && own.length === 1) || isTitle(own[0]) || /^(?:the|my|our)$/i.test(own[0]) || own.some((x) => NOT_NAMED.test(bare(x))) || letters(own.join(' '))) return null;
    const out = own.length > 1 ? { whole: own, could: could || null } : family.length ? { whole: [own[0], ...family], could: null } : null;
    return out && { ...out, before: before.join(' '), at };
  };
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
  // Round 23: after a whole name, the other one of a couple past the first one's letters (partnerPast): what's after the
  // comma is then those letters, never a first name ("Zed Ames, MD & Amy Ames" is Zed Ames, MD, as "Zed Ames, MD" is,
  // never "MD Ames"); their family name, when they have none of their own, the first one's words after their given name or
  // initials
  const givenOf = (ws) => { let n = 0; while (n < ws.length - 1 && initials(ws[n])) n++; return Math.max(n, 1); };
  const past = !pair1 && wholeName && parts.length > 1 ? partnerPast(parts.slice(1), family.slice(givenOf(family))) : null;
  const after = past ? past.before : tail.join(' ');
  const lettersAfter = !!past || (!!after && letters(after, { titles: !oneFamily, singles: wholeName }));
  // Round 22 (finding 5): a place or an organization right after the comma ("Grace Church", "Sandy Springs", "Mercy
  // Hospital", "Atlanta") is never a first name, whatever is before it ("Ames, Grace Church" is never Grace Church Ames).
  // (More after another comma is rule 8's, below: "Ames, Jordan, Atlanta" is Jordan Ames, kept in the order typed)
  // (round 23: or pronouns, "Ames, she/her", never "she/her Ames")
  const placeAfter = !!after && (placeOrOrg(parts[1]) || pronouns(parts[1]));
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
    // (what's after the comma, its letters set apart)
    const tailFirst = ambiguous ? trail(tail, { first: true })[0] : [];
    // (a family name's first word, "De", "van", "St.", or the Arabic "Al" and "El", a given name too: "Al Fayed")
    const particle = family.length > 1 && (FAMILY_START.test(bare(family[0])) || /^(?:al|el)$/u.test(bare(family[0])));
    // Round 23 (finding 7, the lead's rule): "not on the given-names list" is never proof of a family name. A list hit is
    // evidence of a given name; a miss is no evidence either way (round 22 read "Octavia Ames, Edward Jones" as "Family,
    // Given", Octavia being off the list, and "De La Cruz, Xochitl" as De La Cruz alone, Xochitl being off it).
    //   What's after the comma that's no given name: a place, a company, pronouns (letters and jobs never get here)
    const nonName = ambiguous && (placeOrOrg(parts[1]) || pronouns(parts[1]));
    // (the given names after the comma, a nickname in brackets or quotes aside, "Maria (Mia)": one word, or two people go by
    // together, "Mary Beth"; and whether the lists say they're given names: that one word, that pair, one the lists have
    // joined to more by "de", "del", "de los", "María de los Ángeles", or three or more, every one on the lists, "Ana Maria
    // Sofia Isabel". Two that aren't a pair are a company as often, "Raymond James", "Morgan Stanley")
    const tailNames = tailFirst.filter((w) => !/^["'(\u201C\u2018[]|["')\u201D\u2019\]]$/u.test(w));
    const pairAfter = tailNames.length === 2 && !!givenPair(tailNames[0], tailNames[1]);
    const oneName = tailNames.length === 1 || pairAfter;
    const compound = tailNames.length >= 3 && !!listedGiven(tailNames[0]) && /^(?:de|del|la|las|los|da|das|do|dos|di)$/u.test(bare(tailNames[1]));
    // (and a couple's, "Maria & Jose", only when the other one's given name is on the lists too: "Allen & Overy" isn't)
    const listedAfter = ((tailNames.length === 1 && !!listedGiven(tailNames[0])) || pairAfter || compound || (tailNames.length >= 3 && tailNames.every((w) => !!listedGiven(w))))
      && !(pair2?.length && !pair2.familyOnly && !pair2.every((w) => !!listedGiven(w)));
    //   A family name in parts (a particle first: "De La Cruz", "van der Berg", "Al Fayed") proves a family name: what's
    // after the comma is their given name, unless it's a place, a company or pronouns, one word or a pair whether the list
    // has it or not, more only when it starts with one the list has ("De La Cruz, Xochitl" is de-la-cruz-xochitl, "Al
    // Fayed, Dodi" al-fayed-dodi and never offered as "Al Fayed, Mohammed", "De La Cruz, Maria de los Angeles" all of it).
    // Any other head is "Family, Given" only on positive evidence: one given name after it that the list has, and none
    // before it that it has, nor initials ("Garcia Lopez, Maria", as round 22 had it)
    // (an initial alone is no evidence of the given name: "De La Cruz, M." is at de-la-cruz, as round 22 had it)
    const given = ambiguous && !pair1 && !nonName && (particle ? (oneName && !initials(tailNames[0] || '')) || !!listedGiven(tailNames[0] || '')
      : listedAfter && !initials(family[0]) && family.every((w) => !listedGiven(w)));
    // (round 24: "Family, Given" and the other one of a couple past the first one's letters after another comma, "De La
    // Cruz, Maria, MD & Jose": Jose De La Cruz, as partnerPast reads them after a whole name)
    const pastGiven = given && !pair2 && parts.length > 2 ? partnerPast(parts.slice(2), words) : null;
    //   Else the words before the comma alone are the address, and the name stays as typed. They're a whole name, matched
    // as all of it, when they're a couple ("Jordan & Amy Rowe"), or start with a given name the list has or initials (round
    // 22), or, not starting with a particle, what's after the comma is a place, a company, pronouns or more than one word
    // the lists don't say are given names ("Octavia Ames, Edward Jones" and "Octavia Ames, Atlanta" are Octavia Ames, at
    // octavia-ames, and "Octavia Ames, Decatur" is asked about her); a particle and a given name the list has before a
    // place or a company too ("Al Green, Atlanta"). Otherwise, one word after them that might be a given name ("Octavia Ames, Decatur",
    // "Garcia Lopez, Xochitl"), or a family name in parts and a place ("De La Cruz, Grace Church"), they're matched only
    // against a name that's all of them, as round 21 had it, so two relatives are never offered as one
    const headWhole = ambiguous && !given && (!!pair1 || (particle ? nonName && !!listedGiven(family[0])
      : nonName || (tailNames.length > 1 && !listedAfter) || !!listedGiven(family[0]) || initials(family[0])));
    const either = ambiguous && !headWhole;
    const tailWords = either ? tailFirst : [];
    const also = either ? [...tailWords, ...words] : null;
    // (a title alone after the comma, "Ames, Dr.", "Van Dyke, Dr.", goes with the name, all of it a family name; so do
    // titles with letters after them, "Quill, Mrs. PhD", "Quill, Mr. & Mrs. B.Arch")
    const withTitles = oneFamily && t2.length > 0 && (!after || lettersAfter);
    const familyOnly = parts.length > 1 && withTitles;
    // (a couple after the comma, "Garcia Lopez, Maria & Jose": the other one by their name with the family name too)
    // (round 23: and after a whole name, the other one after its letters: partnerPast, above)
    const partnerWhole = pair1?.whole || (either && pair2?.length && !pair2.familyOnly ? [...pair2, ...words] : null) || past?.whole || pastGiven?.whole || null;
    // (and their whole name with a last word kept that might be a family name in capitals, as `could` is the first one's)
    const partnerCould = pair1?.whole ? pair1.could || null : past?.could || pastGiven?.could || null;
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
      //   Round 22 (finding 5): "Family, Given" only when what's before the comma is a family name on its own and what's
      // after it a given name, no place or organization ("De La Cruz, Grace Church" is at de-la-cruz). A whole name before
      // the comma never gets here (headWhole, above). Round 23: which is "Family, Given" is `given`'s (finding 7), and a
      // place or anything else after a second comma is left out of its address (rule 8: "De La Cruz, Maria, Atlanta" is at
      // de-la-cruz-maria)
      // (round 24: never the other one of a couple after another comma, nor the letters before them)
      const address = given ? addressOf([parts[0], parts[1], ...parts.slice(2, pastGiven ? 2 + pastGiven.at : undefined).filter(nameStays)]) : words;
      return { words: [...words, ...tailWords], titles: withTitles ? [...t1, ...t2] : t1, shown: typedS, could: could ? [...could, ...tailWords] : null, also,
        apart: [words, ...(could ? [could] : [])], partner: pair1, partnerWhole, partnerCould, sure: false, familyOnly, address };
    }
    return { words, titles: withTitles ? [...t1, ...t2] : t1, shown: typedS, could, also, partner: pair1, partnerWhole, partnerCould, sure: !ambiguous, familyOnly };
  }
  const [first, firstOff, firstCould] = trail(tail, { first: true });
  const [last, lastOff] = trail(head);
  const titles = [...t1, ...t2];
  const rest = parts.slice(2);
  // Round 24 (finding 4): the other one of a couple past the first one's letters after another comma, "Ames, Jordan, MD &
  // Amy", "Ames, Jordan, Jr. & Amy", "Ames, Jordan, & Amy": Amy Ames, whole if typed whole, as partnerPast reads them
  // after a whole name ("Jordan Ames, MD & Amy") and as "Ames, Jordan & Amy" reads them. "Johnson & Johnson" and the like,
  // past words that aren't letters, are nobody, as there
  const past2 = !pair2 && rest.length ? partnerPast(rest, last) : null;
  // (a couple with one word for the second and more after another comma, "Quill, Jordan & Lee, Amy" as against "Quill,
  // Jordan & Amy, Atlanta": the second's first name or a place, nothing can say which; kept as written, greeted without
  // a first name)
  if (pair2?.length === 1 && !pair2.titles?.length && rest.length && !letters(rest[0]) && !what(rest[0])) {
    return { words: [...first, ...last], titles, shown: typedS, could: null, also: null, partner: pair2, partnerWhole: null, partnerCould: null, sure: false, familyOnly: false };
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
  const shown = asTyped ? typedS : reordered;
  // (a title alone for the other one, "Quill, Jordan & Mrs.": theirs is the family name before the comma)
  if (pair2?.familyOnly && !pair2.length) pair2.push(...last);
  // (the other one's whole name: with the family name before the comma when they have none of their own after it,
  // "Rowe, Jordan & Amy" and "Rowe, Jordan & Amy MD" are Amy Rowe; their letters never part of it)
  const theirFamily = pair2?.whole?.length && pair2.whole.length === pair2.length ? last : [];
  // (and Add's web address follows the name as shown, in the order typed, its titles and letters set apart as for any
  // name: "Jordan, Amy and Sam Rowe" is at jordan-amy-and-sam-rowe (the coordinator, Nov 22 2026). `words`, what Add
  // matches people on, is as before)
  //   Round 23 (finding 8, the lead's rule, over Nov 22's "as typed" for the address): the name's words only, in the order
  // typed; a place, a company, pronouns or letters after the second comma never go in it ("Ames, Jordan, Atlanta" is at
  // ames-jordan, "Ames, Jordan, Grace Church" too, never ames-jordan-atlanta). People's name stays as typed
  // (round 24: never the other one of a couple after another comma, nor the letters before them: "Ames, Jordan, & Amy" is
  // at ames-jordan, never ames-jordan-amy)
  const address = asTyped ? addressOf([parts[0], parts[1], ...rest.slice(0, past2 ? past2.at : rest.length).filter(nameStays)]) : null;
  return { words: [...first, ...last], titles, shown, could: firstCould ? [...firstCould, ...last] : null, also: null, partner: pair2,
    partnerWhole: pair2?.whole?.length ? [...pair2.whole, ...theirFamily] : past2?.whole || null,
    partnerCould: pair2?.whole?.length ? (pair2.could ? [...pair2.could, ...theirFamily] : null) : past2?.could || null, sure: true, familyOnly: false,
    ...(address ? { address } : {}) };
}
// Round 24 (finding 5, round 23's rule 8 with no comma too): a name's own words, what's typed around it set apart before
// readName reads it, so the web address, the words Add matches on and the "same person?" question never take them, and the
// same person is offered whatever's typed around their name ("Jordan Ames (she/her)" is Jordan Ames). Anything in brackets;
// pronouns written with a slash ("she/her", "Pronouns: they/them"), unless they're all of what's after a comma, which the
// comma reading reads (round 23: "Jordan Ames, she/her"); what follows a slash, the rest of that part after a whole name or
// after a comma ("Jordan Ames / Edward Jones", "Ames, Jordan / Edward Jones"), the one word after it after a single word
// ("Jordan/Jo Ames"). In the name before any comma, after a whole name only: what follows a spaced dash ("Jordan Ames -
// Realtor"), "of", "at", "from", "with" or "@" ("Jordan Ames of Atlanta"), and the words after it that are surely a place,
// a company or a job ("Jordan Ames Atlanta GA", "Jordan Ames Compass", "Jordan Ames Fulton County"); never a word that's
// a family name as often ("Jordan Lee Church", "Jordan Ames Grace Church" stay as typed: the code can't know)
const PRONOUN_WORDS = 'she|her|hers|he|him|his|they|them|their|theirs|xe|xem|xyr|ze|zir|hir|ey|em|eir|fae|faer|it|its|any|all';
// (made when first asked, never as the file loads: the page's bundle imports this file and never reads a name)
let PRONOUN_RUN = null;
const pronounRun = () => (PRONOUN_RUN ||= new RegExp(`(?:\\bpronouns?\\s*:?\\s*)?(?<![\\p{L}])(?:${PRONOUN_WORDS})(?:\\s*\\/\\s*(?:${PRONOUN_WORDS}))+(?![\\p{L}])`, 'giu'));
const SPACED_DASH = /\s[\p{Pd}−⁃]+\s/u;
const JOINS_A_PLACE = /^(?:of|at|for|from|with|@\S*)$/iu;
// (an organization word that's a family name as often: never surely one alone)
const ORG_AS_NAME = /^(?:church|temple|parish|chapel|family|families|household|households)$/u;
const NAMED_CITY = `austin houston dallas denver washington jackson lincoln madison tucker cleveland durham henderson richmond rochester
  birmingham montgomery lancaster salem reno irvine stockton fremont toledo mesa orlando dayton raleigh burbank lafayette decatur
  dunwoody norcross covington conyers calhoun dalton cumming milton macon rome boston`;
let NAMED_CITIES = null;
const nameCount = (ts) => ts.filter((t) => /\p{L}/u.test(t) && !TITLE.test(t) && !/^(?:the|&|and)$/iu.test(t)).length;
// (how many of the name's words come before each place: one look at each word, so a long name reads at once)
const countsBefore = (ts) => { const out = [0]; for (const t of ts) out.push(out[out.length - 1] + (nameCount([t]) ? 1 : 0)); return out; };
// Round 25 (finding 5, the lead's rule): what's after a name, read as the places, organizations and jobs it's made of, each
// a unit: a phrase of the lists, longest first ("Trinidad and Tobago", "Georgia National Guard", "Ben Hill County",
// "Holly Springs"), an "X of Y" (OF_HEADS: "City of Atlanta", "Bank of America", "Department of Labor", by rule), "The",
// "US", "U.S." or "United States" before one ("The Home Depot", "US Air Force", by rule), a kind of place after a word
// ("Orange County"), a city a family name too and its state ("Decatur GA"), or one word surely a place, an organization or
// a job. → [[its length, whether it may start what's after the name]]: a word that's a kind of place a name goes before
// ("County", "City", "University") never starts it on its own. `headEnd`: the last word, an OF_HEADS word, is one too, its
// "of" past the end (cutAfter)
const placeUnits = (ts, keys, i, cased, { headEnd = false } = {}) => {
  if (!NAMED_CITIES) NAMED_CITIES = new Set(splitWords(NAMED_CITY));
  if (!PHRASES) buildPlaces();
  const k = keys[i];
  const out = [];
  if (!k) return out;
  for (const n of phraseLens(keys, i)) out.push([n, true]);
  if (HEADS.has(k) && keys[i + 1] === 'of' && i + 2 < keys.length) out.push([keys.length - i, true]);
  if (headEnd && i === keys.length - 1 && HEADS.has(k)) out.push([1, true]);
  // (round 26, finding 2: an organization or an official country name read whole from its first word, its words before the
  // head among it, "Metro Atlanta Chamber of Commerce", "Habitat for Humanity", "Islamic Republic of Iran"; a Spanish one
  // by its head, "Banco de México", "Agencia Hispana de Seguros")
  const org = orgFrom(keys, i, headEnd) || esFrom(keys, i);
  if (org) out.push([org, true]);
  // (round 26, finding 3: a country's name only as written, accents and all, "Ísland"; and letters that are a family name
  // too only in capitals in a name with small letters, "Jordan Ames ANG")
  if (ACCENT_ONLY.has(plain(ts[i])) || capsLetters(ts[i], cased)) out.push([1, true]);
  const pre = k === 'the' || k === 'us' ? 1 : (k === 'united' && keys[i + 1] === 'states' ? 2 : 0);
  if (pre && i + pre < keys.length) for (const [n] of placeUnits(ts, keys, i + pre, cased, { headEnd })) out.push([pre + n, true]);
  // (a state's name before an organization, "Georgia Department of Education", "Virginia Tech": never before a word that
  // isn't one, "Georgia Power" being a given name and a family name a person could have)
  const st = STATE_PHRASES.has(`${k} ${keys[i + 1] || ''}`) ? 2 : STATE_PHRASES.has(k) ? 1 : 0;
  if (st && i + st < keys.length) {
    const j = i + st;
    const org = (HEADS.has(keys[j]) && keys[j + 1] === 'of' && j + 2 < keys.length) || (headEnd && j === keys.length - 1 && HEADS.has(keys[j])) || (ORG.test(keys[j]) && !ORG_AS_NAME.test(keys[j]));
    if (org) for (const [n] of placeUnits(ts, keys, j, cased, { headEnd })) out.push([st + n, true]);
  }
  if (/^(?:county|city|district|township|borough|parish)$/u.test(keys[i + 1] || '') && keys[i + 2] !== 'of' && !(headEnd && i + 2 === keys.length) && /\p{L}/u.test(k)) out.push([2, true]);
  if (NAMED_CITIES.has(k) && i + 1 < ts.length && stateAt(ts, i + 1, cased)) out.push([1, true]);
  const w = plain(ts[i]);
  const last = i === ts.length - 1;
  const job = NOT_A_FIRST_NAME.test(w) && !/^(?:pastor|coach)$/u.test(w);
  const where = whereWord(w, { named: last }) || stateAt(ts, i, cased);
  // (the military and work words on their own, "Retired", "Navy" only last, as Georgia is: a given name too)
  const onItsOwn = ON_ITS_OWN_SET.has(k) && (last || !WHERES_NAMED.has(k));
  if (job || where || onItsOwn || placeWord(w) || (ORG.test(w) && !ORG_AS_NAME.test(w))) out.push([1, job || where || onItsOwn || STANDALONE.has(k)]);
  return out;
};
// (the lengths of the phrases of the lists starting at word i, longest first)
const phraseLens = (keys, i) => {
  if (!PHRASES) buildPlaces();
  const out = [];
  for (let n = Math.min(PHRASE_MAX, keys.length - i); n >= 2; n--) if (PHRASES.has(keys.slice(i, i + n).join(' '))) out.push(n);
  return out;
};
const keysOf = (ts) => ts.map((t) => (/^(?:&|\+)$/u.test(t) ? 'and' : placeKey(t)));
// (round 26, finding 2: how many words, from word i to the end, are an organization read from its first word, 0 when they
// aren't: "The" or not, then words before a head (ORG_BEFORE's, place and organization words, a city, a phrase of the
// lists, "&" or "and" between two), a head (OF_HEADS', ORG's; "General" after one, "Consulate General"; a phrase, "United
// Way"), then "of" or "for" and at least one word. `headEnd`: or a head at the end, its "of" past it, as cutAfter reads)
const orgFrom = (keys, i, headEnd = false) => (orgStarts(keys, headEnd)[i] ? keys.length - i : 0);
// (read once for all of a name's words, from the end: whether reading from word j, the word before a head or not (`h`),
// reaches "of" or "for" after a head; so each word is looked at once, however long the name)
const ORG_TABLES = new WeakMap();
const orgStarts = (keys, headEnd) => {
  let t = ORG_TABLES.get(keys);
  if (!t) ORG_TABLES.set(keys, (t = {}));
  const name = headEnd ? 'end' : 'of';
  if (t[name]) return t[name];
  const n = keys.length;
  // (reach[j][h]: from word j, the word before it a head (1) or not (0), the reading reaches its "of" or "for")
  const reach = Array.from({ length: n + 1 }, () => [false, false]);
  reach[n] = [false, headEnd];
  for (let j = n - 1; j >= 0; j--) {
    const k = keys[j];
    if (k === 'of' || k === 'for') { reach[j] = [false, j + 1 < n]; continue; }
    if (k === 'and') continue;
    const len = phraseLens(keys, j)[0] || 0;
    const step = len || 1;
    const head = !!len || HEADS.has(k) || (ORG.test(k) && !ORG_AS_NAME.test(k));
    const word = head || k === 'general' || ORG_BEFORE_SET.has(k) || PLACES.has(k) || WHERES.has(k);
    if (!word) continue;
    for (const h of [0, 1]) {
      // ("General" after a head is the head's, "Consulate General")
      const after = head || (k === 'general' && h) ? 1 : 0;
      // ("&" or "and" between two of its words, never its first: "Boys & Girls Clubs")
      reach[j][h] = reach[j + step][after] || (keys[j + step] === 'and' && j + step + 1 < n && reach[j + step + 1][0]);
    }
  }
  const out = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    const j = keys[i] === 'the' ? i + 1 : i;
    out[i] = j < n && keys[j] !== 'and' && keys[j] !== 'of' && keys[j] !== 'for' && reach[j][0];
  }
  return (t[name] = out);
};
// (a Spanish organization: its head, the words after it, then "de" or "del" and more, or to the end: "Iglesia de Dios",
// "Constructora del Sur", "Agencia Hispana de Seguros", "Iglesia Bautista")
// (round 26: and "y" or "e" with another head, "Contabilidad y Impuestos"; or the business's own name after "El", "La", "Los"
// or "Las", "Restaurante El Rey", "Panadería La Espiga")
const esFrom = (keys, i) => {
  if (!ES_HEADS_SET.has(keys[i])) return 0;
  const n = keys.length;
  let j = i + 1;
  for (;;) {
    if (j < n && ES_AFTER_SET.has(keys[j])) j++;
    else if ((keys[j] === 'y' || keys[j] === 'e') && ES_HEADS_SET.has(keys[j + 1] || '')) j += 2;
    else break;
  }
  if (/^(?:de|del|el|la|los|las)$/u.test(keys[j] || '') && j + 1 < n) return n - i;
  return j === n && j > i + 1 ? n - i : 0;
};
// (letters that are a family name too, CAPS_ONLY's, typed in capitals in a name with small letters: "ANG")
const capsLetters = (raw, cased) => { if (!PHRASES) buildPlaces(); return cased && CAPS_ONLY_SET.has(placeKey(raw)) && !/\p{Ll}/u.test(raw) && /\p{Lu}{2}/u.test(raw); };
// (the word at which what's after a whole name, all of it, is places, organizations or jobs: k, or -1 when it isn't. Round
// 25: read as units from the end, so each is one look at each word; never a cut inside a place or an organization of more
// words, "Jordan Ames Ben Hill County" being Jordan Ames, never Jordan Ames Ben, and "Charlotte North Carolina" as typed;
// what can't be read, as typed: "Jordan Ames Edward Jones", "Jordan Lee Church")
const placeTail = (ts, least = 2, opts = {}) => {
  const n = ts.length;
  const cased = /\p{Lu}/u.test(ts.join(' ')) && /\p{Ll}/u.test(ts.join(' '));
  const keys = keysOf(ts);
  const before = countsBefore(ts);
  const all = new Array(n + 1).fill(false);
  const start = new Array(n + 1).fill(false);
  const units = [];
  all[n] = true;
  for (let i = n - 1; i >= 0; i--) {
    units[i] = placeUnits(ts, keys, i, cased, opts);
    all[i] = units[i].some(([m]) => all[i + m]);
    start[i] = units[i].some(([m, s]) => s && all[i + m]);
  }
  let k = -1;
  // (round 26: never right after the first word of a family name in parts, "María de los Ángeles" being a name, never María
  // de and Los Angeles; "Juan de la Cruz")
  for (let i = 1; i < n && k < 0; i++) if (before[i] >= least && start[i] && !PARTICLE_BEFORE.test(keys[i - 1])) k = i;
  if (k < 0) return -1;
  // (round 26: from the first word, an organization read from its first word being as long as it is)
  for (let j = 0; j < k; j++) if (units[j].some(([m]) => m > 1 && j + m > k)) return -1;
  // (a word that joins people goes with what's after it, "Jordan Rowe and Co." being Jordan Rowe)
  while (k > 1 && /^(?:and|&|y|e|et|und|n)$/iu.test(ts[k - 1]) && before[k - 1] >= least) k--;
  return k;
};
const PARTICLE_BEFORE = /^(?:de|di|da|du|des|del|della|delle|degli|dei|dos|das|do|von|van|vander|der|den|ter|ten|la|las|los|le|lo)$/u;
// (the military and work words that stand on their own after a name)
const ON_ITS_OWN = `army navy marines usmc usaf usn uscg military veterans veteran selfemployed freelance freelancer unemployed retired`;
let STANDALONE = null;
let ON_ITS_OWN_SET = null;
// (a part of the name with what follows a spaced dash, "of", "at", "from", "with" or "@", and a place, a company or a job at its
// end set apart, after `least` words of the name)
const cutAfter = (part, least, tail = true) => {
  let p = part;
  const d = p.match(SPACED_DASH);
  // (what's after the dash a place, a company, a job or more than one word: one word alone may be a family name of two
  // typed with spaces, "Jordan Ames - Lee")
  const after = d ? p.slice(d.index + d[0].length).trim() : '';
  const notName = after.split(/\s+/).length > 1 || placeOrOrg(after) || NOT_A_FIRST_NAME.test(plain(after)) || pronouns(after);
  if (d && notName && nameCount(p.slice(0, d.index).trim().split(/\s+/)) >= least) p = p.slice(0, d.index);
  let ts = p.trim().split(/\s+/).filter(Boolean);
  const counts = countsBefore(ts);
  const j = ts.findIndex((x, k) => k > 0 && k < ts.length - 1 && JOINS_A_PLACE.test(x) && counts[k] >= least);
  // (round 25: a place or an organization with "of" inside it, read whole before any "of" is: "Jordan Ames Democratic
  // Republic of the Congo", "Jordan Ames Isle of Man")
  const whole = tail ? placeTail(ts, least) : -1;
  if (whole > 0 && (j < 0 || whole < j)) return ts.slice(0, whole).join(' ');
  if (j > 0) {
    // (round 25, finding 5: an organization or a place of the "X of Y" kind is all of it, its first words before the "of"
    // too, "Jordan Ames City of Atlanta", "Jordan Ames Federal Reserve Bank of Atlanta" being Jordan Ames)
    // (round 26, finding 2: "for" as "of", "Habitat for Humanity", "Community Foundation for Greater Atlanta")
    const h = tail && /^(?:of|for)$/iu.test(ts[j]) ? placeTail(ts.slice(0, j), least, { headEnd: true }) : -1;
    if (h > 0) return ts.slice(0, h).join(' ');
    ts = ts.slice(0, j);
  }
  const k = tail ? placeTail(ts, least) : -1;
  return (k > 0 ? ts.slice(0, k) : ts).join(' ');
};
export function ownWordsOf(full) {
  const typed = String(full ?? '').replace(/\s+/g, ' ').trim();
  let t = typed;
  for (let n = 0; n < 4 && /[([{][^()[\]{}]*[)\]}]/u.test(t); n++) t = t.replace(/[([{][^()[\]{}]*[)\]}]/gu, ' ');
  t = t.replace(/[([{].*$/u, ' ');
  const lone = nameCount(t.split(',')[0].trim().split(/\s+/)) === 1;
  const parts = t.split(',').map((part, i) => {
    // (after the first comma, only right after a lone family name, "Family, Given": what's after a whole name is the comma
    // reading's, round 22 and 23's, letters and partners among it)
    if (i > 1 || (i === 1 && !lone)) return part.trim();
    // (pronouns alone after a comma: the comma reading's, as round 23 had them)
    if (pronouns(part)) return part.trim();
    let p = part.replace(pronounRun(), ' ');
    for (let n = 0; n < 4 && p.includes('/'); n++) {
      const ts = p.trim().split(/\s+/);
      const at = ts.findIndex((x) => x.includes('/') && !placeWord(x));
      if (at < 0) break;
      const [head, ...rest] = ts[at].split('/');
      // ("w/" and "c/o" join what's after them, as "with" does: "Jordan Rowe w/ kids" is Jordan Rowe)
      const before = [...ts.slice(0, at), ...(head && !/^(?:w|c)$/iu.test(head) ? [head] : [])];
      if (nameCount(before) >= 2 || (i > 0 && nameCount(before) >= 1)) p = before.join(' ');
      // (after a single word, the one word written after the slash: "Jordan/Jo Ames", "Jordan / Jo Ames")
      else p = [...before, ...ts.slice(rest.join('') ? at + 1 : at + 2)].join(' ');
    }
    // (only after a person's name, starting with a given name the lists have or initials: "Law Offices of Jordan Nguyen"
    // stays as typed)
    if (i === 0) { const first = p.trim().split(/\s+/).find((x) => !TITLE.test(x) && !/^the$/iu.test(x)) || ''; if (listedGiven(first) || /^(?:\p{L}\.)+$/u.test(first)) p = cutAfter(p, 2); }
    // (right after a lone family name and its comma, only when what's left starts with a given name the lists have:
    // "Ames, Jordan - Realtor" is Jordan Ames; "Ames, Fulton County" is never "Fulton")
    // (round 25, finding 7: a place, a company, a job or the military written straight after the given name too, "Ames, Jordan
    // Realtor", "Ames, Jordan US Navy", "Ames, Jordan Department of Labor", as after a whole name)
    else if (i === 1) {
      const cut = cutAfter(p, 1);
      const first = cut.split(' ').find((x) => !TITLE.test(x)) || '';
      if (cut !== p.replace(/\s+/g, ' ').trim() && listedGiven(first)) p = cut;
    }
    return p.replace(/\s+/g, ' ').trim();
  });
  const out = parts.join(', ').replace(/(?:,\s*)+$/u, '').trim();
  return /\p{L}/u.test(out) ? out : typed;
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
  if (t.length === l.length) return t.map((x, k) => asListed(x, l[k])).join('-');
  // Round 23 (finding 2): joined or hyphenated otherwise than the list writes it, "Mei-ling" for the list's Meiling,
  // "MINJUN" for its Min-jun: as typed when written as a name is, else the typed letters and hyphens with the list's
  // capitals, a capital after a hyphen the list has and the typed name hasn't made small ("MINJUN" is Minjun, "MEI-LING"
  // Mei-ling)
  if (/^\p{Lu}/u.test(typed) && /\p{Ll}/u.test(typed)) return typed;
  const want = [];
  for (const c of listed) { if (c === '-') { if (want.length) want[want.length - 1].cut = true; } else want.push({ c }); }
  const letters = [...typed].filter((c) => c !== '-');
  if (letters.length !== want.length) return listed;
  let k = 0;
  let afterHyphen = false;
  return [...typed].map((c) => {
    if (c === '-') { afterHyphen = true; return c; }
    const w = want[k];
    const cap = /\p{Lu}/u.test(w.c) && (k === 0 || afterHyphen || !want[k - 1].cut);
    k++;
    afterHyphen = false;
    return cap ? c.toUpperCase() : c.toLowerCase();
  }).join('');
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
  // Round 23 (finding 6c: "Grace Community", "Trinity United", "Grace AME", "Hope Recovery", "Grace Assisted Living",
  // "Jordan Lawn Service", "Jordan Car Wash", "Grace Coffee", "Jordan Market", "Hope Cattle", "Grace Dance" were greeted):
  // the kinds round 22 missed, each written whole. Churches by the words in their names and their denominations' letters
  `community communities united ame cme umc cogic elca sbc lcms ucc pcusa pca epc crc rca arp kingdom prayer campus
  students singles seniors lifehouse life word point men`,
  // (care, recovery and the practices round 22 had in long form only)
  `recovery behavioral addiction detox living assisted residence residences retirement urgent emergency treatment infusion
  ambulance ems medspa aesthetics botox laser spine ortho chiro vet animal derm obgyn ent doula birth womens occupational
  speech mental sports eye primary sleep physical plastic`,
  // (services and shops, farms and studios)
  `lawn lawns wash carwash lube detailing coffee market markets produce cattle livestock poultry eggs feed seed seeds hatchery
  organics organic pasture pastures pumpkin pumpkins pecans timber hunting fishing retreat retreats tacos smokehouse lounge
  massage books bookstore vapor smoke tobacco donuts bagels cupcakes chocolate credit legal equipment tools termite fence
  paint paints print prints press sound sounds web apps games gaming comics tattoo tattoos pottery glassworks woodworks
  workshop dance dancing ballet mountain square junction air tree trees windows doors garage development body oil burgers
  wings music martial drugs ice cream sweets band ink bees hollow berries`,
  // (companies people write after their name, one word that's no one's name: finding 7 reads what's after a family name in
  // parts and a comma as their given name unless it's a place or a company, and round 21 has "Del Rey, Compass" at del-rey.
  // Realty brokerages, and the large employers around Atlanta and in tech)
  `compass remax re/max redfin zillow sothebys sotheby's coldwell bhhs google microsoft amazon deloitte accenture kpmg
  pwc salesforce oracle ibm intel verizon comcast xfinity ups fedex walmart publix costco truist synovus
  equifax ncr aflac invesco toyota hyundai boeing lockheed raytheon cigna humana aetna
  coca-cola cocacola pepsico chick-fil-a chickfila netflix paypal mastercard amex citi citibank pnc wellstar piedmont
  northside primerica allstate geico statefarm suntrust wachovia corps airlines airline airways`,
];
// (each word's other number: round 23, finding 6b, "Jordan Service" was greeted while "Jordan Services" wasn't. A business
// word counts singular and plural alike, the lists here and ORG's, never a form that's a given name or one of these family
// names: "Banks" from "bank", "Chambers" from "chamber", "Painter" from "painters", "Pool" from "pools", "Saint" from
// "saints" ("Jordan Saint James"), "Cruise", "Burger", "Craft", "Sweet", "Wing", "Fall" (Senegal's), "Art"; round 22's family
// names too; nor any word on the names lists at all, Loan and Floor among them; and only from words of four letters or more,
// so a church's letters are never a family name ("AME" is never "Ames")
const NOT_PLACES = `banks chambers painter pool saint cruise burger craft sweet wing fall art son berry bee lives park parks stanley lee mercer farmer
  austin houston dallas denver washington jackson lincoln madison tucker kitchen kitchens woods meadows hill hills bell brooks
  stone glass marble lake rivers bay grove ridge plaza arena montana colorado maine cleveland durham henderson richmond
  rochester birmingham montgomery lancaster salem reno irvine stockton fremont toledo mesa orlando dayton raleigh burbank
  lafayette decatur dunwoody norcross covington conyers calhoun dalton cumming milton forsyth cobb fulton clayton macon rome
  boston grill gallery baker cook carpenter mason turner fisher hunter gardner miller butler porter cooper barber potter church
  christian marina pilate`;
// (ORG's words, as written there)
const orgWords = () => ORG.source.replace(/^\^\(\?:|\)\$$/g, '').split('|');
const otherNumber = (w) => {
  if (!/^[a-z]+$/.test(w)) return null;
  if (w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (/(?:ses|xes|zes|ches|shes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  if (/[^aeiou]y$/.test(w)) return `${w.slice(0, -1)}ies`;
  return /(?:s|x|z|ch|sh)$/.test(w) ? `${w}es` : `${w}s`;
};
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
  harrisburg allentown syracuse annapolis providence boulder delaware
  adairsville alto arcade braselton bremen carnesville cedartown chatsworth chickamauga cohutta commerce dacula danielsville
  dawsonville euharlee fairmount gillsville hiawassee hoschton lavonia lyerly maysville mccaysville menlo oakwood plainville
  resaca rockmart sautee taylorsville trion varnell bethlehem winder watkinsville winterville crawfordville lincolnton
  arnoldsville maxeys siloam tignall rayle warrenton harlem hephzibah waynesboro midville sylvania brooklet soperton reidsville
  glennville thunderbolt woodbine blackshear hazlehurst broxton willacoochee lakeland hahira cairo donalsonville moultrie
  leesburg georgetown richland plains ellaville montezuma marshallville centerville bonaire hawkinsville abbeville ocilla
  unadilla pinehurst dublin wrightsville sandersville eatonton monticello grantville stockbridge ellenwood bowdon whitesburg
  roopville tallapoosa waco waleska porterdale chamblee clermont talmo morganton rossville lindale armuchee alamo uvalda
  doerun pavo ochlocknee attapulgus baconton shellman smithville ludowici allenhurst walthourville riceboro nahunta hoboken
  surrency talbotton auburn vienna buckhead midtown vinings redan panthersville scottdale cabbagetown reynoldstown ormewood
  edgewood lakewood adamsville westview oakhurst avondale clarkdale sharpsburg summerhill peoplestown mechanicsville
  morningside brookwood`;
const WHERE_NAMED = `georgia virginia carolina dakota nevada savannah augusta marietta charlotte aurora alexandria phoenix
  eugene trenton odessa hiram`;
// (and places of two words, each a family name or a given name alone: "Charlotte North Carolina", "Jordan New York",
// "Virginia Beach", "Grace Fort Worth")
// Round 23 (finding 6d: "Ann Arbor", "Myrtle Beach", "Glen Ellyn", "Rocky Mount", "Villa Rica", "Flowery Branch" were
// greeted): Georgia's places of two words, metro Atlanta's communities, and the country's that start with a given name; never
// one whose words are a given name and a family name a person could have ("Grant Park", "Rose Hill", "Morgan Hill", "Holly
// Hill", "Allen Park", "Ansley Park", "Ben Hill"). A plain string now, split when first asked (as the lists above are)
const PLACE_TWO = `north_carolina south_carolina north_dakota south_dakota west_virginia new_york new_jersey new_mexico new_hampshire new_orleans new_england rhode_island los_angeles san_francisco san_diego san_antonio las_vegas st_louis saint_louis palm_beach stone_mountain peachtree_city peachtree_corners virginia_beach kansas_city oklahoma_city salt_lake fort_worth el_paso long_beach baton_rouge corpus_christi jersey_city grand_rapids little_rock des_moines fort_lauderdale fort_wayne warner_robins east_point union_city forest_park sugar_hill richmond_hill st_marys saint_marys st_simons saint_simons south_fulton santa_ana santa_rosa santa_clarita chula_vista newport_news winston_salem st_petersburg saint_petersburg huntington_beach overland_park cape_coral
  villa_rica flowery_branch social_circle locust_grove blue_ridge ball_ground powder_springs lithia_springs holly_springs
  johns_creek fort_oglethorpe fort_valley fort_gaines fort_benning fort_stewart fort_gordon fort_mcpherson tunnel_hill
  rocky_face cave_spring talking_rock tallulah_falls mount_airy mount_vernon mount_zion mountain_park mountain_city
  sky_valley young_harris east_ellijay union_point white_plains good_hope walnut_grove berkeley_lake rest_haven
  avondale_estates pine_lake pine_mountain warm_springs west_point buena_vista lake_city lake_park college_park garden_city
  port_wentworth tybee_island twin_city east_dublin lumber_city iron_city sale_city ray_city jekyll_island sea_island
  chattahoochee_hills druid_hills toco_hills embry_hills inman_park candler_park virginia_highland five_points fourth_ward
  west_end east_atlanta east_lake castleberry_hill sweet_auburn atlantic_station home_park peachtree_hills garden_hills
  collier_hills chastain_park west_midtown english_avenue vine_city east_cobb west_cobb south_dekalb belvedere_park
  gresham_park lake_claire capitol_view oakland_city cascade_heights grove_park underwood_hills north_decatur north_atlanta
  south_atlanta west_atlanta lake_lanier fair_oaks
  ann_arbor myrtle_beach glen_ellyn glen_burnie glen_cove glen_carbon rocky_mount rocky_river mary_esther lynn_haven
  eden_prairie joshua_tree carol_stream hazel_crest homer_glen crystal_river coral_gables sandy_hook sandy_point pearl_river
  mount_dora lake_mary winter_haven sherman_oaks jackson_hole royal_oak elizabeth_city charles_town virginia_city carson_city
  johnson_city jefferson_city dale_city daly_city morgan_city pearl_city port_charlotte laurel_canyon rosemary_beach
  daytona_beach vero_beach delray_beach miami_beach boynton_beach pompano_beach deerfield_beach fort_myers fort_collins
  fort_lee fort_smith fort_pierce fort_walton grand_prairie grand_forks grand_junction grand_haven cedar_rapids sioux_falls
  sioux_city rapid_city iowa_city traverse_city panama_city plant_city haines_city bossier_city junction_city culver_city
  foster_city redwood_city ocean_city atlantic_city bay_city park_city college_station round_rock sugar_land palm_bay
  palm_desert palm_coast palm_harbor west_palm boca_raton new_haven new_bedford new_britain new_rochelle new_brunswick
  spring_hill chapel_hill hilton_head staten_island long_island coney_island ellis_island mount_pleasant eau_claire
  des_plaines la_crosse la_jolla la_mesa bowling_green`;
// A US state's two letters (round 23, finding 6a: "Hope Atlanta GA", "Grace Decatur GA", "Faith Miami FL" were greeted):
// after a city, the city and its state are a place, with a comma between or not. Never a degree's letters too (MD, MA, MS,
// PA, DC), set apart as letters before this is asked
const STATE_CODES = `al ak az ar ca co ct de fl ga hi id il in ia ks ky la me mi mn mo mt ne nv nh nj nm ny nc nd oh ok or ri sc sd
  tn tx ut vt va wa wv wi wy pr gu vi`;
// Round 24 (finding 6: "Ames, Fulton County" was read as Fulton County Ames, "Hope Nigeria" and "Jordan Starbucks" were
// greeted): more kinds, each written whole. Government and the place words STOP holds (county, city, state, district,
// federal, national), the military, every country, large employers, Spanish business words. Split when first asked, as
// the rest are; each kind's word that's a given name on the lists counts only last, as Georgia does (buildPlaces)
const PLACE_MORE = [
  `county counties city cities state states district districts federal national council congressional police fire township
  borough municipal government army navy marines usmc usaf usn uscg military veterans selfemployed freelance freelancer
  unemployed department departments dept rescue sheriffs afb arb`,
  // (every country, as people write them, the short forms too; those of two words are PLACE_TWO_MORE's)
  `afghanistan albania algeria andorra angola antigua argentina armenia australia austria azerbaijan bahamas bahrain bangladesh
  barbados belarus belgium belize benin bhutan bolivia bosnia herzegovina botswana brazil brunei bulgaria burkina faso burundi
  cambodia cameroon canada chad chile china colombia comoros congo croatia cuba cyprus czechia denmark djibouti dominica
  ecuador egypt eritrea estonia eswatini swaziland ethiopia fiji finland france gabon gambia georgia germany ghana greece grenada
  guatemala guinea guyana haiti honduras hungary iceland india indonesia iran iraq ireland israel italy jamaica japan jordan
  kazakhstan kenya kiribati korea kosovo kuwait kyrgyzstan laos latvia lebanon lesotho liberia libya liechtenstein lithuania
  luxembourg madagascar malawi malaysia maldives mali malta mauritania mauritius mexico micronesia moldova monaco mongolia
  montenegro morocco mozambique myanmar burma namibia nauru nepal netherlands holland nicaragua niger nigeria macedonia norway
  oman pakistan palau palestine panama papua paraguay peru philippines poland portugal qatar romania russia rwanda samoa
  senegal serbia seychelles singapore slovakia slovenia somalia spain sudan suriname sweden switzerland syria taiwan tajikistan
  tanzania thailand timor togo tonga tobago tunisia turkey turkmenistan tuvalu uganda ukraine uruguay uzbekistan vanuatu
  vatican venezuela vietnam yemen zambia zimbabwe england scotland wales britain uk uae drc prc emirates arabia saudi zealand
  africa europe asia caribbean trinidad
  türkiye brasil guinea-bissau timor-leste españa italia deutschland nederland polska schweiz suisse österreich éire cymru
  pilipinas kampuchea magyarország česko hrvatska srbija türkiye guam aruba curaçao bermuda anguilla montserrat martinique
  guadeloupe réunion mayotte tahiti gibraltar greenland macau macao somaliland bonaire usvi usa america`,
  // (large employers, national and around Atlanta, written as people write them after their name; those of two words that
  // are a given name and a family name a person could have, "Edward Jones", "Raymond James", "Georgia Power", are left out)
  `delta target starbucks regions ameris fidelity vanguard nationwide anthem honeywell gulfstream mohawk orkin westrock
  pultegroup mailchimp spanx napa uga choa aps cdc cnn ey fed permanente georgia-pacific mercedes-benz arby's zaxby's apple
  meta waffle at&t spelman oglethorpe lowe's homedepot wellsfargo ups
  usps irs fbi nasa fema faa tsa dhs hhs hud usda epa ssa nih nsa doj dod kroger jpmorgan hartsfield-jackson ymca ywca`,
  // (Spanish business words, and a few French ones, as written with their accents and without)
  `iglesia ministerio ministerios restaurante taquería panadería tienda tiendas carnicería construcción seguros abogados abogado
  clínica farmacia escuela fundación asociación compañía empresa empresas servicios inmobiliaria bienes raíces peluquería
  lavandería joyería florería pupusería supermercado barbería zapatería ferretería mueblería tortillería paletería dulcería
  cafetería licorería notaría consultorio distribuidora importadora transportes mudanzas limpieza jardinería plomería
  remodelaciones pinturas estética academia colegio universidad instituto parroquia templo comida mariscos antojitos grupo
  hermanos pâtisserie boulangerie crêperie atelier
  agencia agencias oficina oficinas despacho despachos empresa compañía corporación sociedad cooperativa sindicato asociaciones
  fundaciones organización comercial comercializadora distribuidoras importaciones exportadora exportaciones fábrica industrias
  manufacturas productos almacén almacenes depósito bodegas proveedora suministros
  contabilidad contador contadora contadores contaduría impuestos impuesto asesoría asesorías asesores consultoría consultores
  gestoría trámites financiera finanzas préstamos préstamo créditos inversiones aseguradora remesas envíos notario notarios
  bufete abogada licenciado
  constructora constructoras construcciones remodelación carpintería herrería electricidad eléctrica eléctricos albañilería
  jardinería jardines paisajismo mantenimiento instalaciones climatización refrigeración soldadura techos techados pisos
  azulejos ventanas puertas cercas fletes mudanza transportista paquetería mensajería grúas taller talleres mecánica mecánico
  llantera llantería hojalatería autopartes refacciones refaccionaria autolavado lavandería tintorería
  pastelería repostería pescadería frutería verdulería nevería heladería cocina cocinas comedor lonchería cenaduría pizzería
  marisquería comidas tamales tacos birria birriería pollería rosticería churrería juguería licuados raspados botanas
  abarrotes minisúper tianguis vinatería cervecería vinos carnes pollos mariscos
  clínicas consultorios farmacias botica médico médicos odontología dentista ortodoncia óptica optometría laboratorio
  laboratorios radiología fisioterapia rehabilitación quiropráctico psicología terapia terapias salud enfermería veterinaria
  hospitalaria
  peluquerías barberías belleza uñas cosméticos ropa modas novias zapaterías joyerías relojería bisutería sastrería costura
  floristería regalos papelería imprenta fotografía fotógrafo estudio estudios publicidad diseño rotulación
  escuelas colegios academias institutos universidades guardería preescolar kínder primaria secundaria preparatoria
  congregación capilla catedral evangélica asamblea asambleas misión misiones
  viajes turismo hostal eventos banquetes renta rentas alquiler música producciones grabaciones computación celulares
  telefonía electrónica muebles colchones ferreterías tlapalería pinturería vidriería`,
];
// (a country that's a common family name, never a place: "Grace Jordan", "Amy Israel", "Ann England", "Kate Holland";
const PLACE_NEVER = `jordan israel england ireland holland wales trinidad montenegro portugal malta mercado iglesias
  lowe starbuck marine`;
// (and other numbers that are a family name or a given name: "Lowe" from "Lowe's", "Starbuck", "Marine")
// (countries that are given names too, as Georgia is: a place only last, after another word; first, or after a comma, a name)
const PLACE_NAMED = `chad india kenya asia mali egypt china cuba france africa navy`;
// (places and companies of two words, each a family name or a given name alone, as PLACE_TWO's)
const PLACE_TWO_MORE = `puerto_rico costa_rica el_salvador hong_kong south_africa new_zealand sri_lanka saudi_arabia dominican_republic
  united_states united_kingdom united_arab south_korea north_korea ivory_coast burkina_faso cape_verde cabo_verde czech_republic
  san_marino new_guinea equatorial_guinea south_sudan east_timor sao_tome great_britain viet_nam marshall_islands solomon_islands
  wells_fargo waffle_house home_depot norfolk_southern genuine_parts southern_company coast_guard air_force national_guard
  marine_corps state_farm kaiser_permanente`;
// Round 25 (findings 5 and 6, the lead's rule): places and organizations of more words, matched as phrases at every
// position after the name, longest first, before any one word is read ("Trinidad and Tobago", "Saint Kitts and Nevis",
// "Sierra Leone", "Georgia National Guard", "Ben Hill County"), so a place is never cut in two and never read as a couple.
// Every UN member and observer state and the common territories, in their English short and official names (one word,
// PLACE_MORE's; of more, these), a "Saint" one with "St." too (buildPlaces); the US military whole, each Reserve and every
// state's National Guard (MILITARY, STATE_NAMES), with "US", "U.S." or "United States" before it by rule (placeUnits);
// Georgia's 159 counties (GA_COUNTIES), as "<county> County"; and organizations that are a phrase of their own
const PLACE_PHRASES = `antigua_and_barbuda bosnia_and_herzegovina bosnia_herzegovina central_african_republic cote_divoire
  democratic_republic_of_the_congo democratic_republic_of_congo republic_of_the_congo north_macedonia papua_new_guinea
  saint_kitts_and_nevis saint_kitts saint_lucia saint_vincent_and_the_grenadines saint_vincent sao_tome_and_principe
  sierra_leone trinidad_and_tobago united_arab_emirates holy_see vatican_city timor_leste guinea_bissau united_states_of_america
  russian_federation syrian_arab_republic lao_peoples_democratic_republic democratic_peoples_republic_of_korea
  peoples_republic_of_china federated_states_of_micronesia slovak_republic kyrgyz_republic northern_ireland new_caledonia
  french_polynesia french_guiana western_sahara isle_of_man faroe_islands falkland_islands cook_islands cayman_islands
  virgin_islands british_virgin_islands turks_and_caicos turks_and_caicos_islands american_samoa northern_mariana_islands
  sint_maarten saint_martin saint_barthelemy saint_pierre_and_miquelon wallis_and_futuna
  clark_atlanta clark_atlanta_university morehouse_college spelman_college georgia_tech georgia_state_university kennesaw_state_university
  georgia_institute_of_technology federal_reserve federal_reserve_bank childrens_healthcare childrens_healthcare_of_atlanta
  delta_air_lines public_schools us_postal_service postal_service social_security_administration armed_forces dr_congo
  jpmorgan_chase lockheed_martin coldwell_banker northwestern_mutual inspire_brands united_way big_brothers_big_sisters
  fort_moore fort_eisenhower fort_gordon fort_benning fort_stewart hunter_army_airfield robins_afb robins_air_force_base
  moody_afb moody_air_force_base dobbins_arb dobbins_air_reserve_base kings_bay naval_submarine_base air_force_base`;
// (the US military, every branch and its Reserve, written with "US", "U.S." or "United States" before it or without)
// (round 26, finding 3: the military whole. The Reserves by their former names, "US Naval Reserve" being the Navy
// Reserve's until 2005; the uniformed services besides, the Public Health Service, the NOAA Corps and the Merchant Marine;
// the special forces people name, the Navy SEALs; and the service academies. Each with "Ret.", "Retired" and "Veteran"
// after it too, and every branch's and Reserve's letters, MILITARY_LETTERS)
const MILITARY = `army navy marines air_force coast_guard marine_corps space_force national_guard army_national_guard
  air_national_guard army_reserve navy_reserve air_force_reserve marine_corps_reserve marine_forces_reserve coast_guard_reserve
  space_force_reserve national_guard_bureau
  naval_reserve naval_air_reserve marine_corps_womens_reserve army_air_forces army_air_corps naval_militia
  public_health_service public_health_service_commissioned_corps commissioned_corps noaa_corps noaa_commissioned_officer_corps
  merchant_marine merchant_marines merchant_navy navy_seals navy_seal army_rangers army_special_forces special_forces
  green_berets marine_raiders naval_academy military_academy air_force_academy coast_guard_academy merchant_marine_academy`;
// (their letters: the Army, Navy, Air Force, Marine Corps, Coast Guard and Space Force, each Reserve, the Army and Air
// National Guard, the Public Health Service, the NOAA Corps. Each stands on its own after a name, "Jordan Ames USSF", and
// takes "Ret." after it, "USN Ret."; CAPS_ONLY's are a family name too, Ang being Chinese, so they're letters only typed in
// capitals in a name with small letters, "Jordan Ames ANG", never "Jordan Ang")
const MILITARY_LETTERS = `usa usn usaf usmc uscg ussf usar usnr usafr usmcr uscgr usmcwr arng ang usphs noaa`;
const CAPS_ONLY = `ang`;
// (the Guard, after a state's name or its short form: the National Guard, its Army and Air Guard, and a state's own Guard,
// "Georgia Guard" being the Georgia National Guard's own short name, "Texas State Guard")
const GUARDS = `national_guard army_national_guard air_national_guard guard army_guard air_guard state_guard state_defense_force`;
// (the states' short forms, as the AP writes them, "Ga.", "Calif.", "N.C.", and their postal letters, "GA": before the Guard
// only. One that's a word or a name too, "Del.", "La.", "Me", "In", only before "National Guard", never "Guard" alone)
const STATE_SHORT = `ala ariz ark calif colo conn del fla ga ill ind kan kans ky la md mass mich minn miss mo mont neb nebr nev nh nj nm
  ny nc nd okla ore oreg pa penn ri sc sd tenn tex vt va wash wva wis wisc wyo
  al ak az ar ca co ct de fl hi id il in ia ks me mi mn mt ne nv oh ok or tn tx ut wa wv wi wy dc pr gu vi`;
// (the states, for "<State> National Guard", its Army and Air National Guard too, and DC, Puerto Rico, Guam and the
// Virgin Islands)
const STATE_NAMES = `alabama alaska arizona arkansas california colorado connecticut delaware florida georgia hawaii idaho illinois
  indiana iowa kansas kentucky louisiana maine maryland massachusetts michigan minnesota mississippi missouri montana nebraska
  nevada new_hampshire new_jersey new_mexico new_york north_carolina north_dakota ohio oklahoma oregon pennsylvania rhode_island
  south_carolina south_dakota tennessee texas utah vermont virginia washington west_virginia wisconsin wyoming
  district_of_columbia dc puerto_rico guam virgin_islands`;
// (Georgia's counties, each with "County" after it)
const GA_COUNTIES = `appling atkinson bacon baker baldwin banks barrow bartow ben_hill berrien bibb bleckley brantley brooks bryan
  bulloch burke butts calhoun camden candler carroll catoosa charlton chatham chattahoochee chattooga cherokee clarke clay clayton
  clinch cobb coffee colquitt columbia cook coweta crawford crisp dade dawson decatur dekalb dodge dooly dougherty douglas early
  echols effingham elbert emanuel evans fannin fayette floyd forsyth franklin fulton gilmer glascock glynn gordon grady greene
  gwinnett habersham hall hancock haralson harris hart heard henry houston irwin jackson jasper jeff_davis jefferson jenkins
  johnson jones lamar lanier laurens lee liberty lincoln long lowndes lumpkin mcduffie mcintosh macon madison marion meriwether
  miller mitchell monroe montgomery morgan murray muscogee newton oconee oglethorpe paulding peach pickens pierce pike polk
  pulaski putnam quitman rabun randolph richmond rockdale schley screven seminole spalding stephens stewart sumter talbot
  taliaferro tattnall taylor telfair terrell thomas tift toombs towns treutlen troup turner twiggs union upson walker walton
  ware warren washington wayne webster wheeler white whitfield wilcox wilkes wilkinson worth`;
// (a word that starts an organization or a place of the "X of Y" kind, by rule: "City of Atlanta", "State of Georgia", "Town
// of Tyrone", "University of Georgia", "Bank of America", "Department of Labor", "Republic of Korea", "Church of God")
const OF_HEADS = `city cities state states town towns village villages county counties commonwealth republic kingdom principality
  emirate sultanate federation union university universities college colleges bank banks department departments dept office
  offices board boards bureau ministry ministries embassy consulate court courts school schools institute academy society
  association league council commission committee authority agency administration division district port province parish
  diocese archdiocese church churches chamber house center centre foundation fund museum hospital hospitals clinic sisters
  friends daughters sons knights boys girls corps order temple congregation assembly assemblies healthcare
  duchy confederation emirates system club scouts habitat service services network alliance coalition partnership conference
  corporation cooperative laboratory library seminary cathedral synagogue mosque mission campaign trust partners institution
  centres centers ymca ywca`;
// Round 26 (finding 2: "Jordan Ames Islamic Republic of Iran", "Jordan Ames Metro Atlanta Chamber of Commerce", "Jordan Ames
// Federal Bureau of Investigation" kept "Islamic", "Metro" and "Federal" in the name, and "Habitat for Humanity" was cut at
// "for"): an organization or an official country name is read whole from its first word (orgFrom). Reading back from "of"
// or "for", its words before the head word are its own: these, written by kind (a nation's or a government's, a court's,
// a place's size, a school's or a hospital's kind, who it serves), the place and organization words of the lists, a city,
// a phrase of the lists ("Fulton County"), and "&" or "and" between two ("Boys & Girls Clubs"). Never a word that's a
// given or family name on the lists (buildPlaces leaves out the given names and the family names that come first; the
// round 26 test fails if one is a common family name): what the code doesn't know stops it, and the name keeps it, as
// before ("Jordan Ames Grace Church of God")
const ORG_BEFORE = `united federal federated federative national international islamic arab hashemite plurinational democratic
  socialist peoples popular independent cooperative co-operative oriental bolivarian sovereign imperial grand general
  constitutional transitional provisional metro metropolitan greater regional municipal superior supreme appellate circuit
  juvenile probate magistrate technical medical dental legal community housing health mental human civil public central
  childrens womens mens veterans youth american african hispanic latino latina asian pacific atlantic caribbean global
  first big brothers girl boy scout economic development education educational environmental transit transportation water
  power electric energy airport port recreation library police fire sheriffs emergency management labor workforce
  corrections revenue treasury defense homeland security investigation disease control prevention commerce trade
  industry agriculture interior state`;
// Spanish organizations: their head word first, its words after it, then "de" or "del" (round 26, finding 2: "Jordan Ames
// Banco de México", "Ciudad de Atlanta", "Iglesia de Dios" were read word by word). Only after one of these heads is "de" a
// join, so a Spanish name with "de" stays a name ("Juan de la Cruz", "María de los Ángeles"). The Spanish business words
// of PLACE_MORE are heads too (buildPlaces); a head that's a given or family name on the lists never is
const ES_HEADS = `banco ciudad consulado embajada iglesia agencia cámara universidad ministerio secretaría municipio colegio escuela
  hospital clínica instituto asociación fundación centro departamento oficina gobierno alcaldía ayuntamiento comisión comité
  consejo junta sociedad compañía empresa grupo cooperativa sindicato federación confederación unión alianza parroquia
  capilla misión templo academia estado república reino condado distrito`;
// (and the words after a Spanish head, before its "de": "Agencia Hispana de Seguros", "Iglesia Bautista", "Cámara de
// Comercio Hispana")
const ES_AFTER = `nacional internacional general central federal municipal estatal regional metropolitana metropolitano mexicana
  mexicano hispana hispano latina latino latinoamericana latinoamericano americana americano evangélica evangélico católica
  católico bautista pentecostal adventista metodista presbiteriana apostólica apostólico profesional profesionales unida
  unido unidas unidos popular autónoma autónomo nueva nuevo primera primero mundial comunitaria comunitario familiar legal
  médica médico dental automotriz comercial industrial financiera financiero inmobiliaria dominical cultural deportiva
  deportivo educativa educativo social rural urbana urbano local integral hispanoamericana panamericana cristiana cristiano`;
// Round 26 (finding 3: "Hope Belgique", "Hope Hellenic Republic", "Jordan Suomi", "Jordan Saint Helena" were greeted, and
// Add kept "Jordan Ames St. Maarten" and "Jordan Ames Bosnia-Herzegovina" whole): the lists complete by rule, not by
// additions picked by hand. Every UN member and observer state, and the territories people come from, one line each: its
// English short names, its English official name, its names in its own languages (accents as written there: the lists read
// every word by the spelling-neutral key, so each counts with its accents and without), its older names and its letters. A
// form of one word counts as PLACE_MORE's countries do (a given name on the lists only last, as Georgia; PLACE_NEVER's, a
// common family name, never a place, as Jordan and Holland, and the round 26 test fails if a new one is a common family
// name of a people who write it last); a form of more, as a phrase; and each of more words typed with hyphens too
// ("Bosnia-Herzegovina", "Congo-Brazzaville"), and a "Saint" or "Sint" one with "St." (buildPlaces). "=" before a form:
// only as written, accents and all ("Ísland": plain "Island" is an everyday word). A test fails if one of the UN's official
// names, or one of the round 26 tester's forms, isn't known
const COUNTRIES = `Afghanistan|Islamic Republic of Afghanistan|Islamic Emirate of Afghanistan|Afghanestan
  Albania|Republic of Albania|Shqipëria|Shqipëri|Republika e Shqipërisë
  Algeria|People's Democratic Republic of Algeria|Algérie|Al Jazair|Al-Jazair|Dzayer
  Andorra|Principality of Andorra|Principat d'Andorra
  Angola|Republic of Angola|República de Angola
  Antigua and Barbuda|Antigua|Barbuda
  Argentina|Argentine Republic|República Argentina
  Armenia|Republic of Armenia|Hayastan
  Australia|Commonwealth of Australia
  Austria|Republic of Austria|Österreich|Republik Österreich
  Azerbaijan|Republic of Azerbaijan|Azərbaycan
  Bahamas|The Bahamas|Commonwealth of The Bahamas
  Bahrain|Kingdom of Bahrain|Al Bahrain
  Bangladesh|People's Republic of Bangladesh|East Pakistan
  Barbados
  Belarus|Republic of Belarus|Byelorussia|Belorussia|Bielorussia|Belarus'|Bielarus
  Belgium|Kingdom of Belgium|België|Belgique|Belgien
  Belize|British Honduras
  Benin|Republic of Benin|Bénin|République du Bénin|Dahomey
  Bhutan|Kingdom of Bhutan|Druk Yul
  Bolivia|Plurinational State of Bolivia|Estado Plurinacional de Bolivia|Republic of Bolivia
  Bosnia and Herzegovina|Bosnia Herzegovina|Bosnia|Herzegovina|Bosna i Hercegovina|BiH
  Botswana|Republic of Botswana|Bechuanaland
  Brazil|Federative Republic of Brazil|Brasil|República Federativa do Brasil
  Brunei|Brunei Darussalam|Nation of Brunei|Negara Brunei Darussalam
  Bulgaria|Republic of Bulgaria|Bulgariya|Balgariya
  Burkina Faso|Burkina|Upper Volta
  Burundi|Republic of Burundi|Uburundi
  Cabo Verde|Cape Verde|Republic of Cabo Verde|Republic of Cape Verde
  Cambodia|Kingdom of Cambodia|Kampuchea|Cambodge
  Cameroon|Republic of Cameroon|Cameroun|République du Cameroun
  Canada
  Central African Republic|CAR|Centrafrique|République centrafricaine
  Chad|Republic of Chad|Tchad|République du Tchad
  Chile|Republic of Chile|República de Chile
  China|People's Republic of China|PRC|Mainland China|Zhongguo
  Colombia|Republic of Colombia|República de Colombia
  Comoros|Union of the Comoros|The Comoros|Comores
  Congo|Republic of the Congo|Republic of Congo|Congo Brazzaville|Congo Republic
  Costa Rica|Republic of Costa Rica|República de Costa Rica
  Côte d'Ivoire|Republic of Côte d'Ivoire|Ivory Coast|Cote dIvoire
  Croatia|Republic of Croatia|Hrvatska|Republika Hrvatska
  Cuba|Republic of Cuba|República de Cuba
  Cyprus|Republic of Cyprus|Kypros|Kıbrıs
  Czechia|Czech Republic|Česko|Česká republika|Czechoslovakia
  North Korea|Democratic People's Republic of Korea|DPRK|DPR Korea
  Democratic Republic of the Congo|Democratic Republic of Congo|DR Congo|DRC|DR of the Congo|DR of Congo|Congo Kinshasa|RDC|République démocratique du Congo|Zaire
  Denmark|Kingdom of Denmark|Danmark
  Djibouti|Republic of Djibouti
  Dominica|Commonwealth of Dominica
  Dominican Republic|The Dominican Republic|República Dominicana
  Ecuador|Republic of Ecuador|República del Ecuador
  Egypt|Arab Republic of Egypt|Misr|Masr
  El Salvador|Republic of El Salvador|República de El Salvador
  Equatorial Guinea|Republic of Equatorial Guinea|Guinea Ecuatorial
  Eritrea|State of Eritrea|Ertra
  Estonia|Republic of Estonia|Eesti
  Eswatini|Kingdom of Eswatini|Swaziland|Kingdom of Swaziland
  Ethiopia|Federal Democratic Republic of Ethiopia|Ityopya|Abyssinia
  Fiji|Republic of Fiji
  Finland|Republic of Finland|Suomi
  France|French Republic|République française
  Gabon|Gabonese Republic|République gabonaise
  Gambia|The Gambia|Republic of The Gambia
  Georgia|Sakartvelo
  Germany|Federal Republic of Germany|Deutschland|Bundesrepublik Deutschland|West Germany|East Germany
  Ghana|Republic of Ghana|Gold Coast
  Greece|Hellenic Republic|Hellas|Ellada
  Grenada
  Guatemala|Republic of Guatemala|República de Guatemala
  Guinea|Republic of Guinea|Guinée|Guinea Conakry|République de Guinée
  Guinea-Bissau|Guinea Bissau|Republic of Guinea-Bissau|Guiné-Bissau
  Guyana|Co-operative Republic of Guyana|Cooperative Republic of Guyana|British Guiana
  Haiti|Republic of Haiti|Haïti|Ayiti|République d'Haïti
  Honduras|Republic of Honduras|República de Honduras
  Hungary|Magyarország
  Iceland|Republic of Iceland|=Ísland
  India|Republic of India|Bharat|Hindustan
  Indonesia|Republic of Indonesia|Republik Indonesia
  Iran|Islamic Republic of Iran|Persia
  Iraq|Republic of Iraq
  Ireland|Republic of Ireland|Éire
  Israel|State of Israel
  Italy|Italian Republic|Italia|Repubblica Italiana
  Jamaica
  Japan|Nippon|Nihon|State of Japan
  Jordan|Hashemite Kingdom of Jordan
  Kazakhstan|Republic of Kazakhstan|Qazaqstan
  Kenya|Republic of Kenya
  Kiribati|Republic of Kiribati|Gilbert Islands
  Kuwait|State of Kuwait
  Kyrgyzstan|Kyrgyz Republic|Kirghizia|Kyrgyzia
  Laos|Lao People's Democratic Republic|Lao PDR|Lao
  Latvia|Republic of Latvia|Latvija
  Lebanon|Lebanese Republic|Liban|Lubnan
  Lesotho|Kingdom of Lesotho|Basutoland
  Liberia|Republic of Liberia
  Libya|State of Libya|Libyan Arab Jamahiriya
  Liechtenstein|Principality of Liechtenstein
  Lithuania|Republic of Lithuania|Lietuva
  Luxembourg|Grand Duchy of Luxembourg|Lëtzebuerg|Luxemburg
  Madagascar|Republic of Madagascar|Madagasikara
  Malawi|Republic of Malawi|Nyasaland
  Malaysia|Malaya
  Maldives|Republic of Maldives|Maldive Islands
  Mali|Republic of Mali
  Malta|Republic of Malta
  Marshall Islands|Republic of the Marshall Islands
  Mauritania|Islamic Republic of Mauritania|Mauritanie
  Mauritius|Republic of Mauritius
  Mexico|United Mexican States|Estados Unidos Mexicanos|México
  Micronesia|Federated States of Micronesia
  Moldova|Republic of Moldova|Moldavia
  Monaco|Principality of Monaco
  Mongolia|Mongol Uls
  Montenegro|Crna Gora|Republic of Montenegro
  Morocco|Kingdom of Morocco|Maroc|Al Maghrib
  Mozambique|Republic of Mozambique|Moçambique
  Myanmar|Republic of the Union of Myanmar|Burma
  Namibia|Republic of Namibia|South West Africa
  Nauru|Republic of Nauru
  Nepal|Federal Democratic Republic of Nepal
  Netherlands|The Netherlands|Kingdom of the Netherlands|Nederland|Holland
  New Zealand|Aotearoa
  Nicaragua|Republic of Nicaragua|República de Nicaragua
  Niger|Republic of the Niger|Republic of Niger
  Nigeria|Federal Republic of Nigeria
  North Macedonia|Republic of North Macedonia|Macedonia|Severna Makedonija|FYROM
  Norway|Kingdom of Norway|Norge|Noreg
  Oman|Sultanate of Oman
  Pakistan|Islamic Republic of Pakistan
  Palau|Republic of Palau|Belau
  Panama|Republic of Panama|Panamá|República de Panamá
  Papua New Guinea|Independent State of Papua New Guinea|PNG
  Paraguay|Republic of Paraguay|República del Paraguay
  Peru|Republic of Peru|Perú|República del Perú
  Philippines|The Philippines|Republic of the Philippines|Pilipinas
  Poland|Republic of Poland|Polska
  Portugal|Portuguese Republic|República Portuguesa
  Qatar|State of Qatar
  South Korea|Republic of Korea|ROK|Hanguk|Daehan Minguk
  Romania|România|Rumania|Roumania
  Russia|Russian Federation|Rossiya|Rossiyskaya Federatsiya|Soviet Union|USSR
  Rwanda|Republic of Rwanda
  Saint Kitts and Nevis|Federation of Saint Kitts and Nevis|Saint Kitts|Saint Christopher and Nevis
  Saint Lucia
  Saint Vincent and the Grenadines|Saint Vincent
  Samoa|Independent State of Samoa|Western Samoa
  San Marino|Republic of San Marino
  Sao Tome and Principe|Democratic Republic of São Tomé and Príncipe|São Tomé|São Tomé e Príncipe
  Saudi Arabia|Kingdom of Saudi Arabia|KSA
  Senegal|Republic of Senegal|Sénégal
  Serbia|Republic of Serbia|Srbija
  Seychelles|Republic of Seychelles
  Sierra Leone|Republic of Sierra Leone
  Singapore|Republic of Singapore|Singapura
  Slovakia|Slovak Republic|Slovensko|Slovenská republika
  Slovenia|Republic of Slovenia|Slovenija
  Solomon Islands|Solomons
  Somalia|Federal Republic of Somalia|Soomaaliya
  South Africa|Republic of South Africa|RSA|Suid-Afrika
  South Sudan|Republic of South Sudan
  Spain|Kingdom of Spain|España|Reino de España
  Sri Lanka|Democratic Socialist Republic of Sri Lanka|Ceylon
  Sudan|Republic of the Sudan|The Sudan
  Suriname|Republic of Suriname|Surinam|Dutch Guiana
  Sweden|Kingdom of Sweden|Sverige
  Switzerland|Swiss Confederation|Schweiz|Suisse|Svizzera|Svizra|Helvetia|Confoederatio Helvetica
  Syria|Syrian Arab Republic
  Tajikistan|Republic of Tajikistan|Tojikiston|Tadzhikistan
  Thailand|Kingdom of Thailand|Siam|Prathet Thai
  Timor-Leste|Democratic Republic of Timor-Leste|East Timor
  Togo|Togolese Republic|République togolaise
  Tonga|Kingdom of Tonga
  Trinidad and Tobago|Republic of Trinidad and Tobago
  Tunisia|Tunisian Republic|Republic of Tunisia|Tunisie
  Türkiye|Republic of Türkiye|Turkey|Republic of Turkey
  Turkmenistan|Türkmenistan|Turkmenia
  Tuvalu|Ellice Islands
  Uganda|Republic of Uganda
  Ukraine|Ukraina|Ukrayina
  United Arab Emirates|UAE|The Emirates
  United Kingdom|United Kingdom of Great Britain and Northern Ireland|UK|Great Britain|Britain
  Tanzania|United Republic of Tanzania|Tanganyika|Zanzibar
  United States|United States of America|USA|America
  Uruguay|Oriental Republic of Uruguay|República Oriental del Uruguay
  Uzbekistan|Republic of Uzbekistan|O'zbekiston
  Vanuatu|Republic of Vanuatu|New Hebrides
  Venezuela|Bolivarian Republic of Venezuela|República Bolivariana de Venezuela
  Viet Nam|Vietnam|Socialist Republic of Viet Nam|Socialist Republic of Vietnam|Việt Nam
  Yemen|Republic of Yemen
  Zambia|Republic of Zambia|Northern Rhodesia
  Zimbabwe|Republic of Zimbabwe|Rhodesia|Southern Rhodesia
  Holy See|Vatican City|Vatican City State|State of the Vatican City|Vatican
  Palestine|State of Palestine|Palestinian Territories|West Bank|Gaza|Gaza Strip
  Taiwan|Republic of China|ROC|Formosa|Chinese Taipei
  Kosovo|Republic of Kosovo|Kosova
  Puerto Rico|Commonwealth of Puerto Rico|Borinquen
  Guam|Guåhan
  US Virgin Islands|United States Virgin Islands|Virgin Islands|USVI
  American Samoa
  Northern Mariana Islands|Commonwealth of the Northern Mariana Islands|CNMI|Saipan
  British Virgin Islands|BVI|Tortola
  Cayman Islands|Caymans|Grand Cayman
  Bermuda
  Anguilla
  Montserrat
  Turks and Caicos|Turks and Caicos Islands|TCI
  Falkland Islands|Falklands|Islas Malvinas|Malvinas
  Gibraltar
  Saint Helena|Saint Helena Ascension and Tristan da Cunha|Ascension Island
  Pitcairn Islands|Pitcairn
  Aruba
  Curaçao
  Sint Maarten|Saint Martin|Saint Maarten
  Bonaire|Sint Eustatius|Statia|Caribbean Netherlands|Netherlands Antilles
  Greenland|Kalaallit Nunaat|Grønland
  Faroe Islands|Faroes|Føroyar
  French Guiana|Guyane
  Guadeloupe
  Martinique
  Réunion|La Réunion
  Mayotte
  Saint Barthélemy|Saint Barts|Saint Barths|Saint Barth
  Saint Pierre and Miquelon
  French Polynesia|Tahiti
  New Caledonia|Nouvelle-Calédonie
  Wallis and Futuna
  Hong Kong|Hong Kong SAR|HKSAR
  Macau|Macao|Macau SAR|Macao SAR
  Cook Islands
  Niue
  Tokelau
  Norfolk Island
  Christmas Island
  Isle of Man
  Åland|Aland Islands
  Western Sahara|Sahrawi Arab Democratic Republic
  Somaliland|Republic of Somaliland
  Northern Cyprus
  England|Scotland|Wales|Northern Ireland`;
// (company forms written after a name, Mexico's and Spain's: "S.A. de C.V.", "S. de R.L.")
const COMPANY_FORMS = `sa_de_cv s_de_rl s_de_rl_de_cv sab_de_cv sapi_de_cv s_a_de_c_v`;
let PLACES = null;
let WHERES = null;
let WHERES_NAMED = null;
let TWOS = null;
let STATES = null;
let PHRASES = null;
let PHRASE_MAX = 2;
let HEADS = null;
let STATE_PHRASES = null;
let ACCENT_ONLY = null;
let CAPS_ONLY_SET = null;
let ORG_BEFORE_SET = null;
let ES_HEADS_SET = null;
let ES_AFTER_SET = null;
let ROUND26 = null;
const splitWords = (s) => s.split(/\s+/).filter(Boolean);
// Round 24 (finding 6: "Jordan Taquería" was greeted while "Jordan Taqueria" wasn't): place and business words, as listed and
// as typed, compared by the spelling-neutral key, accents, apostrophes, hyphens and capitals aside ("Taquería" is taqueria,
// "Arby's" arbys, "Coca-Cola" cocacola), as names are (_given-names.js nameKey)
// (round 25: a word of plain a to z alone, as the lists' words are, is its own key in small letters, at once)
const placeKey = (w) => (/^[A-Za-z]+$/.test(w) ? w.toLowerCase() : nameKey(plain(w)).replace(/[^\p{L}\p{N}]+/gu, ''));
const keyed = (s) => splitWords(s).map(placeKey);
const buildPlaces = () => {
  ROUND26 = [];
  PLACES = new Set(PLACE_WORDS.flatMap(keyed));
  const not = new Set([...keyed(NOT_PLACES), ...keyed(PLACE_NEVER)]);
  WHERES = new Set(keyed(WHERE));
  WHERES_NAMED = new Set([...keyed(WHERE_NAMED), ...keyed(PLACE_NAMED)]);
  // (round 24: government, the military, every country, large employers, Spanish business words: anywhere after a name's
  // first word, as PLACE_WORDS' are; one that's a given name on the lists, or Georgia's kind, only last, as WHERE_NAMED's
  // are; one that's a common family name there, never: PLACE_NEVER)
  // (round 26: the Spanish business words keyed once, heads of Spanish organizations too, ES_HEADS_SET)
  const spanish = keyed(PLACE_MORE[PLACE_MORE.length - 1]);
  for (const w of [...PLACE_MORE.slice(0, -1).flatMap(keyed), ...spanish]) {
    if (not.has(w) || WHERES_NAMED.has(w)) continue;
    if (onTheLists(w) || familyFirst(w)) WHERES_NAMED.add(w); else PLACES.add(w);
  }
  // (and each word's other number, the lists' and ORG's, unless it's a given name, a family name that comes first, a
  // family name here, letters after a name, or shorter than three letters)
  // (round 26: each one kept, word and other number, so a standalone word's other number is one too, below)
  const others = new Map();
  for (const w of [...PLACES, ...orgWords()]) {
    const o = w.length >= 4 ? otherNumber(w) : null;
    if (o && o.length >= 3 && !PLACES.has(o) && !ORG.test(o) && !not.has(o) && !onTheLists(o) && !familyFirst(o) && !knownLetters(o)) { PLACES.add(o); others.set(w, o); }
  }
  TWOS = new Set(splitWords(`${PLACE_TWO} ${PLACE_TWO_MORE}`).map((p) => p.split('_').map(placeKey).join(' ')));
  STATES = new Set(splitWords(STATE_CODES));
  // (round 25: the phrases, a "Saint" one with "St." too; the military; every state's National Guard; Georgia's counties)
  const of = (list) => splitWords(list).map((p) => p.split('_').map(placeKey).join(' '));
  PHRASES = new Set([...TWOS, ...of(PLACE_PHRASES), ...of(MILITARY).filter((p) => p.includes(' ')), ...of(COMPANY_FORMS)]);
  // (round 26, finding 3: a word that's a given or family name on the lists, or a family name that comes first: never one
  // of the new kinds' own words. A common family name of a people who write it last, SURNAMES', is never one either: the
  // round 26 test checks every one of them, so the first name read never waits on that list)
  const named = (w) => onTheLists(w) || familyFirst(w);
  // (the words that start what's after a name on their own, round 25's, and round 26's: every form of a country of one word,
  // the military's letters, and each one's other number, "Bodega" with "Bodegas", "Lao" with "Laos")
  STANDALONE = new Set([...keyed(PLACE_WORDS[PLACE_WORDS.length - 1]), ...PLACE_MORE.slice(1).flatMap(keyed), ...keyed(ON_ITS_OWN)]);
  ON_ITS_OWN_SET = new Set(keyed(ON_ITS_OWN));
  CAPS_ONLY_SET = new Set(keyed(CAPS_ONLY));
  for (const w of keyed(MILITARY_LETTERS)) {
    if (CAPS_ONLY_SET.has(w) || named(w)) continue;
    if (!PLACES.has(w)) ROUND26.push(w);
    PLACES.add(w); STANDALONE.add(w); ON_ITS_OWN_SET.add(w);
  }
  // (round 26: every UN member and observer state and the territories, COUNTRIES: one word as PLACE_MORE's countries, more
  // as a phrase, each typed with hyphens too, and "=" ones only as written)
  ACCENT_ONLY = new Set();
  const single = (w) => {
    if (!w || not.has(w) || WHERES_NAMED.has(w) || PLACES.has(w)) return;
    if (onTheLists(w) || familyFirst(w)) WHERES_NAMED.add(w); else { PLACES.add(w); STANDALONE.add(w); ROUND26.push(w); }
  };
  // (each word keyed once: "Republic", "of" and "the" come back often)
  const seen = new Map();
  const key = (w) => { let k = seen.get(w); if (k === undefined) seen.set(w, (k = placeKey(w))); return k; };
  for (const line of COUNTRIES.split('\n')) for (const form of line.split('|')) {
    const f = form.trim();
    if (f.startsWith('=')) { ACCENT_ONLY.add(plain(f.slice(1))); continue; }
    const ws = splitWords(f);
    const ks = ws.map(key).filter(Boolean);
    if (ks.length === 1) {
      single(ks[0]);
      // (one typed with hyphens, spaced too: "Guiné-Bissau" as "Guiné Bissau")
      if (ws[0].includes('-')) PHRASES.add(ws[0].split('-').map(key).filter(Boolean).join(' '));
    } else if (ks.length > 1) {
      PHRASES.add(ks.join(' '));
      if (ks.length <= 3) single(ks.join(''));
    }
  }
  // (and the Spanish heads, place words wherever they are, as the Spanish business words are)
  for (const w of keyed(ES_HEADS)) single(w);
  // (each standalone word's other number, when the lists took it: PLACES has it)
  for (const [w, o] of others) if (STANDALONE.has(w)) STANDALONE.add(o);
  for (const st of of(STATE_NAMES)) for (const g of ['national guard', 'army national guard', 'air national guard']) PHRASES.add(`${st} ${g}`);
  // (round 26: every Guard after a state's name or short form; the one of two words, "<State> Guard", never after a short
  // form that's a word or a name too, "Del.", "La.", "Me")
  const plainWordToo = (w) => named(w) || FAMILY_START.test(w) || /^(?:in|me|or|oh|ok|hi|id|ill|wash|ore|mass|miss|ind|mo|pa|al|ma|ark)$/u.test(w);
  const guards = of(GUARDS);
  for (const st of of(STATE_NAMES)) for (const g of guards) PHRASES.add(`${st} ${g}`);
  // (a short form before the National Guard, its Army and Air Guard, and "Guard": "Ga. Air National Guard", "GA Guard")
  for (const st of keyed(STATE_SHORT)) for (const g of guards.slice(0, 4)) if (g !== 'guard' || !plainWordToo(st)) PHRASES.add(`${st} ${g}`);
  // (round 26: "Ret." with the rest, and after every branch's letters, "USN Ret.", "USMC Retired")
  for (const b of [...of(MILITARY), ...keyed(MILITARY_LETTERS).filter((w) => !CAPS_ONLY_SET.has(w))]) for (const w of ['veteran', 'veterans', 'retired', 'ret']) PHRASES.add(`${b} ${w}`);
  STATE_PHRASES = new Set(of(STATE_NAMES));
  for (const c of of(GA_COUNTIES)) PHRASES.add(`${c} county`);
  // (a "Saint" one with "St." too; round 26: anywhere in it, and Dutch "Sint" too, "St. Maarten", "Federation of St. Kitts")
  for (const p of [...PHRASES]) if (/\bs(?:a)?int\b/u.test(p)) PHRASES.add(p.replace(/\bs(?:a)?int\b/gu, 'st'));
  PHRASE_MAX = 2;
  for (const p of PHRASES) { let c = 1; for (let i = p.indexOf(' '); i >= 0; i = p.indexOf(' ', i + 1)) c++; if (c > PHRASE_MAX) PHRASE_MAX = c; }
  // (round 26: and each head's other number, "Centers", "Clubs", "Systems"; the words before a head; the Spanish heads, the
  // Spanish business words among them, and the words after one. None a given or family name on the lists)
  HEADS = new Set(keyed(OF_HEADS));
  // (never a word for one person, "Son", "Sister", "Brother", "Daughter", "Friend")
  for (const w of [...HEADS]) { const o = w.length >= 4 ? otherNumber(w) : null; if (o && !named(o) && !/^(?:son|sister|brother|daughter|friend)$/u.test(o)) HEADS.add(o); }
  ORG_BEFORE_SET = new Set(keyed(ORG_BEFORE).filter((w) => !named(w)));
  ES_HEADS_SET = new Set([...keyed(ES_HEADS), ...spanish].filter((w) => !named(w) && !WHERES_NAMED.has(w)));
  ES_AFTER_SET = new Set(keyed(ES_AFTER).filter((w) => !named(w)));
};
/** A word (as `plain` has it) that marks a place or an organization wherever it is after a name's first word */
export const placeWord = (w) => { if (!PLACES) buildPlaces(); return PLACES.has(placeKey(w)); };
/** (for the tests: every word the place lists hold, by where it counts, each word's other number among them) */
// (round 25: and the phrases, the words that count only last, and the countries that are common family names, never a place)
export const placeLists = () => {
  if (!PLACES) buildPlaces();
  return { anywhere: [...PLACES], last: splitWords(WHERE), lastNamed: splitWords(WHERE_NAMED), two: [...TWOS], phrases: [...PHRASES], named: [...WHERES_NAMED], never: keyed(PLACE_NEVER),
    // (round 26: the words its lists added that count anywhere, every country's, the military's letters, the Spanish heads;
    // and the words before an organization's head)
    round26: [...ROUND26], orgWords: [...ORG_BEFORE_SET] };
};
/** Two words (as `plain` has them) that are a place together ("ann arbor", "villa rica") */
const placeTwo = (a, b) => { if (!TWOS) buildPlaces(); return TWOS.has(`${placeKey(a)} ${placeKey(b)}`); };
// (the word at k a state's two letters after another word: in capitals, in a name typed all in one case, or after a city
// the lists know, "Atlanta Ga")
const stateAt = (raw, k, cased) => {
  if (!STATES) buildPlaces();
  const w = plain(raw[k]);
  if (k < 1 || !STATES.has(w) || knownLetters(w)) return false;
  return !cased || raw[k].replace(/[^\p{L}]/gu, '') === w.toUpperCase() || whereWord(plain(raw[k - 1]));
};
/** A state or a city: a place when written last after another word; `named`: those that are given names too as well */
export const whereWord = (w, { named = true } = {}) => { if (!WHERES) buildPlaces(); const k = placeKey(w); return WHERES.has(k) || (named && WHERES_NAMED.has(k)); };
// (a place or an organization in what's written after a comma, round 22: "Grace Church", "Sandy Springs", "Mercy
// Hospital", "Atlanta", "Edward Jones LLC"; a family word isn't one there, "Rowe, Jordan & family" being Jordan Rowe and
// family, nor a state or city that's a given name too, "Ames, Savannah" being Savannah Ames, nor a place of two words
// after "de" or "del", a given name's own, "Reyes, Ma. de los Angeles")
// (round 23: and a city and its state's two letters, "Ames, Decatur GA", and the lists' new kinds, other numbers and places
// of two words, the same lists as the greeting's)
// (round 25, findings 6 and 7: and a phrase of the lists anywhere in it, matched before the "&" or "and" of a couple is
// read, "Saint Kitts and Nevis", "Trinidad & Tobago", "Sierra Leone", "Navy Reserve"; an "X of Y", "Town of Tyrone"; or
// "US", "U.S.", "United States" or "The" before one, or before the military or a place, "US Navy", "The Philippines")
const placeOrOrg = (p) => {
  const raw = String(p || '').split(/\s+/).filter((x) => plain(x));
  const ws = raw.map(plain);
  const cased = /\p{Lu}/u.test(String(p || '')) && /\p{Ll}/u.test(String(p || ''));
  if (ws.some((w, k) => placeWord(w) || (ORG.test(w) && !NOT_NAMED.test(w) && !/^households?$/u.test(w)) || whereWord(w, { named: false })
    || (k > 0 && placeTwo(ws[k - 1], w) && !(k > 1 && /^(?:de|del)$/u.test(ws[k - 2]))) || stateAt(raw, k, cased))) return true;
  const keys = keysOf(String(p || '').split(/\s+/).filter((x) => plain(x) || /^(?:&|\+)$/u.test(x)));
  if (!PHRASES) buildPlaces();
  // (round 26: and an organization read from its first word, "Habitat for Humanity", "Banco de México")
  const many = (i) => phraseLens(keys, i).length > 0 || (HEADS.has(keys[i]) && keys[i + 1] === 'of' && i + 2 < keys.length) || orgFrom(keys, i) > 0 || esFrom(keys, i) > 0;
  const one = (i) => !!keys[i] && (many(i) || STANDALONE_MILITARY.test(keys[i]) || placeWord(keys[i]) || whereWord(keys[i]));
  return keys.some((k, i) => !(i > 1 && /^(?:de|del)$/u.test(keys[i - 1])) && (many(i) || ((k === 'us' || k === 'the') && one(i + 1)) || (k === 'united' && keys[i + 1] === 'states' && one(i + 2))));
};
// (the military's words of one, after "US", "U.S." or "United States")
const STANDALONE_MILITARY = /^(?:army|navy|marines|military|armedforces)$/u;
// Pronouns written after a name, a slash between ("she/her", "they/them", "(he/him)", "Pronouns: she/they"): never a name,
// never in an address (round 23)
const PRONOUN = /^(?:she|her|hers|he|him|his|they|them|their|theirs|xe|xem|xyr|ze|zir|hir|ey|em|eir|fae|faer|it|its|any|all)$/u;
const pronouns = (p) => {
  const t = String(p || '').toLowerCase().replace(/^[\s([]*pronouns?\s*:?\s*/u, '');
  const bits = t.split(/[\s/()[\],;:]+/u).filter(Boolean);
  return t.includes('/') && bits.length > 1 && bits.length <= 6 && bits.every((b) => PRONOUN.test(b));
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
  // (round 26: the words as typed too, before letters are set apart: a syllable of a given name written in parts can be a
  // degree's letters as well, "Ann Young Ra", firstIsFamily below)
  const typed = ws;
  ws = withoutLetters(ws);
  const initial = (w, k) => k === 1 && ws.length === 3 && /^\p{L}\.$/u.test(w);
  return ws.every((w, k) => LETTER_WORD.test(w) || initial(w, k)) ? { title, words: ws, typed } : null;
};
export const plainWords = (raw) => plainParts(raw)?.words || null;

// Whether a name's first word is its family name, written first (round 22, finding 3: one answer, read both by the full
// name's greeting and by the check of the name they go by, so "Kato Yuki" with "Kato" as the name they go by is never
// greeted "Kato"): a family name that always comes first (rule 3: "Nguyễn Văn An", "Kim Min-jun", or a hyphenated first
// word starting with one, "Kim-Lee", unless the whole is a given name, "Jo-Ann", "Min-jun"); one that comes first only
// before a given name of its own people's ("Sam Rainsy", "Tien Yu-ting": _given-names.js FAMILY_NAMES_OF), never
// when the two are given names people go by together before a family name ("Thanh Huong Ames" is Thanh Huong); or any
// first word before a given name of Hungary's at the end ("Simon Zoltán", "Balázs Péter")
//   Round 23 (finding 4: "Simon Katalin Anna" was greeted "Simon", only the last word being asked): every given word
// after the first is evidence, not only the last or the next ("Fábián Gergely Norbert", "Tien Van Minh"); and Hungary's
// order is _given-names.js hungarianOrder's (finding 3, "Simon Zoltánné", a wife by her husband's name; finding 5,
// Hungary's family names before the names Hungarians share with everyone, "Simon Rita")
//   Round 25 (findings 1 to 3, the lead's rule): after a family name some people write first, the first word is theirs
// only on positive evidence the name is written given name first, a family name of a people who write it last after it
// ("Ann Smith", "Sam Johnson", "Juan Luna"): anything else gets no name ("Ann Hye-kyo", "Sam Thida", "Simon Martinne"),
// the lists and the shapes no longer the guard (_given-names.js familyFirstUnsure)
// (two given names people go by together first, "Thanh Huong Ames", "Soo Ah Kow": a pair only before a family name of a
// people who write it last, as the evidence is read, "Soo Ah Kow" being Ah Kow of the Soo family)
//   Round 26 (finding 1, the lead's rule: "Ann Da Young" is Da-young of the Ann family, _given-names.js familyFirstUnsure):
// and the name as typed (`typed`, before letters were set apart) when a word set apart is written as a name is, no dot and
// not in capitals beside small letters, and makes a given name written in parts with the word before it: "Ann Young Ra" is
// Young-ra of the Ann family, never Ann Young with an RA ("Ann Young, RA" and "Ann Young RA" still are)
const firstIsFamily = (ws, typed = null) => ws.length > 1 && (familyFirst(ws[0]) || (!givenName(ws[0]) && familyFirst(ws[0].split('-')[0]))
  || (ws.length === 3 && givenPair(ws[0], ws[1]) ? familyFirstUnsure(ws, { pair: true })
    : ws.slice(1).some((w) => familyFirstBefore(ws[0], w)) || familyFirstUnsure(ws)) || hungarianOrder(ws)
  || (!!typed && typed.length > ws.length && lettersAsAName(typed.slice(ws.length), typed) && givenInParts(typed)));
// (letters set apart that are written as a name is: no dot, and not all in capitals in a name with small letters)
const lettersAsAName = (set, all) => {
  const cased = /\p{Lu}/u.test(all.join(' ')) && /\p{Ll}/u.test(all.join(' '));
  return set.some((w) => !w.includes('.') && !(cased && !/\p{Ll}/u.test(w)));
};

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
    const typed = [...ws];
    let marked = titled || (i === 0 && /,/.test(bits[i + 1] || ''));
    // (a last word that's only ever letters is set apart; one that's a family name too, "Anh Van DO", is counted too)
    while (ws.length > 1 && lettersAt(ws.slice(-1))) { if (!AFTER_NAME.test(bare(ws[ws.length - 1]))) add(ws[ws.length - 1]); ws.pop(); }
    while (ws.length > 1 && (NOT_NAMED.test(plain(ws[ws.length - 1])) || ORG.test(plain(ws[ws.length - 1])))) { ws.pop(); marked = true; }
    if (ws.length > 1 || (ws.length === 1 && marked)) add(ws[ws.length - 1]);
    if (firstIsFamily(ws, typed)) add(ws[0]);
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
  // (round 23: and a city and its state's two letters last, "Hope Atlanta GA", "Grace Decatur GA")
  // (round 25: and a phrase of the lists anywhere in it, "Jordan Côte d'Ivoire", "Hope Sierra Leone", "Grace Ben Hill County")
  const keys = keysOf(ws);
  // (round 26: and the military's letters that are a family name too, typed in capitals, "Hope ANG")
  if (ws.some((w, k) => (k > 0 && placeTwo(plain(ws[k - 1]), plain(w))) || phraseLens(keys, k).length || (k > 0 && capsLetters(w, cased))) || whereWord(plain(ws[ws.length - 1])) || stateAt(ws, ws.length - 1, cased)) return '';
  // ("y" and "e" join two people in Spanish and Portuguese, "José y María Cruz": in small letters, or in a name with no
  // small letters at all, never an initial)
  if (rest.some((w) => /^[ye]$/u.test(w) || (!cased && /^[YE]$/u.test(w)))) return '';
  const [first] = ws;
  // (its first word a family name written first: "Kim Min-jun", "Sam Rainsy", "Tien Yu-ting", "Simon Zoltán". The same
  // reading the name they go by is checked against: firstIsFamily, round 22)
  if (firstIsFamily(ws, parts.typed)) return '';
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
