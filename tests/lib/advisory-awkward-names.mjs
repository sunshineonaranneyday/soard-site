// Advisory Board round 19 (Nov 21 2026), the greeting's own awkward names (rule 11): phrases around a preferred name, titles of every kind before a whole name and
// before a family name, families and companies, people not named after "and", scripts, marks, initials, commas, short
// ways of writing a first name, letters after a name, and names that are everyday words too. Made-up people only (and a
// few public figures' names as typed). "x|y" is full name x with preferred name y; "|y" a preferred name y (full name
// Joanna Ames); anything else is read both as a full name and as a preferred name.
const N = ['Jo', 'Mary Beth', 'T.J', 'Dr. Ames'];
const SAY = ['Call me {n}', 'Please call me {n}', 'You can call me {n}', 'Everyone calls me {n}', 'My friends call me {n}', 'I go by {n}', 'I usually go by {n}', 'I prefer {n}',
  'Prefer {n}', 'Goes by {n}', 'Known as {n}', 'AKA {n}', 'a.k.a. {n}', 'Nickname: {n}', 'Nickname - {n}', 'Nickname is {n}', 'My nickname is {n}', 'Preferred: {n}', 'Preferred name: {n}',
  'My preferred name is {n}', 'My name is {n}', 'Name: {n}', "It's {n}", 'Just {n}', 'Only {n}', 'Simply {n}', '{n} please', '{n}, please', '{n} pls', '{n} is fine', '{n} is good', '{n} works',
  '{n}, thanks', '{n} thank you', '{n} for short', '{n} or Joanna', 'Either {n} or Joanna', '{n} and kids', '{n} & husband', '{n} (nickname)', '{n} (preferred)', '"{n}"'];
const phrases = SAY.flatMap((t) => N.map((n) => `|${t.replace('{n}', n)}`));
const notNames = ['Prefer not to say', 'Prefer not to answer', "I'd rather not say", 'No preferred name', 'No nickname', 'No preference', 'Not needed', 'Not necessary', 'Not applicable',
  'Either is fine', 'Either', 'Any is fine', 'Anything', 'Whatever', 'Whatever works', "Doesn't matter", 'Doesn’t matter', 'Does not matter', "Don't have one", "Don't care", 'First name',
  'First name is fine', 'My first name', 'Legal name', 'Same as legal name', 'Use my first name', 'Full name', 'Real name', 'Given name', 'Not Joanna', 'Not Jo', 'None needed',
  'N/A - use first name', 'Up to you', 'Your choice', 'Leave blank', 'Nothing', 'No thanks', 'Thanks', 'Thank you', 'Yes', 'Ok', 'Okay', 'Sure', 'Fine', 'Ditto', 'See above', 'Unknown',
  'Anonymous', 'Test', 'Testing', 'Me', 'Myself', 'Call me anything', 'Call me whatever', 'Just call me by my name', 'Please use my legal name', 'I go by my first name', 'Nickname',
  'Preferred', 'Preferred name', 'Name', 'Same as first', 'my name', 'any', 'it', 'all of the above'].map((x) => `|${x}`);
const TITLES = ['State Rep.', 'State Sen.', 'State Senator', 'State Representative', 'U.S. Rep.', 'U.S. Senator', 'US Rep', 'Rt. Hon.', 'Rt Hon', 'The Rt. Hon.', 'Most Rev.', 'The Most Rev.',
  'Very Rev.', 'The Very Rev.', 'Rt. Rev.', 'Former Mayor', 'Former Governor', 'Former State Rep.', 'Mayor Pro Tem', 'Vice Mayor', 'Deputy Mayor', 'Council Member', 'Councilmember',
  'Councilwoman', 'Councilman', 'Councilor', 'Cllr.', 'Alderman', 'Alderwoman', 'Alderperson', 'Commissioner', 'County Commissioner', 'Comm.', 'Sheriff', 'Deputy Sheriff', 'Marshal',
  'Constable', 'Trooper', 'Police Chief', 'Fire Chief', 'Chief', 'Chief Justice', 'Judge', 'Chief Judge', 'Magistrate', 'Attorney General', 'Lt. Gov.', 'Lieutenant Governor', 'Governor',
  'Senator', 'Congressman', 'Congresswoman', 'Delegate', 'Speaker', 'Majority Leader', 'President', 'Vice President', 'Ambassador', 'Consul', 'Premier', 'Provost', 'Principal',
  'Superintendent', 'Director', 'Secretary', 'General', 'Gen.', 'Brig. Gen.', 'Maj. Gen.', 'Lt. Gen.', 'Major', 'Maj.', 'Colonel', 'Col.', 'Lt. Col.', 'Lieutenant Colonel', 'Captain',
  'Capt.', 'Cpt.', 'Cmdr.', 'Commander', 'Lt. Cmdr.', 'Admiral', 'Adm.', 'Rear Adm.', 'Vice Adm.', 'Commodore', 'Sgt.', 'Sergeant', 'Staff Sgt.', 'Master Sgt.', 'Sgt. Maj.', 'Sergeant Major',
  'First Sgt.', 'Cpl.', 'Corporal', 'Lance Cpl.', 'Pvt.', 'Private', 'PFC', 'Spc.', 'Specialist', 'Ensign', 'Airman', 'Seaman', 'Petty Officer', 'Chief Petty Officer', 'Warrant Officer',
  'MSG', 'SSG', 'SFC', 'CPT', 'LTC', 'COL', 'GEN', 'BG', 'MG', 'LTG', 'CSM', 'SGM', 'Pastor', 'Senior Pastor', 'Lead Pastor', 'Associate Pastor', 'Youth Pastor', 'Co-Pastor', 'Pr.',
  'Rev.', 'Reverend', 'Rev. Dr.', 'Bishop', 'Archbishop', 'Cardinal', 'Monsignor', 'Msgr.', 'Father', 'Fr.', 'Deacon', 'Dcn.', 'Deaconess', 'Elder', 'Presiding Elder', 'Apostle', 'Prophet',
  'Prophetess', 'Evangelist', 'Minister', 'Chaplain', 'Brother', 'Br.', 'Sister', 'Mother', 'Mother Superior', 'Abbot', 'Vicar', 'Rector', 'Canon', 'Rabbi', 'Cantor', 'Imam', 'Sheikh',
  'Shaykh', 'Mufti', 'Hajji', 'Haji', 'Ustadh', 'Swami', 'Guru', 'Pandit', 'Lama', 'Venerable', 'Ven.', 'First Lady', 'Lady', 'Lord', 'Sir', 'Dame', 'Baroness', 'Countess', 'Duchess',
  'His Excellency', 'Her Excellency', 'His Honor', 'Her Honor', 'Herr', 'Frau', 'Fräulein', 'Mme', 'Mme.', 'Mlle', 'Madame', 'Monsieur', 'Señor', 'Señora', 'Señorita', 'Sr.', 'Sra.',
  'Srta.', 'Doña', 'Dña.', 'Dott.', 'Dott.ssa', 'Dr.ssa', 'Prof.ssa', 'Avv.', 'Ing.', 'Arch.', 'Arq.', 'Lic.', 'Mtro.', 'Signor', 'Signora', 'Mevr.', 'Dhr.', 'Pani', 'Smt.', 'Dr. med.',
  'Dr. rer. nat.', 'Dr. phil.', 'Prof. Dr.', 'Prof. Dr. med.', 'Dr.-Ing.', 'Dipl.-Ing.', 'Univ.-Prof.', 'Mx.', 'Ms.', 'Mrs.', 'Mr.', 'Miss', 'Mister', 'Madam', 'Master', 'Coach', 'Head Coach',
  'Chef', 'Nurse', 'Officer', 'Detective', 'Det.', 'Insp.', 'Inspector', 'Agent', 'Special Agent', 'Dr.', 'Doctor', 'Prof.', 'Professor', 'Atty.', 'Attorney', 'Hon.', 'Honorable',
  'The Honorable', 'Uncle', 'Aunt', 'Auntie', 'Pope', 'Count'];
const titled = TITLES.flatMap((t) => [`${t} Jordan Ames`, `${t} Ames`]);
const couples = ['Pastor & First Lady Ames', 'Pastor and First Lady Ames', 'Bishop & Mrs. Ames', 'Rev. & Mrs. Ames', 'Dr. & Mr. Ames', 'Judge & Mrs. Ames', 'Senator & Mrs. Ames',
  'Elder & Sister Ames', 'Apostle & Prophetess Ames', 'Mayor & First Gentleman Ames', 'Bishop & Lady Ames', 'Mr. & Mrs. Jordan Ames', 'Dr. and Mrs. Jordan Ames', 'Ames, Pastor & First Lady',
  'Ames, State Rep.', 'Ames, Council Member', 'Ames, Rt. Hon.', 'Ames, Commissioner', 'Quill, Jordan & Lady Amy'];
const orgs = ['Rowe Family', 'The Rowe Family', 'Rowe Household', 'The Rowes', 'Rowe Family Trust', 'Rowe Family Foundation', 'Rowe Foundation', 'Rowe Realty', 'Rowe Realty Group',
  'Rowe Group', 'Rowe & Co.', 'Rowe and Company', 'Rowe & Sons', 'Rowe Inc.', 'Rowe, Inc.', 'Rowe LLC', 'Rowe, LLC', 'Rowe Corp.', 'Rowe Ministries', 'Grace Church', 'First Baptist Church',
  'Rowe Team', 'Team Rowe', 'The Rowe Team', 'Rowe Partners', 'Rowe & Associates', 'Rowe Consulting', 'Rowe Properties', 'Rowe Holdings', 'Rowe Enterprises', 'Rowe Insurance Agency',
  'Rowe Construction', 'Acme Inc', 'Acme Co', 'ACME CORP', 'Jordan Rowe LLC', 'Jordan Rowe Realty', 'Jordan Rowe for Acme', 'Jordan Rowe, Rowe Realty', 'Jordan Rowe (Rowe Realty)',
  'Friends of Jordan Ames', 'Ames Family Charitable Trust', 'Rotary Club of Atlanta', 'Atlanta Chamber', 'PTA', "St. Mark's Church", 'Grace Fellowship', 'Temple Beth El', 'Rowe Design Studio',
  'Rowe Academy', 'Rowe Institute', 'Jordan Rowe Family'];
const notNamed = ['Jordan Rowe and wife', 'Jordan Rowe & wife', 'Jordan Rowe and my wife', 'Jordan Rowe and his wife', 'Jordan Rowe & husband', 'Jordan & hubby', 'Jordan Rowe and spouse',
  'Jordan Rowe & partner', 'Jordan Rowe and kids', 'Jordan Rowe & the kids', 'Jordan Rowe and children', 'Jordan Rowe & kiddos', 'Jordan Rowe and fam', 'Jordan Rowe and wife and kids',
  'Jordan Rowe, wife & kids', 'Jordan Rowe + wife', 'Jordan Rowe with wife', 'Jordan Rowe w/ wife', 'Rowe, Jordan and wife', 'Rowe, Jordan & husband', 'Dr. Jordan Rowe and wife',
  'Mr. Rowe and wife', 'Jordan and Amy Rowe and kids', 'Jordan Rowe and son', 'Jordan Rowe and daughter', 'Jordan Rowe and Partner Amy Lee', 'Jordan Rowe and friends', 'Jordan Rowe and guest',
  'Jordan Rowe plus one', 'Jordan Rowe et al', 'Jordan Rowe & Co', 'Jordan Rowe and wife, MD', 'Jordan, Amy and Sam Rowe', 'Rowe, Amy and Sam'];
const scripts = ['陈小明', '陈 小明', '山田 太郎', 'やまだ たろう', 'ヤマダ タロウ', 'ジョン・スミス', '김민준', '박 지성', 'محمد بن سلمان', 'عبد الله', 'فاطمة الزهراء', 'יוסף כהן',
  'שרה לוי', 'สมชาย ใจดี', 'नरेंद्र मोदी', 'अमिताभ बच्चन', 'சுந்தர் பிச்சை', 'გიორგი ბერიძე', 'ნინო', 'Արամ Խաչատրյան', 'Αλέξανδρος Παπαδόπουλος', 'ΑΛΈΞΑΝΔΡΟΣ ΠΑΠΑΔΌΠΟΥΛΟΣ',
  'Дмитрий Иванов', 'ДМИТРИЙ ИВАНОВ', 'Ольга', 'አበበ ቢቂላ', 'রবীন্দ্রনাথ ঠাকুর', 'ហ៊ុន សែន', 'အောင်ဆန်း', 'Nguyễn Thị Minh Khai', 'İsmail Kılıç', 'Kaʻiulani', 'ʻIolani Kahale',
  'Abd al-Rahman Ali', 'Abdul Rahman', 'Seán Ó Briain', 'Zoë Ames', 'Ñuño Pérez'];
const marks = ['Jor​dan Ames', '​Jordan Ames', 'Jordan​ Ames', 'Jo‌dan Ames', 'Jo‍dan Ames', 'Jordan﻿ Ames', '﻿Jordan Ames', 'Jor⁠dan Ames',
  'Jordan Ames​', '|Jo​', '|​Jo', '|Jo​dy', 'Gal·la Puig', 'Marcel·lí Puig', '|Gal·la', 'Jordan Ames', 'Jordan Ames', 'Jordan\tAmes', 'Jo-Ann Ames', 'Jo‐Ann Ames',
  'Jo–Ann Ames', 'Jo—Ann Ames', "D'Andre Smith", 'D’Andre Smith', 'D`Andre Smith', 'O´Brien Smith', 'Jo.Ann Ames', 'Jo. Ann Ames', 'Jordan.Ames', 'Jordan_Ames',
  'Jordan;Ames', 'Jordan:Ames', 'Jordan/Ames', 'Jordan\\Ames', 'Jordan~Ames', 'Jordan+Ames', 'Jordan=Ames', 'Jordan#Ames', 'Jordan@Ames', 'Jordan*Ames', 'Jordan!', 'Jordan?', 'Jordan...',
  'Jordan…', '¡Jordan!', '¿Jordan?', '«Jordan» Ames', '„Jordan“ Ames', '「Jordan」 Ames', '【Jordan】 Ames', '(Jordan)', '[Jordan]',
  '{Jordan}', '<Jordan>', '"Jordan" Ames', "'Jordan' Ames", '*Jordan* Ames', '_Jordan_ Ames', '~Jordan~ Ames', 'Jordan \u{1F33B} Ames', '\u{1F33B}Jordan Ames', 'Jordan\u{1F33B} Ames',
  'Jordan Ames \u{1F44B}', 'Ｊｏｒｄａｎ Ａｍｅｓ', '\u{1D409}\u{1D428}\u{1D42B}\u{1D41D}\u{1D41A}\u{1D427} Ames', 'Jordan.', 'Jordan Ames.', 'Ames, Jordan.'];
const initials = ['T.J', 'T.J.', 'TJ', 'T. J.', 'T J', 't.j', 'tj', 'A.J Smith', 'C.J Ames', 'D.J Ames', 'J.R Ames', 'K.C Ames', 'J.R.R Tolkien', 'J.R.R. Tolkien', 'J. R. R. Tolkien',
  'e.e. cummings', 'E.E. Cummings', 'J Ames', 'J. Ames', 'J.', 'J', 'M.J. O’Neil', "T.J.O'Brien", "T.J O'Brien", 'Ames, T.J', 'Ames, T. J.', 'Dr. T.J Ames', 'Mrs. A.J Smith', 'N.A', 'n.a',
  'N/A', 'N.A.', '|T.J', '|A.J', '|C.J', '|D.J', '|J.R', '|K.C', '|K.C.', '|t.j'];
const commas = ['Ames , Jordan', 'Ames ,Jordan', 'Ames,Jordan', 'Ames  ,  Jordan', 'Ames , Dr.', 'Ames , Mrs.', 'Ames , Jordan , MD', 'Ames, Jordan ,PhD', 'Ames , Jordan & Amy',
  'AMES , JORDAN', 'ames , jordan', 'Van Dyke , Dr.', 'De La Cruz , Maria', 'Ames , J.', 'Jordan Ames , MD', 'Jordan Ames ,MBA', 'Quill , Mr. & Mrs.', 'Jordan,Ames', '|Ames, Jordan',
  '|Ames , Jordan', '|Quill, Jordan & Amy', '|Van Dyke, Dr.', "|O'Brien, T.J.", '|Jo, she/her', '|Jo, PhD', '|Jo, Joanna', '|N/A, Jordan', '|Joanna, but Jo is fine'];
const abbr = ['Ma. Teresa Cruz', 'Ma. Cristina Santos', 'Ma. Luisa', 'MA. TERESA CRUZ', 'ma. teresa cruz', 'Cruz, Ma. Teresa', 'Dr. Ma. Teresa Cruz', 'Ma Teresa Cruz', 'Wm. Ames',
  'Wm. Jordan Ames', 'Jas. Ames', 'Chas. Ames', 'Thos. Jefferson', 'Geo. Washington', 'Robt. Ames', 'Jno. Ames', 'Benj. Franklin', 'Saml. Adams', 'Ames, Wm.', 'Ames, Ma. Teresa',
  '|Ma. Teresa', '|Wm.', '|Wm', '|Chas.', 'Ed. Ames', 'Jo. Ames', 'Cmdr. Ames', 'Xyz. Jordan Ames'];
const letters = ['Dr. Quill FACC', 'Dr. Quill FACC, FACP', 'Mrs. Quill LMHC', 'Mrs. Quill MAT', 'Rev. Quill ThM', 'Rev. Quill DMin', 'Dr. Quill DrPH', 'Mrs Quill Ph D', 'Mrs Quill M D',
  'Dr. Quill Ed D', 'Dr. Quill Psy D', 'Mr. & Mrs. Quill LMHC', 'Jordan Ames LMHC', 'Jordan Ames, LMHC', 'Jordan Ames LPCC', 'Jordan Ames NCC', 'Jordan Ames CHt', 'Jean DUPONT', 'Marie CURIE',
  'Dr. Marie CURIE', 'Mr. & Mrs. John SMITH', 'DR. QUILL FACC', 'Dr. QUILL FACC', 'Bishop Quill FACC', 'Mrs. Quill Facc', 'Dr. Jordan Ames FACC', 'Jordan Ames M D'];
const everyday = ['Rick Husband', 'Julia Child', 'Christopher Guest', 'Edith Head', 'Larry Fine', 'Meagan Good', 'Thomas Say', 'Johann Most', 'Ward Just', 'Brandon Call', 'Bong Go',
  'Or Cohen', 'Go Nagai', 'Will Smith', 'Grace Jones', 'Hope Solo', 'Christian Bale', 'Nick Jonas', 'Do Kwon', 'Al Gore', 'Ty Burrell', 'Major Harris', 'Dean Martin', 'Earl Thomas',
  'Prince Fielder', 'King Camp Gillette', 'Duke Ellington', 'Don Draper', 'Don Michael Smith', 'Don José García', 'Major Lee Harris', 'Justice Smith', 'Lady Bird Johnson', 'Bishop Briggs',
  'Coach K', 'Charlotte Church', 'Shirley Temple', 'Mr. Jordan', 'Jordan', 'JORDAN', 'jordan', 'J0rdan', 'Jordan2 Ames', '123', 'Jordan Ames Jr.', 'Jordan Ames III', 'Jordan Ames, Esq.',
  'I go by Jo', 'Call me Jo', 'Prefer Not To Say', 'Not Applicable', 'First Last', 'Jordan Rowe on behalf of Acme', 'Jordan Rowe c/o Amy'];
// (the lead's decisions on round 19's open points, Nov 21 2026: capitals after a title, "Ma" alone, dashes between letters,
// everyday words typed in small letters)
const decided = ['Dr. Marie CURIE', 'Mr. & Mrs. John SMITH', 'DR. QUILL FACC', 'MRS. QUILL LMHC', 'Dr. JORDAN AMES', 'DR. JORDAN AMES', 'Dr. Jordan AMES', 'Dr. JACK MA',
  'Mrs. QUILL MBA', 'MRS. QUILL PhD', 'Dr. Jordan ABERNATHY', 'Dr. JORDAN LEE AMES', 'Prof. Jean DUPONT', 'Mme Marie CURIE', 'Rev. Jo ANN', 'Ma Teresa Cruz', 'Ma Long', '|Ma',
  'Jo\u2013Ann Ames', 'Jo\u2014Ann Ames', '|Jo\u2013Ann', '|Jo\u2014Ann', 'jo\u2013ann ames', 'Ames, Jo\u2014Ann', 'Mary\u2013Kate Olsen', '|Jo \u2014 Joanna', 'only "new" fits',
  's own box isn', 'new ames', '|new', '|just jo', '|good morning', 'the best', 'my name here', '|call me later', 'jordan ames', 'will smith', 'grace jones', '|mary beth'];
export const AWKWARD = [...decided, ...phrases, ...notNames, ...titled, ...couples, ...orgs, ...notNamed, ...scripts, ...marks, ...initials, ...commas, ...abbr, ...letters, ...everyday];
