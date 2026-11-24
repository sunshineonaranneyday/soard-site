/**
 * Advisory Board QA round 26 (Nov 24 2026): how the public application reads a name, findings 1 to 3 of the round 26
 * public tester (test-results/qa26-public: e02, e03, p02 26a/26e/26g, a03, a04, n10). The greeting greets only on positive
 * evidence: a missed name is fine, a wrong one is the finding. Add to Advisory Board's web address, its People's name and its
 * "Is this ...?" question take the name's own words only, never a place, a company, a job or the military, and the same
 * person is offered whatever is typed around their name. Made-up people only (the repo is public).
 * (Read through the modules' namespaces, so on the code before round 26 each test fails on its own.)
 * Run: node --test tests/advisory-round26-names.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import * as F from '../functions/api/_advisory-form.js';
import * as G from '../functions/api/_given-names.js';
import { applicantEmail, readHeadshot, submitApplication } from '../functions/api/_advisory-applications.js';
import { slugOf } from '../public/admin/team-shared.js';
import { createD1 } from './lib/d1-shim.mjs';
import { R26_COUNTRY_FORMS, R26_DECIDED } from './lib/advisory-r26-places.mjs';

// Each row: [full name, preferred name, the greeting]; the applicant's copy's first line says the same
const say = (rows) => {
  const bad = [];
  for (const [fullName, preferredName, want] of rows) {
    const got = F.greetName({ fullName, preferredName });
    const copy = applicantEmail({ answers: { fullName, preferredName }, headshot: null }).text.split('\n')[0];
    if (got !== want || copy !== (want ? `Thank you, ${want}.` : 'Thank you.')) bad.push(`${fullName}|${preferredName} → ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
  assert.deepEqual(bad, []);
};
const addressOf = (n) => { const r = F.readName(n); return slugOf((r.address || r.words).join(' ')); };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ─── Finding 1: a given name written in parts after a family name some people write first ──

test('finding 1 (the root): after a Korean or Chinese family name, two words that are each a syllable of that people\'s given names are their given name written in parts, never evidence for a greeting, whatever list the last is on; the particle reading and the middle-word check never take them', () => {
  assert.equal(typeof G.givenInParts, 'function', 'a given name written in parts (round 26)');
  say([
    // (the tester's rows, on the page and through the handler)
    ['Ann Da Young', '', ''], ['Ann Bo Young', '', ''], ['Seung Da Bin', '', ''], ['Ann Da Young', 'Ann', ''], ['Ann Bo Young', 'Ann', ''],
    ['Ann Da Mi', '', ''], ['Ann Da Bin', '', ''], ['Ann Da Yun', '', ''], ['Ann Da Som', '', ''], ['Joe Da Young', '', ''], ['Joe Bo Young', '', ''],
    ['Seung Bo Young', '', ''], ['Ann Yun Young', '', ''], ['Ann Moon Young', '', ''], ['Ann Nam Young', '', ''], ['Dr. Ann Da Young', '', ''],
    ['ANN DA YOUNG', '', ''], ['ann da young', '', ''], ['Yong Da Young', '', ''], ['Joe Woo Young', '', ''],
    // (hyphenated and joined, as round 25 had them)
    ['Ann Da-young', '', ''], ['Ann Dayoung', '', ''], ['Ann Bo-young', '', ''],
    // (Chinese, in each romanization, after a family name the lists mark for it)
    ['Kai Jin Long', '', ''], ['Ming Mei Lee', '', ''], ['Soo May Lee', '', ''], ['Tung Jin Long', '', ''], ['Yong Kim Lee', '', ''], ['Jan De Long', '', ''],
    // (still greeted: a family name of a people who write it last, a family name in parts, a middle name, a pair)
    ['Ann Smith', '', 'Ann'], ['Juan Luna', '', 'Juan'], ['Sam David Johnson', '', 'Sam'], ['Juan Dela Cruz', '', 'Juan'], ['Jan de Vries', '', 'Jan'],
    ['Sam Lee', '', 'Sam'], ['Ann Lee', '', 'Ann'], ['Ann Smith', 'Ann', 'Ann'], ['Juan Carlos', '', 'Juan'], ['Thanh Huong Ames', '', 'Thanh Huong'],
    ['Pat Lee Smith', '', 'Pat'], ['Jan Lee Smith', '', 'Jan'], ['Juan Lopez Garcia', '', 'Juan'], ['Simon Smith', '', 'Simon'],
  ]);
});

test('finding 1: no pair of Korean given-name syllables is greeted written as two words after Ann, Joe, Seung or Yong (the tester\'s 8,100 pairs), nor any of the common Korean and Chinese given names written so', () => {
  const K = `ji mi hye eun soo su na da ha seo yoo ah jae hee min sun jin kyung bo so ye yu yun jung sung hyun young jun joon woo ho seok
    hoon jong chul dong sang tae kwang hwan hyuk won gun il man nam moon han kang hong song lee yeon sook ja ok hwa ae rim ran ra rin bin
    bae chan chang hyo in kyu mo myung rae seung shin sik soon suk tak un wook yong yeong kyoung gyeong byung doo duk gil hak hae`.split(/\s+/).filter(Boolean);
  const greeted = [];
  for (const f of ['Ann', 'Joe', 'Seung', 'Yong']) for (const a of K) for (const b of K) {
    const n = `${f} ${cap(a)} ${cap(b)}`;
    if (F.greetName({ fullName: n })) greeted.push(n);
  }
  assert.deepEqual(greeted.slice(0, 20), [], `${greeted.length} of ${4 * K.length * K.length} greeted`);
  const KOREAN = `Bo-young Da-young Da-mi Da-bin Da-yun Da-som Da-hye Da-eun Da-hyun Da-jung Da-in Da-yeon Da-ae Da-un Ji-young Mi-young
    Hye-young Eun-young Soo-young Na-young Ha-young Seo-young Yoo-young Ah-young Jae-young Hee-young Min-young Sun-young Jin-young Yun-young
    Yoon-young Moon-young Nam-young Kyung-young Bo-ra Bo-ram Bo-mi Bo-kyung Bo-reum Bo-na Bo-eun Bo-hyun Bo-gum Young-ho Young-jin Young-hee
    Young-mi Young-soo Young-min Young-sook Young-ja Young-ae Young-nam Young-sun Young-il Young-kwang Moon-hee Moon-sik Moon-soo Hong-jin
    Kang-min Kang-in Yu-na Yu-jin Yu-ri Yu-mi Yun-ah Yun-hee Yun-seo Nam-joon Nam-gil Nam-hee Lee-young Jung-ho Sung-ho Min-ho Jun-ho
    Seung-ho Ji-ho Woo-young Song-hee Ha-neul Ye-jin Ye-eun So-yeon So-young So-hee Hyo-jin`.split(/\s+/).filter(Boolean);
  const CHINESE = `Mei-lee Siew-lee Lee-lee Kim-lee Bee-lee Ai-lee Su-lee Pei-lee Hui-lee Lee-ling Lee-hoon Lee-chin Lee-mei Wing-lee Man-lee
    Ka-lee Wai-lee Yuk-lee Ka-man Ka-wing Ka-ho Ka-yan Wai-man Wai-king Man-king Man-ho Wing-ho Chi-wing Kin-wing Siu-ming Kwok-wing Ho-yin
    Chun-kit Tsz-ching Hoi-yan Mei-king Yuk-king Sau-king Bo-lee Jin-long Xiao-long Jian-long Cheng-long Zi-long Hai-long Tian-long Da-wei
    Da-ming Da-peng Da-gang Da-long Da-hai De-hua De-sheng De-ming De-gang De-quan De-fu De-xin De-long Le-le Lo-ming Kim-seng Kim-hock
    Kim-leng Kim-moon Moon-lee Ah-moon Ah-lee May-lee Lee-may Ching-may Ming-king Kim-may Hong-lee Jin-hong Kang-lee`.split(/\s+/).filter(Boolean);
  const two = (n) => n.split('-').map(cap).join(' ');
  const bad = [];
  for (const n of KOREAN) for (const f of ['Ann', 'Joe', 'Seung', 'Yong']) for (const w of [two(n), n, cap(n.replace('-', ''))]) if (F.greetName({ fullName: `${f} ${w}` })) bad.push(`${f} ${w}`);
  for (const n of CHINESE) for (const f of ['Yong', 'Soo', 'Tung', 'Tien', 'Sam', 'Pat', 'Kat', 'Kei', 'Pao', 'Ming', 'Kai', 'Bo', 'Ying', 'Shan', 'Jan', 'Juan', 'Hai']) {
    if (F.greetName({ fullName: `${f} ${two(n)}` })) bad.push(`${f} ${two(n)}`);
  }
  assert.deepEqual(bad, []);
});

test('finding 1: a syllable that\'s a degree\'s letters too, written as a name is, is read as the given name\'s part: "Ann Young Ra" is Young-ra of the Ann family; "Ann Young RA" and "Ann Young, RA" are Ann with letters', () => {
  say([['Ann Young Ra', '', ''], ['Ann Moon Ra', '', ''], ['Seung Hoon Ra', '', ''], ['Ann Young Ra', 'Ann', ''], ['Ann Young RA', '', 'Ann'],
    ['Ann Young, RA', '', 'Ann'], ['Sam Lee MD', '', 'Sam'], ['Jordan Ames MD', '', 'Jordan'], ['Jordan Ames Ma', '', 'Jordan']]);
  assert.ok(G.givenInParts(['Ann', 'Young', 'Ra']));
  assert.ok(!G.givenInParts(['Ann', 'Smith', 'Ra']));
});

// ─── Finding 2: an organization or an official country name is read whole from its first word ──

const ORGS = ['United Way of Greater Atlanta', 'Metro Atlanta Chamber of Commerce', 'Medical College of Georgia', 'Federal Bureau of Investigation',
  'Superior Court of Fulton County', 'Islamic Republic of Iran', 'Federal Republic of Germany', 'United Republic of Tanzania', 'YMCA of Metro Atlanta',
  'Hashemite Kingdom of Jordan', 'Habitat for Humanity', 'Boys & Girls Clubs of Metro Atlanta', 'Girl Scouts of Greater Atlanta',
  'Technical College System of Georgia', 'Housing Authority of Fulton County', 'Consulate General of Mexico', 'Community Foundation for Greater Atlanta',
  'Centers for Disease Control and Prevention', 'Big Brothers Big Sisters of Metro Atlanta', 'Administration for Children and Families',
  'Center for Civil and Human Rights', 'Grand Duchy of Luxembourg', 'Plurinational State of Bolivia', 'Co-operative Republic of Guyana',
  'Banco de México', 'Ciudad de Atlanta', 'Consulado de México', 'Iglesia de Dios', 'Agencia de Viajes', 'Cámara de Comercio',
  'Agencia Hispana de Seguros', 'Constructora del Sur', 'Restaurante El Rey', 'S.A. de C.V.', 'The United Way of Greater Atlanta'];

test('finding 2: an organization or an official country name is read whole from its first word, its words before the head that are no given or family name on the lists among it, "for" as "of", a Spanish one by its head before "de" or "del": in both orders the address is the name\'s alone, People\'s name the name in natural order or as typed, never a mix', () => {
  const bad = [];
  for (const o of ORGS) {
    const a = `Jordan Ames ${o}`;
    const b = `Ames, Jordan ${o}`;
    const got = [addressOf(a), F.readName(a).shown, addressOf(b), F.readName(b).shown, F.greetName({ fullName: `Hope ${o}` })];
    const want = ['jordan-ames', a, 'jordan-ames', 'Jordan Ames', ''];
    if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${o}: ${JSON.stringify(got)}`);
  }
  assert.deepEqual(bad, []);
  // (a Spanish name with "de" stays a name; what the code doesn't know stops the organization and the name keeps it, as before)
  for (const [n, address] of [['Juan de la Cruz', 'juan-de-la-cruz'], ['María de los Ángeles', 'maria-de-los-angeles'], ['Maria de los Angeles Garcia', 'maria-de-los-angeles-garcia'],
    ['Jordan Ames Grace Church of God', 'jordan-ames-grace'], ['Jordan Lee Qorvath Church of God', 'jordan-lee-qorvath'], ['Jordan Ames City of Atlanta', 'jordan-ames'],
    ['Jordan Ames Church of God', 'jordan-ames'], ['Jordan Ames of Atlanta', 'jordan-ames'], ['Jordan Ames for Congress', 'jordan-ames']]) {
    assert.equal(addressOf(n), address, n);
  }
  // (after a comma alone, an organization is never a first name: as typed, at the family name's address)
  for (const o of ['Habitat for Humanity', 'Banco de México', 'Metro Atlanta Chamber of Commerce', 'Administration for Children and Families', 'S.A. de C.V.']) {
    const n = `Ames, ${o}`;
    assert.deepEqual([addressOf(n), F.readName(n).shown], ['ames', n], n);
  }
});

// A made-up applicant world for Add: each application stored as the public form stores it, then planned by the real admin
async function addWorld() {
  const jpg = new Uint8Array(await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#c4aa8c' } }).jpeg().toBuffer());
  const shot = (await readHeadshot(new File([jpg], 'h.jpg', { type: 'image/jpeg' }))).headshot;
  const adminApi = await import('../functions/api/advisory-applications-admin.js');
  const env = { DB: await createD1(), CF_ACCOUNT_ID: 'acct', CF_IMAGES_TOKEN: 't', RESEND_API_KEY: 'r' };
  await env.DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)');
  const BASE = { phone: '(770) 555-0142', heardFrom: 'A friend', why: 'To help.', connection: 'Neighbors.', involved: 'No', strengths: 'Events.', fundraising: 'A match.',
    introductions: 'Yes', networks: 'No', conflict: 'No', hostEvent: 'No', meetings: 'Yes', ambassador: 'Yes', refName: 'Sam Lee', refRelationship: 'Former manager', refEmail: 'sam@example.org', acknowledge: true };
  let k = 0;
  const applied = async (fullName) => (await submitApplication(env, { ...BASE, fullName, email: `r26n.${++k}@example.org`, signature: fullName }, { headshot: shot })).app;
  const ctx = (method, body, query = '') => ({ env, request: new Request(`https://site.test/api/advisory-applications-admin${query}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), data: { userEmail: 'linzi@soardcharity.com' }, waitUntil: () => {} });
  const plan = async (id) => (await (await adminApi.onRequestGet(ctx('GET', undefined, `?plan=${id}`))).json()).plan;
  const addNew = async (app) => { const p = await plan(app.id); const r = await (await adminApi.onRequestPost(ctx('POST', { add: { id: app.id, as: 'new', seen: p.key } }))).json(); assert.equal(r.success, true, r.error); return p; };
  return { applied, plan, addNew };
}
const withFakes = async (fn) => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.pathname.includes('/images/v1') && init.method === 'POST') { const id = init.body.get('id'); return Response.json({ success: true, result: { id, variants: [`https://imagedelivery.net/x/${id}/public`] } }); }
    if (url.host === 'api.resend.com') { const b = [JSON.parse(init.body)].flat(); return Response.json({ data: b.map((_, i) => ({ id: `e${i}` })) }); }
    throw new Error(`no route for ${url.href}`);
  };
  try { await fn(); } finally { globalThis.fetch = realFetch; }
};

test('findings 2 and 3: through Add, "Is this Jordan Ames?" is asked at jordan-ames-2 whatever organization, country or military is typed after the name, in both orders; People\'s name as typed without a comma, "Jordan Ames" with one; "Ames, X" alone is new at ames, as typed', () => withFakes(async () => {
  const w = await addWorld();
  const a = await w.addNew(await w.applied('Jordan Ames'));
  assert.deepEqual([a.kind, a.slug], ['new', 'jordan-ames']);
  const rows = [
    ...['United Way of Greater Atlanta', 'Metro Atlanta Chamber of Commerce', 'Medical College of Georgia', 'Federal Bureau of Investigation', 'Superior Court of Fulton County',
      'Islamic Republic of Iran', 'Federal Republic of Germany', 'United Republic of Tanzania', 'Banco de México', 'Ciudad de Atlanta', 'Consulado de México', 'Iglesia de Dios',
      'Agencia de Viajes', 'Cámara de Comercio', 'French Republic', 'Hellenic Republic', 'Bosnia-Herzegovina', 'St. Maarten', 'Saint Helena', 'Belgique', 'US Naval Reserve',
      'USNR', 'USSF', 'Georgia Guard', 'US Army Ret.', 'USMC Ret.'].map((o) => [`Jordan Ames ${o}`, null]),
    ...['United Way of Greater Atlanta', 'Metro Atlanta Chamber of Commerce', 'YMCA of Metro Atlanta', 'Superior Court of Fulton County', 'Hashemite Kingdom of Jordan',
      'Habitat for Humanity', 'Banco de México', 'Ciudad de Atlanta', 'Consulado de México', 'Cámara de Comercio', 'Iglesia de Dios', 'French Republic', 'Algérie',
      'US Naval Reserve', 'Georgia Guard', 'USN Ret.'].map((o) => [`Ames, Jordan ${o}`, 'Jordan Ames']),
  ];
  const bad = [];
  for (const [second, asName] of rows) {
    const b = await w.plan((await w.applied(second)).id);
    const got = [b.kind, b.person?.slug, b.slug, b.asName || null];
    if (JSON.stringify(got) !== JSON.stringify(['choose', 'jordan-ames', 'jordan-ames-2', asName])) bad.push(`${second}: ${JSON.stringify(got)}`);
  }
  for (const n of ['Ames, Hellenic Republic', 'Ames, Belgique', 'Ames, US Naval Reserve', 'Ames, Habitat for Humanity']) {
    const b = await w.plan((await w.applied(n)).id);
    if (JSON.stringify([b.kind, b.slug, b.asName || null]) !== JSON.stringify(['new', 'ames', null])) bad.push(`${n}: ${JSON.stringify([b.kind, b.slug, b.asName || null])}`);
  }
  assert.deepEqual(bad, []);
}));

// ─── Finding 3: the lists complete by rule ──

// Every UN member state's and observer state's English official name, written here apart from the code's table
const UN_OFFICIAL = `Islamic Republic of Afghanistan|Republic of Albania|People's Democratic Republic of Algeria|Principality of Andorra|Republic of Angola|
  Antigua and Barbuda|Argentine Republic|Republic of Armenia|Commonwealth of Australia|Republic of Austria|Republic of Azerbaijan|Commonwealth of The Bahamas|
  Kingdom of Bahrain|People's Republic of Bangladesh|Barbados|Republic of Belarus|Kingdom of Belgium|Belize|Republic of Benin|Kingdom of Bhutan|
  Plurinational State of Bolivia|Bosnia and Herzegovina|Republic of Botswana|Federative Republic of Brazil|Brunei Darussalam|Republic of Bulgaria|Burkina Faso|
  Republic of Burundi|Republic of Cabo Verde|Kingdom of Cambodia|Republic of Cameroon|Canada|Central African Republic|Republic of Chad|Republic of Chile|
  People's Republic of China|Republic of Colombia|Union of the Comoros|Republic of the Congo|Republic of Costa Rica|Republic of Côte d'Ivoire|Republic of Croatia|
  Republic of Cuba|Republic of Cyprus|Czech Republic|Democratic People's Republic of Korea|Democratic Republic of the Congo|Kingdom of Denmark|Republic of Djibouti|
  Commonwealth of Dominica|Dominican Republic|Republic of Ecuador|Arab Republic of Egypt|Republic of El Salvador|Republic of Equatorial Guinea|State of Eritrea|
  Republic of Estonia|Kingdom of Eswatini|Federal Democratic Republic of Ethiopia|Republic of Fiji|Republic of Finland|French Republic|Gabonese Republic|
  Republic of The Gambia|Georgia|Federal Republic of Germany|Republic of Ghana|Hellenic Republic|Grenada|Republic of Guatemala|Republic of Guinea|
  Republic of Guinea-Bissau|Co-operative Republic of Guyana|Republic of Haiti|Republic of Honduras|Hungary|Republic of Iceland|Republic of India|
  Republic of Indonesia|Islamic Republic of Iran|Republic of Iraq|Ireland|State of Israel|Italian Republic|Jamaica|Japan|Hashemite Kingdom of Jordan|
  Republic of Kazakhstan|Republic of Kenya|Republic of Kiribati|State of Kuwait|Kyrgyz Republic|Lao People's Democratic Republic|Republic of Latvia|
  Lebanese Republic|Kingdom of Lesotho|Republic of Liberia|State of Libya|Principality of Liechtenstein|Republic of Lithuania|Grand Duchy of Luxembourg|
  Republic of Madagascar|Republic of Malawi|Malaysia|Republic of Maldives|Republic of Mali|Republic of Malta|Republic of the Marshall Islands|
  Islamic Republic of Mauritania|Republic of Mauritius|United Mexican States|Federated States of Micronesia|Principality of Monaco|Mongolia|Montenegro|
  Kingdom of Morocco|Republic of Mozambique|Republic of the Union of Myanmar|Republic of Namibia|Republic of Nauru|Federal Democratic Republic of Nepal|
  Kingdom of the Netherlands|New Zealand|Republic of Nicaragua|Republic of the Niger|Federal Republic of Nigeria|Republic of North Macedonia|Kingdom of Norway|
  Sultanate of Oman|Islamic Republic of Pakistan|Republic of Palau|Republic of Panama|Independent State of Papua New Guinea|Republic of Paraguay|Republic of Peru|
  Republic of the Philippines|Republic of Poland|Portuguese Republic|State of Qatar|Republic of Korea|Republic of Moldova|Romania|Russian Federation|
  Republic of Rwanda|Saint Kitts and Nevis|Saint Lucia|Saint Vincent and the Grenadines|Independent State of Samoa|Republic of San Marino|
  Democratic Republic of São Tomé and Príncipe|Kingdom of Saudi Arabia|Republic of Senegal|Republic of Serbia|Republic of Seychelles|Republic of Sierra Leone|
  Republic of Singapore|Slovak Republic|Republic of Slovenia|Solomon Islands|Federal Republic of Somalia|Republic of South Africa|Republic of South Sudan|
  Kingdom of Spain|Democratic Socialist Republic of Sri Lanka|Republic of the Sudan|Republic of Suriname|Kingdom of Sweden|Swiss Confederation|
  Syrian Arab Republic|Republic of Tajikistan|Kingdom of Thailand|Democratic Republic of Timor-Leste|Togolese Republic|Kingdom of Tonga|
  Republic of Trinidad and Tobago|Tunisian Republic|Republic of Türkiye|Turkmenistan|Tuvalu|Republic of Uganda|Ukraine|United Arab Emirates|
  United Kingdom of Great Britain and Northern Ireland|United Republic of Tanzania|United States of America|Oriental Republic of Uruguay|
  Republic of Uzbekistan|Republic of Vanuatu|Bolivarian Republic of Venezuela|Socialist Republic of Viet Nam|Republic of Yemen|Republic of Zambia|
  Republic of Zimbabwe|Holy See|State of Palestine`.split('|').map((c) => c.trim()).filter(Boolean);
// (a form as the lists key it: "&" is "and"; "The" before one is read by rule, so a form is known without it too)
const keyOf = (c) => c.split(/\s+/).map((w) => (w === '&' ? 'and' : G.nameKey(w).replace(/[^\p{L}\p{N}]+/gu, ''))).filter(Boolean).join(' ');
const known = () => {
  const L = F.placeLists();
  const all = new Set([...L.anywhere, ...L.named, ...L.never, ...L.phrases]);
  return { has: (k) => all.has(k) || (k.startsWith('the ') && all.has(k.slice(4))) };
};
const NAMED = new Set(R26_DECIDED.map((d) => keyOf(d)));

test('finding 3: every UN member and observer state\'s English official name is known and read whole: never greeted after a given name, never in Add\'s address or People\'s name', () => {
  assert.equal(UN_OFFICIAL.length, 195, 'the 193 members and 2 observers');
  const K = known();
  assert.deepEqual(UN_OFFICIAL.filter((c) => !K.has(keyOf(c)) && !NAMED.has(keyOf(c))), [], 'an official name the lists don\'t know');
  const bad = [];
  for (const c of UN_OFFICIAL.filter((x) => !NAMED.has(keyOf(x)))) {
    const got = [F.greetName({ fullName: `Hope ${c}` }), addressOf(`Jordan Ames ${c}`), addressOf(`Ames, Jordan ${c}`), F.readName(`Ames, Jordan ${c}`).shown];
    if (JSON.stringify(got) !== JSON.stringify(['', 'jordan-ames', 'jordan-ames', 'Jordan Ames'])) bad.push(`${c}: ${JSON.stringify(got)}`);
  }
  assert.deepEqual(bad, []);
});

test('finding 3: every one of the round 26 tester\'s 597 country and territory forms is known, and read whole on every path but the decided ones (the countries that are names, Georgia\'s rule; plain "Island")', () => {
  assert.equal(R26_COUNTRY_FORMS.length, 597);
  const K = known();
  assert.deepEqual(R26_COUNTRY_FORMS.filter((c) => !K.has(keyOf(c)) && !NAMED.has(keyOf(c))), [], 'a form the lists don\'t know');
  const bad = [];
  for (const c of R26_COUNTRY_FORMS.filter((x) => !NAMED.has(keyOf(x)) || x === 'Ísland')) {
    const got = [F.greetName({ fullName: `Jordan ${c}` }), F.greetName({ fullName: `Hope ${c}` }), addressOf(`Jordan Ames ${c}`), addressOf(`Ames, Jordan ${c}`), F.readName(`Ames, Jordan ${c}`).shown];
    if (JSON.stringify(got) !== JSON.stringify(['', '', 'jordan-ames', 'jordan-ames', 'Jordan Ames'])) bad.push(`${c}: ${JSON.stringify(got)}`);
  }
  assert.deepEqual(bad, []);
  // (the decided: "Grace Jordan", "Ann England" and "Chad Smith" are people; "Island" is an everyday word, "Ísland" Iceland)
  say([['Grace Jordan', '', 'Grace'], ['Ann England', '', 'Ann'], ['Chad Smith', '', 'Chad'], ['Kate Holland', '', 'Kate']]);
  assert.equal(addressOf('Jordan Ames Island'), 'jordan-ames-island');
  assert.equal(addressOf('Jordan Ames Ísland'), 'jordan-ames');
});

test('finding 3: by rule, "St." for every "Saint" and "Sint" place, hyphenated and spaced forms, the older names and the letters; no new form is a common family name of a people who write it last', () => {
  const K = known();
  const forms = ['St. Maarten', 'St Maarten', 'Saint Maarten', 'St. Barts', 'St. Barths', 'Saint Barthélemy', 'St. Barthélemy', 'St. Helena', 'Saint Helena',
    'Federation of St. Kitts and Nevis', 'Bosnia-Herzegovina', 'Bosnia Herzegovina', 'Congo-Brazzaville', 'Congo Brazzaville', 'Congo-Kinshasa', 'Guinea-Conakry',
    'Guinea Conakry', 'Guiné Bissau', 'Persia', 'Byelorussia', 'Kirghizia', 'Siam', 'Burma', 'Ceylon', 'Zaire', 'Rhodesia', 'Formosa', 'Dahomey', 'Upper Volta',
    'CAR', 'DPRK', 'PNG', 'KSA', 'RSA', 'BVI', 'UAE', 'DRC', 'ROK', 'USVI', 'CNMI', 'TCI', 'HKSAR', 'Hong Kong SAR', 'Mainland China', 'The Falklands', 'Grand Cayman',
    'Lao PDR', 'West Bank', 'Gaza', 'Saipan', 'Faroes', 'Niue', 'Surinam', 'Kalaallit Nunaat', 'Aotearoa', 'Bharat', 'Nippon', 'Misr', 'Hellas', 'Suomi', 'Sverige'];
  assert.deepEqual(forms.filter((c) => !K.has(keyOf(c))), []);
  for (const c of forms) assert.equal(addressOf(`Jordan Ames ${c}`), 'jordan-ames', c);
  // (never a place anywhere: a round 26 word that's a given name on the lists or a common family name of a people who write
  // it last, SURNAMES'; the build leaves out the first, this checks the second, so the first name read never waits on it)
  const common = new Set(G.markedNames().commonFamilyNames.map(G.nameKey));
  const L = F.placeLists();
  assert.ok(Array.isArray(L.round26) && L.round26.length >= 400, 'the round 26 words that count anywhere');
  assert.deepEqual(L.round26.filter((w) => common.has(w) || G.onTheLists(w)), [], 'a round 26 word that\'s a given or family name on the lists');
  assert.deepEqual((L.orgWords || []).filter((w) => common.has(w) || G.onTheLists(w)), [], 'a word before an organization\'s head that\'s a name');
});

test('finding 3: the US military whole: "Ret.", "(Ret.)" and "Retired" after any branch or its letters; the Naval Reserve; the Navy SEALs, the Merchant Marine, the Public Health Service and the NOAA Corps; every branch\'s and Reserve\'s letters; every state\'s Guard and its short forms; "Bodega"', () => {
  const tails = ['US Army Ret.', 'US Army (Ret.)', 'US Army Retired', 'USN Ret.', 'USAF Ret.', 'USMC Ret.', 'USMC (Ret)', 'USCG Retired', 'USSF Ret.', 'U.S. Navy Ret.',
    'US Naval Reserve', 'U.S. Naval Reserve', 'The US Naval Reserve', 'Naval Reserve', 'Navy SEALs', 'US Navy SEALs', 'Merchant Marine', 'US Merchant Marine',
    'Public Health Service', 'US Public Health Service', 'NOAA Corps', 'USSF', 'USNR', 'USAR', 'USAFR', 'USMCR', 'USCGR', 'ARNG', 'ANG', 'USPHS',
    'Georgia Guard', 'Ga. National Guard', 'Ga. Army National Guard', 'Ga. Air National Guard', 'Ga. Guard', 'GA Guard', 'Calif. National Guard', 'N.C. National Guard',
    'Texas State Guard', 'Georgia Air Guard', 'Virginia Guard', 'Washington Guard', 'DC Guard', 'D.C. Guard', 'Bodega', 'Bodegas', 'US Naval Academy'];
  const bad = [];
  for (const t of tails) {
    const got = [F.greetName({ fullName: `Hope ${t}` }), addressOf(`Jordan Ames ${t}`), addressOf(`Ames, Jordan ${t}`), F.readName(`Ames, Jordan ${t}`).shown];
    if (JSON.stringify(got) !== JSON.stringify(['', 'jordan-ames', 'jordan-ames', 'Jordan Ames'])) bad.push(`${t}: ${JSON.stringify(got)}`);
  }
  assert.deepEqual(bad, []);
  // (every state's Guard, written out from the states' names)
  const STATES = `Alabama Alaska Arizona Arkansas California Colorado Connecticut Delaware Florida Georgia Hawaii Idaho Illinois Indiana Iowa Kansas Kentucky
    Louisiana Maine Maryland Massachusetts Michigan Minnesota Mississippi Missouri Montana Nebraska Nevada New_Hampshire New_Jersey New_Mexico New_York
    North_Carolina North_Dakota Ohio Oklahoma Oregon Pennsylvania Rhode_Island South_Carolina South_Dakota Tennessee Texas Utah Vermont Virginia Washington
    West_Virginia Wisconsin Wyoming Puerto_Rico Guam`.split(/\s+/).filter(Boolean).map((s) => s.replace('_', ' '));
  for (const s of STATES) assert.equal(addressOf(`Jordan Ames ${s} Guard`), 'jordan-ames', `${s} Guard`);
  // (ANG is a family name too, Ang: letters only typed in capitals beside small letters)
  say([['Jordan Ang', '', 'Jordan'], ['Hope ANG', '', ''], ['Jordan Del Guard', '', 'Jordan']]);
});
