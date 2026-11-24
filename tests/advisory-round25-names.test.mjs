/**
 * Advisory Board QA round 25 (Nov 24 2026): how the public application reads a name, findings 1 to 7 of the round 25
 * public tester (test-results/qa25-public: e02, e03, e03b, e03c, n01 to n11, f01, p02c, p02d). The greeting greets only on
 * positive evidence: a missed name is fine, a wrong one is the finding. Add to Advisory Board's web address, its People name
 * and its "same person?" question take the name's own words only, never a place, a company, a job or the military, and the
 * same person is offered whatever is typed around their name. Made-up people only (the repo is public).
 * (Read through the modules' namespaces, so on the code before round 25 each test fails on its own.)
 * Run: node --test tests/advisory-round25-names.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import * as F from '../functions/api/_advisory-form.js';
import * as G from '../functions/api/_given-names.js';
import { applicantEmail, readHeadshot, submitApplication } from '../functions/api/_advisory-applications.js';
import { slugOf } from '../public/admin/team-shared.js';
import { createD1 } from './lib/d1-shim.mjs';

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

// ─── Findings 1 to 3: greet only on evidence after a family name some people write first ──

test('finding 1 (the root): after a family name some people write first, the first word is greeted only when a family name of a people who write it last follows; anything else gets no name', () => {
  say([
    // (the tester's rows: Korean given names after Ann, Joe and Seung; Khmer given names after Sam, Em, Nou and Sem)
    ['Ann Hye-kyo', '', ''], ['Ann Joong-ki', '', ''], ['Joe Geun-young', '', ''], ['Ann Jun-pyo', '', ''], ['Joe Bum-soo', '', ''], ['Seung Keun-suk', '', ''],
    ['Ann Eun-bi', '', ''], ['Ann Hyekyo', '', ''], ['Joe Geunyoung', '', ''], ['Ann Jong-un', '', ''], ['Seung Kwan-woo', '', ''], ['Joe Han-byul', '', ''],
    ['Sam Thida', '', ''], ['Sam Darith', '', ''], ['Em Chanrithy', '', ''], ['Nou Sokheng', '', ''], ['Sem Kimleang', '', ''], ['Sam Bunnath', '', ''],
    ['Sam Soksan', '', ''], ['Sam Sokhai', '', ''], ['Em Rithisak', '', ''], ['Ann Hye-kyo', 'Ann', ''], ['Sam Thida', 'Sam', ''],
    // (a word the lists don't know at all, or a family name of a people who write it first: no evidence either way)
    ['Ann Qorvath', '', ''], ['Sam Zelvoran', '', ''], ['Kai Chen', '', ''], ['Ann Kim', '', ''], ['Simon Peter', '', ''], ['Albert Qorvath', '', ''],
    ['Soo Ah Kow', '', ''], ['Sam Van An', '', ''],
    // (evidence: a family name of a people who write the given name first, two of them hyphenated, a family name in parts,
    // two given names people go by together)
    ['Ann Smith', '', 'Ann'], ['Sam Johnson', '', 'Sam'], ['Juan Luna', '', 'Juan'], ['Joe Pennington', '', 'Joe'], ['Ann Mason', '', 'Ann'], ['Sam Smith-Jones', '', 'Sam'],
    ['Sam David Johnson', '', 'Sam'], ['Juan Lopez Garcia', '', 'Juan'], ['Jan de Vries', '', 'Jan'], ['Juan Dela Cruz', '', 'Juan'], ['Thanh Huong Ames', '', 'Thanh Huong'],
    ['Juan Carlos', '', 'Juan'], ['Simon Smith', '', 'Simon'], ['Albert Goldstein', '', 'Albert'], ['Sam Lee', '', 'Sam'], ['Ann Smith', 'Ann', 'Ann'],
  ]);
  assert.equal(typeof G.familyFirstUnsure, 'function', 'the evidence rule (round 25)');
  // (Tran and Wong, common in the US, are family names of peoples who write the family name first: never the evidence)
  const common = new Set((G.markedNames().commonFamilyNames || []).map(G.nameKey));
  assert.ok(common.size >= 3000, `${common.size} family names of peoples who write it last (round 24 had 1,071)`);
  for (const w of ['tran', 'wong']) assert.ok(!common.has(w), w);
});

test('finding 1: Korean syllables made by the romanizations\' own rules (Revised and McCune-Reischauer initials, vowels and finals, with the spellings people use), so every one the tester found missing is there', () => {
  for (const s of ['un', 'bum', 'kwan', 'gwan', 'kyo', 'gyo', 'pyo', 'seol', 'geun', 'keun', 'joong', 'ryeo', 'ron', 'byul', 'bi', 'sub', 'seob', 'eul', 'pyeong']) {
    assert.ok(G.givenShape('korean', `Ji-${s}`), `Ji-${s}`);
  }
  for (const w of ['Hye-kyo', 'Joong-ki', 'Geun-young', 'Jun-pyo', 'Bum-soo', 'Keun-suk', 'Eun-bi', 'Jong-un', 'Kwan-woo', 'Seol-hyun', 'Ji-sub', 'Jae-joong', 'Ki-bum',
    'Ryeo-won', 'Sae-ron', 'Han-byul', 'Hyekyo', 'Geunyoung', 'Woo-jin', 'Minjun']) assert.ok(G.givenShape('korean', w), w);
  for (const w of ['Smith', 'Jones', 'Kowalski']) assert.ok(!G.givenShape('korean', w), w);
  assert.ok(G.listSizes().koreanSyllables >= 3000, `${G.listSizes().koreanSyllables} Korean syllables (round 24 had 186 written by hand)`);
});

test('finding 3: Singapore\'s and Malaysia\'s spellings are made by rule from each family name\'s Hokkien, Teochew, Cantonese, Hakka and Hainanese readings, so Soo for 苏 comes from the rule; and the Khmer family names are written out more completely, Lon among them', () => {
  say([['Soo Wei Ming', '', ''], ['Soo Mei Ling', '', ''], ['Soo Kok Leong', '', ''], ['Lon Sokha', '', ''], ['Lon Dara', '', ''], ['Soo Wei Ming', 'Soo', ''],
    ['Tan Boon Hock', '', ''], ['Soo Smith', '', 'Soo'], ['Lon Pearson', '', 'Lon']]);
  assert.equal(typeof G.straitsSpelt, 'function', 'the Straits spelling rule (round 25)');
  assert.ok(G.straitsSpelt('su').includes('soo'), 'Hakka su is spelt Soo');
  const forms = G.chineseForms();
  const straits = Object.fromEntries(forms.map((f) => [f.pinyin, new Set((f.straits || []).map(G.nameKey))]));
  assert.ok(straits.Su?.has('soo'), 'Su (苏) is Soo in Singapore and Malaysia');
  // (the spellings Singapore and Malaysia use, written here apart from the table: each is made by the rule from a reading)
  const made = new Set(forms.flatMap((f) => (f.straits || []).map(G.nameKey)));
  const SPELT = `Tan Lim Lee Ng Ong Wong Goh Chua Chan Koh Teo Ang Yeo Tay Ho Low Toh Sim Chong Chia Seah Leong Foo Lau Yap Heng Wee Chew Chin Kwek
    Neo Poh Phua Quek Soh Pang Liew Lai Khoo Loh Cheong Choo Lok Leow Lew Kang Ting Png Hoe Kee Gan Hong Siew Chee Tee Mok Fong Seow See Sng Sia Aw Oh Yong
    Yee Woo Kok Lum Hui Tham Chai Eng Ee Ching Han Ler Kua Peh Pek Tng Lui Ow Kong Lam Yow Chiam Tok Hor Chiang Boey Cheah Choy Chuah Kow Ngiam Phang Poon
    Tang Teoh Tung Voon Wan Yeap Yik Kuan Kum Mah Moh Ngoh Pua Sin Soo Tai Tow Yeoh Lian Liow Loke Leng Hee Tey Yuen Hiew Siaw Kiew Vun Woon Ung Kuek Chng
    Beh Ooi Teh Gwee Kho Chiong Tiong Chen Tsen Thien Liaw Liong Thum Foong Yoong Fam Chiew Tiew Saw Khor Ser`.split(/\s+/).filter(Boolean);
  assert.deepEqual(SPELT.filter((w) => !made.has(G.nameKey(w))), [], 'a Singapore or Malaysia spelling the rule doesn\'t make');
  // (the family names common in Singapore and Malaysia, by their pinyin, written here: each has a form in that table)
  const COMMON_THERE = `Chen Lin Huang Li Zhang Wu Wang Liu Yang Guo Xu Zeng Cai Xie Liang Zheng Su He Luo Ye Qiu Hu Zhu Gao Ke Fu Pan Zhong Lai Sun Ma Fang Hong
    Zhuang Yu Lu Shen Wei Yao Liao Jiang Yan Peng Feng Song Deng Han Gu Wen Tian Ou Mo Dai Dong Xiao Zhou Jin Gan Kong Bai Fan Tang Tan Yuan Weng Du Zhuo Cao Lian
    Lan Lei Yun Zhan Mei Hou Cheng Qian Zou Ding Kang Gong Pang`.split(/\s+/).filter(Boolean);
  assert.deepEqual(COMMON_THERE.filter((py) => !straits[py]?.size), [], 'a family name common in Singapore and Malaysia with no form in their table');
  const khmer = new Set(G.markedNames().familyNamesOf.khmer.map(G.nameKey));
  assert.ok(khmer.has('lon') && khmer.size >= 150, `${khmer.size} Khmer family names (round 24 had 84)`);
});

// ─── Finding 4: Hungarian married names ───────────────────────────────

test('finding 4: "-ne" or "-né" after any man\'s given name, Hungary\'s own or one Hungarians share with everyone, is a married name by the spelling-neutral key; a family name of a people who write it last stays one', () => {
  for (const w of ['Martinne', 'Albertne', 'Viktorne', 'Norbertne', 'Rolandne', 'Patrikne', 'Erikne', 'Ádámne', 'Adamne', 'Emilne', 'Arnoldne', 'Rudolfne', 'Vincene', 'Kevinne',
    'Dominikne', 'Valentinne', 'Ervinne', 'Félixne', 'Martinné', 'Zoltanne']) assert.ok(G.marriedName(w), w);
  for (const w of ['Thorne', 'Lynne', 'Browne', 'Milne', 'Payne', 'Leone', 'Horne', 'Greene', 'Dunne', 'Joanne', 'Jeanne', 'Marianne', 'Adrienne', 'Simone', 'Yvonne']) assert.ok(!G.marriedName(w), w);
  say([
    ['Simon Martinne', '', ''], ['Simon Albertne', '', ''], ['Simon Viktorne', '', ''], ['Simon Norbertne', '', ''], ['Simon Rolandne', '', ''], ['Simon Patrikne', '', ''],
    ['Simon Erikne', '', ''], ['Albert Martinne', '', ''], ['Ádám Norbertne', '', ''], ['Gábor Viktorne', '', ''], ['Fábián Rolandne', '', ''], ['Dr. Simon Martinne', '', ''],
    ['Simon Martinne', 'Simon', ''], ['Simon Emilne', '', ''], ['Simon Félixne', '', ''],
    ['Mark Thorne', '', 'Mark'], ['John Browne', '', 'John'], ['Jordan Milne', '', 'Jordan'], ['Pat Payne', '', 'Pat'], ['Mike Leone', '', 'Mike'], ['Grace Lynne', '', 'Grace'],
  ]);
});

// ─── Findings 5 to 7: a place, an organization, a job or the military after the name ──

const NO_COMMA = ['City of Atlanta', 'State of Georgia', 'County of Fulton', 'University of Georgia', 'Bank of America', 'The Home Depot', 'The Coca-Cola Company',
  'US Air Force', 'U.S. Air Force', 'US Coast Guard', 'US Marine Corps', 'Georgia National Guard', 'Air National Guard', 'US Army Retired', 'Ben Hill County',
  'Clark Atlanta University', 'Trinidad and Tobago', 'North Macedonia', 'Republic of Korea', 'The Philippines', 'Town of Tyrone', 'Department of Labor',
  "Children's Healthcare of Atlanta", 'Federal Reserve Bank of Atlanta', 'United States Army', 'Navy Reserve', 'Texas National Guard', 'Democratic Republic of the Congo',
  'Isle of Man', 'Saint Kitts and Nevis', 'Trinidad & Tobago', 'Georgia Department of Education', 'Fort Moore'];

test('finding 5: after a whole name, a place or an organization of more words is read as a phrase, longest first, an "X of Y" and "The", "US" or "United States" before one by rule: the address is the name\'s alone, and never a place cut in two', () => {
  for (const tail of NO_COMMA) {
    const n = `Jordan Ames ${tail}`;
    assert.deepEqual([addressOf(n), F.readName(n).shown, F.greetName({ fullName: n })], ['jordan-ames', n, ''], n);
  }
  // (what can't be read stays as typed, never a mix: a word that's a name as often, "Edward Jones" by design; a place of two
  // words inside the name)
  for (const [n, address] of [['Jordan Ames Edward Jones', 'jordan-ames-edward-jones'], ['Jordan Lee Church', 'jordan-lee-church'], ['Jordan Ames Grace Church', 'jordan-ames-grace-church'],
    ['Charlotte North Carolina', 'charlotte-north-carolina'], ['Jordan Lee Ames Fulton County', 'jordan-lee-ames'], ['Jordan Ames - Lee', 'jordan-ames-lee'], ['Law Offices of Jordan Nguyen', 'law-offices-of-jordan-nguyen'],
    ['Jordan Ames of Atlanta', 'jordan-ames'], ['Jordan Ames Atlanta GA', 'jordan-ames'], ['Jordan Ames Holly Springs', 'jordan-ames']]) {
    assert.equal(addressOf(n), address, n);
  }
});

test('finding 6: every UN member and observer state is known, the US military whole, "Town of", "City of", "Village of", "County of", "State of" and "Commonwealth of" by rule, and Spanish business words by kind; after a comma none is a first name, and a phrase is never read as a couple', () => {
  // (after a comma: never a first name, People's name as typed, the address the family name's)
  for (const tail of ['US Navy', 'U.S. Navy', 'United States Navy', 'US Space Force', 'Navy Reserve', 'Army Reserve', 'Air Force Reserve', 'Marine Corps Reserve', 'Coast Guard',
    'National Guard', 'Georgia National Guard', 'Town of Tyrone', 'City of Atlanta', 'Village of Oak Park', 'County of Fulton', 'State of Georgia', 'Commonwealth of Virginia',
    'Sierra Leone', 'Türkiye', "Côte d'Ivoire", 'St. Lucia', 'Saint Lucia', 'Saint Kitts and Nevis', 'Trinidad and Tobago', 'Guinea-Bissau', 'Timor-Leste', 'Brasil',
    'Agencia', 'Contabilidad', 'Constructora', 'US Army', 'Turkey', 'Ivory Coast', 'Fulton County']) {
    const n = `Ames, ${tail}`;
    assert.deepEqual([addressOf(n), F.readName(n).shown], ['ames', n], n);
    assert.equal(F.readName(n).partner || null, null, `${n}: never a couple`);
  }
  say([
    ['Hope Türkiye', '', ''], ["Jordan Côte d'Ivoire", '', ''], ['Hope Brasil', '', ''], ['Hope Agencia', '', ''], ['Jordan Contabilidad', '', ''], ['Hope Constructora', '', ''],
    ['Hope Sierra Leone', '', ''], ['Grace Guinea-Bissau', '', ''], ['Jordan Gestoría', '', ''], ['Hope Remesas', '', ''], ['Grace Tortillería', '', ''],
    // (a country that's a common given or family name follows Georgia's rule)
    ['Grace Jordan', '', 'Grace'], ['Ann England', '', 'Ann'], ['Chad Smith', '', 'Chad'],
  ]);
  assert.equal(F.readName('Ames, Navy').shown, 'Navy Ames', 'Navy a given name too: Georgia\'s rule');
  const L = F.placeLists();
  assert.ok(Array.isArray(L.phrases), 'the place phrases (round 25)');
  const known = new Set([...L.anywhere, ...L.named, ...L.never, ...L.phrases]);
  const key = (c) => c.split(/\s+/).map((w) => G.nameKey(w).replace(/[^\p{L}\p{N}]+/gu, '')).filter(Boolean).join(' ');
  const UN = `Afghanistan|Albania|Algeria|Andorra|Angola|Antigua and Barbuda|Argentina|Armenia|Australia|Austria|Azerbaijan|Bahamas|Bahrain|Bangladesh|Barbados|Belarus|
    Belgium|Belize|Benin|Bhutan|Bolivia|Bosnia and Herzegovina|Botswana|Brazil|Brunei|Bulgaria|Burkina Faso|Burundi|Cabo Verde|Cambodia|Cameroon|Canada|Central African Republic|
    Chad|Chile|China|Colombia|Comoros|Congo|Costa Rica|Côte d'Ivoire|Croatia|Cuba|Cyprus|Czechia|North Korea|Democratic Republic of the Congo|Denmark|Djibouti|Dominica|
    Dominican Republic|Ecuador|Egypt|El Salvador|Equatorial Guinea|Eritrea|Estonia|Eswatini|Ethiopia|Fiji|Finland|France|Gabon|Gambia|Georgia|Germany|Ghana|Greece|Grenada|
    Guatemala|Guinea|Guinea-Bissau|Guyana|Haiti|Honduras|Hungary|Iceland|India|Indonesia|Iran|Iraq|Ireland|Israel|Italy|Jamaica|Japan|Jordan|Kazakhstan|Kenya|Kiribati|
    Kuwait|Kyrgyzstan|Laos|Latvia|Lebanon|Lesotho|Liberia|Libya|Liechtenstein|Lithuania|Luxembourg|Madagascar|Malawi|Malaysia|Maldives|Mali|Malta|Marshall Islands|Mauritania|
    Mauritius|Mexico|Micronesia|Monaco|Mongolia|Montenegro|Morocco|Mozambique|Myanmar|Namibia|Nauru|Nepal|Netherlands|New Zealand|Nicaragua|Niger|Nigeria|North Macedonia|
    Norway|Oman|Pakistan|Palau|Panama|Papua New Guinea|Paraguay|Peru|Philippines|Poland|Portugal|Qatar|South Korea|Moldova|Romania|Russia|Rwanda|Saint Kitts and Nevis|
    Saint Lucia|Saint Vincent and the Grenadines|Samoa|San Marino|Sao Tome and Principe|Saudi Arabia|Senegal|Serbia|Seychelles|Sierra Leone|Singapore|Slovakia|Slovenia|
    Solomon Islands|Somalia|South Africa|South Sudan|Spain|Sri Lanka|Sudan|Suriname|Sweden|Switzerland|Syria|Tajikistan|Thailand|Timor-Leste|Togo|Tonga|Trinidad and Tobago|
    Tunisia|Türkiye|Turkey|Turkmenistan|Tuvalu|Uganda|Ukraine|United Arab Emirates|United Kingdom|Tanzania|United States|Uruguay|Uzbekistan|Vanuatu|Venezuela|Viet Nam|
    Vietnam|Yemen|Zambia|Zimbabwe|Holy See|Palestine|Brasil|St. Lucia|St. Kitts and Nevis|Timor Leste|Guinea Bissau|Cote d'Ivoire|Ivory Coast|Russian Federation`.split('|').map((c) => c.trim());
  assert.ok(UN.length >= 195);
  assert.deepEqual(UN.filter((c) => !known.has(key(c))), [], 'a UN member or observer state, or its usual spelling, the place lists don\'t know');
});

test('finding 7: "Family, Given" with a place, a company, a job or the military straight after the given name is read as after a whole name: People\'s name the name in natural order, never a mix', () => {
  for (const tail of ['Realtor', 'Atlanta', 'Atlanta GA', 'Compass', 'Fulton County', 'US Army', 'GA', 'US Navy', 'Town of Tyrone', 'Department of Labor', 'Saint Kitts and Nevis',
    'City of Atlanta', 'Georgia National Guard', 'The Home Depot']) {
    const n = `Ames, Jordan ${tail}`;
    assert.deepEqual([addressOf(n), F.readName(n).shown, F.readName(n).words.join(' ')], ['jordan-ames', 'Jordan Ames', 'Jordan Ames'], n);
  }
  // (a middle name, a pair, more given names: theirs, as before)
  for (const [n, shown] of [['Ames, Jordan Lee', 'Jordan Lee Ames'], ['Ames, Mary Beth', 'Mary Beth Ames'], ['Ames, Fulton County', 'Ames, Fulton County'], ['Ames, Jordan, Atlanta', 'Ames, Jordan, Atlanta']]) {
    assert.equal(F.readName(n).shown, shown, n);
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
  const applied = async (fullName) => (await submitApplication(env, { ...BASE, fullName, email: `r25n.${++k}@example.org`, signature: fullName }, { headshot: shot })).app;
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

test('findings 5 to 7: through Add, "Is this Jordan Ames?" is asked whatever place, organization, job or military is typed after the name, with a comma or without, at jordan-ames-2; "Ames, US Navy" is new at ames, as typed', () => withFakes(async () => {
  const w = await addWorld();
  const a = await w.addNew(await w.applied('Jordan Ames'));
  assert.deepEqual([a.kind, a.slug], ['new', 'jordan-ames']);
  for (const [second, asName] of [['Jordan Ames City of Atlanta', null], ['Jordan Ames The Home Depot', null], ['Jordan Ames US Air Force', null], ['Jordan Ames Georgia National Guard', null],
    ['Jordan Ames Ben Hill County', null], ['Jordan Ames Trinidad and Tobago', null], ['Jordan Ames Republic of Korea', null], ['Ames, Jordan Realtor', 'Jordan Ames'],
    ['Ames, Jordan US Navy', 'Jordan Ames'], ['Ames, Jordan Department of Labor', 'Jordan Ames']]) {
    const b = await w.plan((await w.applied(second)).id);
    assert.deepEqual([b.kind, b.person?.slug, b.slug, b.asName || null], ['choose', 'jordan-ames', 'jordan-ames-2', asName], second);
  }
  for (const n of ['Ames, US Navy', 'Ames, Saint Kitts and Nevis']) {
    const b = await w.plan((await w.applied(n)).id);
    assert.deepEqual([b.kind, b.slug, b.asName || null], ['new', 'ames', null], n);
  }
}));
