// Advisory Board round 20 (Nov 21 2026), the greeting's own awkward names: round 20's 13 kinds of finding and the
// families of each, every row with its answer key. Each row: [full name, preferred name, ...what's acceptable]; no name
// ('') is always acceptable as well (a missed name is fine, a wrong one never is). Made-up people only.
//   K1 letters after a title and family name   K2 "Ma." and short forms with a particle   K3 ranks with numbers
//   K4 three people, commas                    K5 hidden marks, dashes, apostrophes, middle dots
//   K6 other scripts' commas, semicolons       K7 titles and offices not on any list   K8 families and companies
//   K9 someone not named after "and"           K10 letters as the name they go by      K11 words around the name they go by
//   K12 two capitals as a first name           K13 family name first, short ways of writing a first name
const J = 'Joanna Ames';
const rows = [];
const add = (full, pref, ...ok) => rows.push([full, pref, ...ok]);
const U = (cp) => String.fromCodePoint(cp);
const upper = (s) => s.toUpperCase();
const lower = (s) => s.toLowerCase();

// K1: letters after a title and family name (no first name in it: no name), and after a whole name (its first name)
const K1_TITLES = ['Mrs', 'Mrs.', 'Dr.', 'Rev.', 'Dr', 'Prof.', 'Pastor', 'Mr. & Mrs.'];
const K1_LETTERS = ['Ph D', 'Ph D.', 'Ph. D.', 'PhD', 'PHD', 'ThM', 'ThM.', 'Psy D', 'Ed D.', 'M D', 'LMHC', 'FACC', 'DD', 'MAT', 'LCSW', 'M.Ed', 'DMin', 'D.Min.', 'MBA', 'Esq.'];
for (const t of K1_TITLES) for (const l of K1_LETTERS) for (const c of [(s) => s, upper]) {
  add(c(`${t} Quill ${l}`), '');
  add(c(`${t} Jordan Quill ${l}`), '', ...(t.includes('&') ? [] : ['Jordan']));
}

// K2: "Ma." (María, Filipino) and "Mª" before a particle or a name; their given name is all of it
const K2 = ['Ma. del Carmen', 'Ma. Del Carmen', 'Ma. de los Angeles', 'Ma. de Jesus', 'Ma. de la Paz', 'Ma. del Rosario', 'Ma. de Lourdes', 'Ma. Teresa', 'Ma. Dolores',
  'Ma.Teresa', 'Mª José', 'M.ª José', 'Mª. José', 'Ma José', 'Ma Teresa'];
for (const g of K2) {
  for (const f of ['Reyes', 'Cruz', 'Santos']) {
    add(`${g} ${f}`, '', g);
    add(`Dr. ${g} ${f}`, '', g);
    add(`${f}, ${g}`, '', g);
  }
  add(J, g, g, 'Joanna');
}
add('María del Carmen Reyes', '', 'María del Carmen', 'María');
add('Maria Teresa Cruz', '', 'Maria Teresa', 'Maria');

// K3: ranks with numbers, and "(Ret.)"
const K3 = ['2nd Lt.', '1st Lt.', '1st Sgt.', 'Sgt. 1st Class', 'Petty Officer 1st Class', '1SG', 'CW2', 'CW3', 'CW4', 'CW5', 'PO1', 'PO2', 'PO3', 'WO1', 'E-5', 'O-3',
  '2LT', '1LT', 'SFC (Ret.)', 'MSgt (Ret)', 'Capt. (Ret.)', 'Col. (ret)', 'LTC (R)', '3rd Officer', '2nd Asst. Chief'];
for (const r of K3) for (const c of [(s) => s, upper]) {
  add(c(`${r} Jordan Ames`), '', 'Jordan');
  add(c(`${r} Ames`), '');
  add(c(`${r} Amy Rowe`), '', 'Amy');
  add(J, c(`${r} Jo`), 'Jo', 'Joanna');
}

// K4: more than two people, with commas (and two, last name first): no one person's name to greet; one person last
// name first is theirs
const K4_SETS = [['Jordan', 'Amy', 'Sam', 'Rowe'], ['Maria', 'Jose', 'Ana', 'Cruz'], ['Kwame', 'Ama', 'Kofi', 'Mensah'], ['Priya', 'Raj', 'Anil', 'Patel'], ['DeShawn', 'LaToya', 'Tremaine', 'Jackson']];
for (const [a, b, c, f] of K4_SETS) {
  for (const p of [`${a}, ${b} and ${c} ${f}`, `${a}, ${b}, and ${c} ${f}`, `${a}, ${b}, ${c} ${f}`, `${a} and ${b}, ${c} ${f}`, `${f}, ${a} & ${b} & ${c}`, `${f}, ${a}, ${b} and ${c}`,
    `${f}, ${a}, ${b} & ${c}`, `${a}, ${b} & ${c} ${f}`, `${a} ${f}, ${b} ${f} and ${c} ${f}`, `${f}, ${a} & ${b}`]) for (const k of [(s) => s, upper]) add(k(p), '');
  add(`${f}, ${a}`, '', a);
  add(upper(`${f}, ${a}`), '', a);
}

// K5: hidden marks inside and around a name (their name is the same without them), dashes, apostrophes, middle dots
const HIDDEN = [0xAD, 0x200E, 0x200F, 0x202A, 0x202B, 0x202C, 0x202D, 0x202E, 0x2066, 0x2067, 0x2068, 0x2069, 0x200B, 0x200C, 0x200D, 0x2060, 0xFEFF, 0x180E,
  0x34F, 0x3164, 0xFFA0, 0xFE0F, 0xE0020, 0x61C, 0x2061, 0x115F];
for (const cp of HIDDEN) {
  const c = U(cp);
  add(`Jor${c}dan Ames`, '', 'Jordan');
  add(`${c}Jordan Ames`, '', 'Jordan');
  add(`Jordan${c} Ames`, '', 'Jordan');
  add(`Jordan Am${c}es`, '', 'Jordan');
  add(J, `Jo${c}dy`, 'Jody', 'Joanna');
  add(`Dr.${c} Ames`, '');
}
const DASHES = [0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xFE58, 0xFE63, 0xFF0D, 0x2E3A, 0x2043, 0x2E3B, 0x58A, 0x5BE];
const PAIRS = [['Jo', 'Ann', 'Jo-Ann'], ['Mary', 'Kate', 'Mary-Kate'], ['Jean', 'Pierre', 'Jean-Pierre'], ['Ann', 'Marie', 'Ann-Marie']];
for (const cp of DASHES) {
  const d = U(cp);
  for (const [a, b, whole] of PAIRS) {
    add(`${a}${d}${b} Ames`, '', whole);
    add(upper(`${a}${d}${b} Ames`), '', whole);
    add(J, `${a}${d}${b}`, whole, 'Joanna');
  }
}
const APOS = [0x2019, 0x2018, 0x60, 0xB4, 0x2BC, 0x2BB, 0x2032, 0xFF07, 0x2C8, 0x201B, 0x27];
for (const cp of APOS) {
  const a = U(cp);
  for (const [x, y, whole] of [['D', 'Andre', "D'Andre"], ['De', 'Aaron', "De'Aaron"], ['Ja', 'Marr', "Ja'Marr"]]) {
    add(`${x}${a}${y} Smith`, '', whole);
    add(upper(`${x}${a}${y} Smith`), '', whole);
    add(J, `${x}${a}${y}`, whole, 'Joanna');
  }
  add(`Jordan O${a}Brien`, '', 'Jordan');
  add(`Ka${a}iulani Kalani`, '', `Ka${a}iulani`, "Ka'iulani");
}
for (const cp of [0xB7, 0x2022, 0x2219, 0x22C5, 0x30FB, 0x387, 0x2027, 0xFF65]) {
  const d = U(cp);
  add(`Gal${d}la Puig`, '', 'Gal·la');
  add(upper(`Gal${d}la Puig`), '', 'Gal·la');
  add(J, `Gal${d}la`, 'Gal·la', 'Joanna');
  add(`Jordan Gal${d}la`, '', 'Jordan');
}

// K6: other scripts' commas, semicolons, and a comma in the name they go by
const COMMAS = [0xFF0C, 0x3001, 0x60C, 0xFE50, 0x201A, 0x3B, 0xFF1B, 0x61B, 0xB8, 0xFE51, 0x55D, 0x7F8, 0xA60D];
for (const cp of COMMAS) {
  const c = U(cp);
  add(`Ames${c} Jordan`, '', 'Jordan');
  add(`Ames${c}Jordan`, '', 'Jordan');
  add(`AMES${c} JORDAN`, '', 'Jordan');
  add(`Ames ${c} Jordan`, '', 'Jordan');
  add(J, `Ames${c} Jo`, 'Jo', 'Joanna');
  add(J, `AMES${c} JORDAN`, 'Jordan', 'Joanna');
}
for (const p of ['AMES, JORDAN', 'SMITH, JOHN', 'Ames, Jordan', 'ames, jordan', 'AMES, MARY BETH', 'Rowe, Amy & Sam', 'Jo, she/her', 'Jo, PhD']) {
  const given = { 'AMES, JORDAN': 'Jordan', 'SMITH, JOHN': 'John', 'Ames, Jordan': 'Jordan', 'ames, jordan': 'Jordan', 'AMES, MARY BETH': 'Mary Beth', 'Jo, she/her': 'Jo', 'Jo, PhD': 'Jo' }[p];
  add(J, p, 'Joanna', ...(given ? [given] : []));
}

// K7: titles and offices no list has, before a whole name (their first name) and before a family name (none). A word
// that's a given name as often (Amir, Lola) may be either
const K7 = ['Fulton County Commissioner', 'DeKalb County Commissioner', 'Cobb County Sheriff', 'Georgia State Senator', 'Atlanta City Councilmember', 'Board Chair', 'Vice Chair',
  'Board Member', 'Trustee', 'Treasurer', 'Secretary-Treasurer', 'Mayor-elect', 'Senator-elect', 'Overseer', 'Missionary', 'Revd', 'Worship Pastor', 'Youth Pastor', 'CEO', 'CFO',
  'COO', 'Founder', 'Realtor', 'Broker', 'Alhaji', 'Alhaja', 'Shri', 'Smt.', 'Senhor', 'Senhora', 'LtCol', 'SgtMaj', 'CPO', 'MCPO', 'Chief Petty Officer', 'Elder Dr.', 'Bishop Dr.',
  'Apostle Dr.', 'Prophetess', 'Evangelist', 'First Lady', 'Lady', 'Archdeacon', 'Prebendary', 'Sensei', 'Bhante', 'Ajahn', 'Rinpoche', 'Mawlana', 'Hafiz', 'Qari', 'Ustadh',
  'Sheikha', 'Tuan', 'Puan', 'Datuk', 'Encik', 'Tito', 'Tita', 'Lolo', 'Kuya', 'Ate', 'Tío', 'Uncle', 'Auntie', 'ADA', 'DA', 'PM', 'MP', 'MLA', 'JP', 'Hakim', 'Emir', 'Sultan',
  'Raja', 'Begum', 'Mian', 'Sardar', 'Chaudhry', 'Pandit', 'Swami', 'Guru', 'Hon. Judge', 'Superior Court Judge', 'Chief Magistrate', 'Public Defender', 'Solicitor General'];
const EITHER = { Lola: 1, Amir: 1, Malik: 1, Tia: 1 };
for (const o of [...K7, ...Object.keys(EITHER)]) for (const c of [(s) => s, upper]) {
  add(c(`${o} Jordan Ames`), '', 'Jordan', ...(EITHER[o] ? [o] : []));
  add(c(`${o} Ames`), '', ...(EITHER[o] ? [o] : []));
}
for (const o of ['Mrs. John (Amy) Ames', 'Mrs. Robert (Mary Beth) Ames', 'Mrs. Jordan Ames (Amy)', 'Mr. Jordan (Sam) Rowe']) add(o, '');

// K8: families and companies. One led by a family name: no name; a person's own business after their whole name: theirs
for (const f of ['Rowe', 'Quill', 'Mensah', 'Okafor', 'Nguyen']) {
  for (const p of [`${f} Fam`, `${f} Clan`, `${f} Crew`, `Familia ${f}`, `${f}-Family`, `${f} L.L.C.`, `${f} LP`, `${f} PC`, `${f} Law Firm`, `Law Offices of Jordan ${f}`,
    `${f} Real Estate`, `${f} Bros.`, `The ${f}s`, `${f} & Associates`, `${f} Holdings`, `${f} Family Office`, `${f} Group LLC`, `Team ${f}`, `${f} Ohana`, `Los ${f}`]) add(p, '');
  for (const p of [`Jordan ${f} LP`, `Jordan ${f} Photography`, `Amy ${f} Designs`, `Jordan ${f} Consulting`]) add(p, '', p.split(' ')[0]);
  for (const p of [`Grace ${f} Ministries`, `Hope ${f} Realty`, `Faith ${f} Foundation`, `Jordan ${f} Family`, `Amy ${f} Inc`]) add(p, '');
}
for (const p of ['Grace Fellowship Church', 'Faith Family Church', 'Hope Community Center', 'Joy Academy', 'Victory Church', 'Trinity Church']) add(p, '');

// K9: someone not named after "and": the first one's name
const K9 = ['grandkids', 'grandchildren', 'the grandkids', 'twins', 'the twins', 'in-laws', 'loved ones', 'the boys', 'the girls', 'hubs', 'the hubs', 'wifey', 'bride', 'groom',
  'fiancé', 'bf', 'gf', 'significant other', 'better half', 'my better half', 'the Mrs.', 'the missus', 'kids', 'family', 'fam', 'pets', 'the dog', 'mom', 'dad', 'son', 'daughter',
  'staff', 'colleagues', 'team', 'friends', 'guest', 'plus one', '+1', 'household', 'children', 'baby', 'step-kids', 'sweetheart', 'honey', 'my love'];
for (const w of K9) {
  add(`Jordan Rowe and ${w}`, '', 'Jordan');
  add(`Jordan & ${w}`, '', 'Jordan');
  add(`Jordan Rowe + ${w}`, '', 'Jordan');
  add(`Jordan Rowe w/ ${w}`, '', 'Jordan');
  add(J, `Jo and ${w}`, 'Jo', 'Joanna');
}

// K10: letters as the name they go by (none: their full name's)
const K10 = ['III', 'II', 'IV', 'Jr', 'Jr.', 'JR', 'Sr.', 'CPA', 'MBA', 'Esq.', 'PHD', 'PhD', 'DDS', 'MD', 'M.D.', 'RN', 'Ret.', 'USMC', 'USN', 'USAF', 'USA', 'LMHC', 'LCSW', 'PE',
  'P.E.', 'CFP', 'CFA', 'JD', 'J.D.', 'DO', 'PA', 'PA-C', 'NP', 'DNP', 'EdD', 'DMin', 'ThM', 'MDiv', 'SHRM-CP', 'PMP'];
for (const l of K10) for (const c of [(s) => s, lower]) {
  add(J, c(l), 'Joanna');
  add(J, `Jo ${c(l)}`, 'Jo', 'Joanna');
}

// K11: words around the name they go by
const K11 = ["Hi, I'm {n}", 'Hi {n}', 'Hello {n}', 'Dear {n}', 'Hey {n}', 'Mostly {n}', 'Prefers {n}', 'Usually {n}', 'Nick: {n}', 'Pref: {n}', 'Nm: {n}', 'Name - {n}', "Lil' {n}",
  'Big {n}', 'Formally Joanna, {n} to friends', '{n} to friends', '{n} (friends)', '{n}!', '{n}?', '{n} :)', '{n} 😊', 'Ms. {n}', 'Miss {n}', 'Aunt {n}', 'Coach {n}', 'Dr. {n}',
  '{n} or Joanna', 'Joanna or {n}', '{n}/Joanna', '"{n}"', '({n})', '{n}.', 'It is {n}', 'Call me {n} please'];
for (const t of K11) for (const n of ['Jo', 'Mary Beth', 'Jody']) add(J, t.replace('{n}', n), n, 'Joanna');
for (const p of ['Blank', 'Pass', 'Pending', 'Unsure', 'Surname', 'Hello', 'TBD', 'N/A', 'None', 'Same', 'Nothing', '-', '.', 'Ok', 'Yes', 'No', 'First', 'Given', 'Nickname',
  'Optional', 'Skip', 'Not applicable', 'Legal name only', 'See above', 'Prefer not to say', 'Hi', 'Dear', 'Mostly', 'Lil', 'Pref', 'Nick name']) add(J, p, 'Joanna');

// K12: two capitals as a first name (said as letters), in capitals, small letters, or as the name they go by
for (const x of ['TJ', 'AJ', 'CJ', 'DJ', 'JJ', 'JR', 'KC', 'RJ', 'BJ', 'PJ', 'JT', 'MJ', 'EJ', 'JD', 'JP', 'OJ', 'TK', 'JB', 'DT', 'LJ']) {
  add(`${x} AMES`, '', x);
  add(`${x} Ames`, '', x);
  add(lower(`${x} ames`), '', x);
  add(J, x, x, 'Joanna');
}

// K13: family name first (their given name after it), and short ways of writing a first name (none)
const K13 = [['Nguyễn Văn An', 'An'], ['Nguyen Van An', 'An'], ['Trần Thị Mai', 'Mai'], ['Tran Thi Mai', 'Mai'], ['Lê Văn Hùng', 'Hùng'], ['Phạm Minh Tuấn', 'Minh Tuấn'],
  ['Kim Min-jun', 'Min-jun'], ['Kim Ji-eun', 'Ji-eun'], ['Lee Ji-eun', 'Ji-eun'], ['Lee Min-ho', 'Min-ho'], ['Park Seo-yeon', 'Seo-yeon'], ['Choi Jae-won', 'Jae-won'],
  ['Zhang Wei', 'Wei'], ['Wang Fang', 'Fang'], ['Li Na', 'Na'], ['Liu Yang', 'Yang'], ['Chen Jing', 'Jing'], ['Huang Mei', 'Mei'], ['Kim Jordan', 'Jordan', 'Kim'], ['Lee Jordan', 'Jordan', 'Lee'],
  ['Ho Thi Lan', 'Lan'], ['Do Van Minh', 'Minh'], ['Vu Thi Hoa', 'Hoa'], ['Lim Wei Ling', 'Wei Ling'], ['Tan Mei Ling', 'Mei Ling'], ['Wong Ka Wai', 'Ka Wai'],
  ['Chan Tai Man', 'Tai Man'], ['Ma Lin', 'Lin'], ['Yu Jun', 'Jun'], ['Song Ji-ho', 'Ji-ho'], ['Jo Min-ji', 'Min-ji'], ['Mai Thi Thu', 'Thu'], ['Wei Zhang Ming', 'Zhang Ming', 'Ming']];
// (in any capitals: the checker compares the greeting with these without regard to capitals)
for (const [f, ...g] of K13) for (const c of [(s) => s, upper, lower]) add(c(f), '', ...g);
for (const a of ['Wm', 'Wm.', 'Chas', 'Chas.', 'Thos', 'Thos.', 'Robt', 'Robt.', 'Saml', 'Jno', 'Jas', 'Jas.', 'Geo', 'Geo.', 'Benj', 'Danl', 'Edw', 'Jos', 'Jos.', 'Fco', 'Fco.',
  'Ma', 'Mª', 'M.ª', 'Mª.', 'Ma.', 'Fdo', 'Hno']) for (const c of [(s) => s, upper]) {
  add(c(`${a} Ames`), '');
  add(c(`${a} Jordan Ames`), '');
}

// K14 (the coordinator, Nov 22 2026): one middle initial between the first name and the family name, with or without its
// stop, is their first name's; never two initials, never an initial first or last. In capitals, small letters, after a
// title, with letters after, and with a comma and letters
const K14_PEOPLE = [['Jordan', 'Ames'], ['Amy', 'Rowe'], ['DeShawn', 'Jackson'], ['María', 'López'], ['Chioma', 'Okafor'], ['Priya', 'Patel'], ['Mary-Kate', 'Quill']];
for (const [g, f] of K14_PEOPLE) {
  for (const i of ['A.', 'A', 'J.', 'T']) {
    for (const c of [(x) => x, upper, lower]) {
      add(c(`${g} ${i} ${f}`), '', g);
      add(c(`Dr. ${g} ${i} ${f}`), '', g);
      add(c(`${g} ${i} ${f} Jr.`), '', g);
      add(c(`${g} ${i} ${f}, PhD`), '', g);
    }
  }
  for (const n of [`${g} A. B. ${f}`, `${g} A B ${f}`, `A. ${g} ${f}`, `J. A. ${f}`, `${g} ${f} A.`, `A. B. ${f}`]) add(n, '', ...(n.startsWith(g) ? [g] : []));
  add(J, `${g} A.`, 'Joanna', g);
}
// K15 (the coordinator, Nov 22 2026): a comma at the end with only letters the file knows after it, once or twice; never
// a name, a job, a place or letters it doesn't know after the comma
const K15_LETTERS = ['PhD', 'Ph.D.', 'Ph. D.', 'Jr.', 'Jr', 'Sr.', 'III', 'MBA', 'CPA', 'MBA, CPA', 'Jr., PhD', 'PhD, MBA', 'M.D.', 'MD', 'Esq.', 'RN, BSN', 'LCSW', 'DDS', 'EdD', 'JD'];
for (const [g, f] of K14_PEOPLE) {
  for (const l of K15_LETTERS) for (const c of [(x) => x, upper, lower]) {
    add(c(`${g} ${f}, ${l}`), '', g);
    add(c(`Dr. ${g} ${f}, ${l}`), '', g);
  }
  for (const tail of ['Realtor', 'Atlanta', 'Acme Inc.', 'M.Tech', 'B.Com', 'Amy', 'Dr.', 'she/her', '']) add(`${g} ${f}, ${tail}`.replace(/, $/, ','), '', g);
  add(`${f}, ${g}, PhD`, '', g);
  add(`${f}, ${g}`, '', g);
  add(J, `${g} ${f}, PhD`, 'Joanna', g);
}

export const R20_ROWS = rows;
