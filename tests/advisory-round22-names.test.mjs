/**
 * Advisory Board QA round 22 (Nov 22 2026): how the public application reads a name to greet them (the thank-you, the
 * applicant's copy, the welcome and the monthly ask all greet with greetName) and to make their web address and match
 * them on People (Add to Advisory Board reads readName), and how fast it checks a send, from the round 22 tester's
 * findings (test-results/qa22-public: n01 to n07, n02-comma-plan, n06-address-plan, x01 to x04). The greeting rule stands:
 * greet only on positive evidence; a lost name is fine, a wrong one never is. Made-up people only; nothing leaves this
 * machine.
 * Run: node --test tests/advisory-round22-names.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
// (the lists' own helpers are imported where they're used, so each test says on round 21's code what it says)
import { greetName, readName, checkAnswers } from '../functions/api/_advisory-form.js';
import { givenName, familyFirst, givenFamilyFirst, familyFirstBefore, markedNames, listSizes } from '../functions/api/_given-names.js';
import { applicantEmail, readHeadshot, submitApplication } from '../functions/api/_advisory-applications.js';
import { createD1 } from './lib/d1-shim.mjs';

// Each row: [full name, preferred name, the greeting]; the applicant's copy's first line says the same
const say = (rows) => {
  for (const [fullName, preferredName, want] of rows) {
    assert.equal(greetName({ fullName, preferredName }), want, `${JSON.stringify(fullName)} pref=${JSON.stringify(preferredName)}`);
    assert.equal(applicantEmail({ answers: { fullName, preferredName }, headshot: null }).text.split('\n')[0], want ? `Thank you, ${want}.` : 'Thank you.', fullName);
  }
};

// ─── Finding 1: Hungarian order, the given name not on the list ──────

test('finding 1: a name ending in one of Hungary\'s common given names is written family name first and gets no name, accents typed or not when the plain spelling is no one else\'s given name', () => say([
  // (the tester's rows)
  ['Simon András', '', ''], ['Simon György', '', ''], ['Simon Antal', '', ''], ['Simon Márta', '', ''], ['Simon Nóra', '', ''], ['Simon Kristóf', '', ''],
  ['Simon Ágota', '', ''], ['Simon Noémi', '', ''], ['Simon Róbert', '', ''], ['Simon Andras', '', ''], ['Simon Gyorgy', '', ''], ['Simon András PhD', '', ''],
  ['Simon András, PhD', '', ''], ['Dr. Simon András', '', ''], ['Balázs András', '', ''],
  // (and more of the list, men's, women's and short forms, in any capitals)
  ['SIMON ANDRÁS', '', ''], ['simon andras', '', ''], ['Simon Mátyás', '', ''], ['Simon Bertalan', '', ''], ['Simon Zsombor', '', ''], ['Simon Gyuri', '', ''],
  ['Simon Kitti', '', ''], ['Simon Fanni', '', ''], ['Simon Bernadett', '', ''], ['Simon Zsuzsi', '', ''], ['Simon Júlia', '', ''], ['Simon Viktória', '', ''],
  ['Simon Lukács', '', ''], ['Simon Olivér', '', ''], ['Simon Zita', '', ''],
  // (a plain spelling that's a common given name elsewhere says nothing, as round 21 had it; nor do names Hungarians share
  // with everyone: the first word is still theirs)
  ['Simon Robert', '', 'Simon'], ['Simon Peter', '', ''] /* r25: Simon is one of Hungary's family names and Peter no family name of a people who write it last: no evidence of the order, no name (finding 1's rule) */, ['Simon Maria', '', ''] /* r25: Simon is one of Hungary's family names and Maria no family name of a people who write it last: no evidence of the order, no name (finding 1's rule) */, ['Simon Nora', '', ''] /* r25: Simon is one of Hungary's family names and Nora no family name of a people who write it last: no evidence of the order, no name (finding 1's rule) */, ['Simon Julia', '', ''] /* r25: Simon is one of Hungary's family names and Julia no family name of a people who write it last: no evidence of the order, no name (finding 1's rule) */,
  ['Simon Anna', '', ''] /* r23: Anna, Rita and Viktor are Hungary's given names too (the lead's rule 5, all 72 of the tester's), so after Simon, a Hungarian family name, the name is written family name first: no name */, ['Simon Rita', '', ''] /* r23: as Simon Anna */, ['Simon Viktor', '', ''] /* r23: as Simon Anna */, ['Eva Simon', '', 'Eva'], ['Grace Lukacs', '', 'Grace'],
]));

test('finding 1: the Hungarian lists are written out (a few hundred), every accents-only name has an accent, and a name whose plain spelling the site knows as a given name elsewhere counts only with its accents', () => {
  const m = markedNames();
  assert.ok(m.hungarian.length + m.hungarianAccented.length >= 300, `${m.hungarian.length + m.hungarianAccented.length} Hungarian names`);
  assert.ok(listSizes().hungarian >= 300, `${listSizes().hungarian} Hungarian names, once each`);
  const plainOf = (w) => w.normalize('NFKD').replace(/\p{M}/gu, '');
  assert.deepEqual(m.hungarianAccented.filter((w) => plainOf(w) === w), [], 'an accents-only name without an accent');
  // (the only names counted however typed that the site's given-names list has too are Hungarian ones it lists as such)
  const known = new Set(['Zoltán', 'László', 'Balázs', 'István', 'Ferenc', 'Csaba', 'Attila', 'Katalin', 'Erzsébet', 'Zsófia', 'Margit']);
  assert.deepEqual(m.hungarian.filter((w) => givenName(w) && !known.has(w)), [], 'counted without accents, but another people\'s given name');
  for (const w of ['Andras', 'Gyorgy', 'Antal', 'András', 'Márta', 'Nóra', 'Róbert', 'Ágota', 'Agota']) assert.ok(givenFamilyFirst(w), w);
  for (const w of ['Peter', 'Maria', 'Eva', 'Robert', 'Nora', 'Marta', 'Julia', /* r23: Anna, Simon and Viktor are Hungary's given names that everyone shares now (rule 5), counted only after a Hungarian family name */ 'Lukacs', 'Gellert', 'Jonas']) assert.ok(!givenFamilyFirst(w), w);
});

// ─── Finding 2: a family name written first that's a given name too ──

test('finding 2: a given name that\'s a family name where family names come first (Chinese, Taiwanese, Japanese, Korean, Vietnamese, Cambodian), written first before a given name of that people\'s own, is the family name: no name', () => {
  const rows = [['Tien Yu-ting', '', ''], ['Jen Hsin-yi', '', ''], ['Shan Xiaoming', '', ''], ['Yong Min-jun', '', ''], ['Yong Ji-hoon', '', ''], ['Kai Yu-ting', '', ''],
    ['Shu Qi', '', ''], ['Yong Jun-ho', '', ''], ['Kai Yuki', '', ''], ['Miki Hiroshi', '', ''], ['Thanh Minh', '', ''], ['Sam Rainsy', '', ''], ['Joe Min-ji', '', ''],
    ['TIEN YU-TING', '', ''], ['tien yu-ting', '', ''], ['Dr. Tien Yu-ting', '', ''], ['Tien Yu-ting PhD', '', '']];
  for (const fam of ['Shu', 'Ying', 'Jian', 'Zhen', 'Jing', 'Qing', 'Ming', 'Bo', 'Ping', 'Kai', 'Rui', 'Qiang', 'Zhi']) {
    for (const given of ['Xiaoming', 'Wei', 'Jing', 'Meiling', 'Xiaohong', 'Yiming']) rows.push([`${fam} ${given}`, '', '']);
  }
  say(rows);
});

test('finding 2: written given name first, before a family name of anyone\'s, they\'re greeted; two given names people go by together before a family name are still the pair', () => say([
  ['Tien Smith', '', 'Tien'], ['Shan Rowe', '', 'Shan'], ['Ming Yao', '', ''] /* r25: Ming is a family name some people write first and Yao no family name of a people who write it last: no evidence of the order, no name (finding 1's rule) */, ['Kai Jones', '', 'Kai'], ['Yong Smith', '', 'Yong'], ['Bo Jackson', '', 'Bo'],
  ['Jen Smith', '', 'Jen'], ['Yuki Kato', '', ''] /* r25: Yuki is a family name some people write first and Kato no family name of a people who write it last: no evidence of the order, no name (finding 1's rule) */, ['Sam Rowe', '', 'Sam'], ['Joe Rowe', '', 'Joe'], ['Kai Chen', '', ''] /* r25: Kai is a family name some people write first and Chen no family name of a people who write it last: no evidence of the order, no name (finding 1's rule) */, ['Ming Wei Lee', '', ''],
  ['Thanh Huong Ames', '', 'Thanh Huong'], ['Thanh Huong Le', '', ''] /* r25: Thanh is a family name some people write first and Le no family name of a people who write it last: no evidence the pair is given names first, no name (finding 1's rule) */, ['Soo Jin Park', '', ''] /* r25: Soo is a family name some people write first (Singapore's and Malaysia's 苏, finding 3) and Park no family name of a people who write it last: no evidence the pair is given names first, no name (finding 1's rule) */, ['Thanh Nguyen', '', ''] /* r25: Thanh is a family name some people write first and Nguyen no family name of a people who write it last: no evidence of the order, no name (finding 1's rule) */,
]));

test('finding 2: every name marked as a family name first before its people\'s given names is a given name on the lists, and none is a family name that always comes first', () => {
  const m = markedNames();
  assert.ok(m.familyFirstBefore.length >= 30, `${m.familyFirstBefore.length} names`);
  assert.deepEqual(m.familyFirstBefore.filter((w) => !givenName(w)), [], 'marked but not a given name on the lists');
  assert.deepEqual(m.familyFirstBefore.filter((w) => familyFirst(w)), [], 'marked but always a family name first already');
  for (const [a, b] of [['Tien', 'Yu-ting'], ['Ming', 'Wei'], ['Yong', 'Min-jun'], ['Yong', 'Xiaoming'], ['Kai', 'Yuki'], ['Sam', 'Rainsy']]) assert.ok(familyFirstBefore(a, b), `${a} ${b}`);
  for (const [a, b] of [['Tien', 'Smith'], ['Ming', 'Yao'], ['Kai', 'Jones'], ['Sam', 'Lee']]) assert.ok(!familyFirstBefore(a, b), `${a} ${b}`);
});

// ─── Finding 3: a family name written first, typed as the name they go by ──

test('finding 3: the name they go by is set aside when it\'s the full name\'s family name written first, read the way the full name\'s greeting reads it', () => say([
  // (the tester's rows)
  ['Kato Yuki', 'Kato', ''], ['Kim Min-jun', 'Kim', ''], ['Lee Ji-eun', 'Lee', ''], ['Sam Rainsy', 'Sam', ''], ['Simon Zoltán', 'Simon', ''], ['Chong Min-ho', 'Chong', ''],
  ['Abe Hiroshi', 'Abe', ''],
  // (every way the full name's greeting knows a family name written first: a hyphenated one, before its people's given
  // name, before a Hungarian given name last, with a title or letters around it, in capitals)
  ['Tien Yu-ting', 'Tien', ''], ['Yong Min-jun', 'Yong', ''], ['Simon András', 'Simon', ''], ['Dr. Simon András PhD', 'Simon', ''], ['Simon András, PhD', 'Simon', ''],
  ['KATO YUKI', 'kato', ''], ['Kim-Lee Park', 'Kim', ''], ['Nguyễn Văn An', 'Nguyen', ''],
  // (their given name, or a first word that's no family name there, is theirs)
  ['Sam Rowe', 'Sam', 'Sam'], ['Tien Smith', 'Tien', 'Tien'], ['Ming Yao', 'Ming', ''] /* r25: Ming is a family name some people write first and Yao no family name of a people who write it last: no evidence of the order, no name (finding 1's rule) */, ['Jordan Ames', 'Jordan', 'Jordan'], ['Simon Robert', 'Simon', 'Simon'],
  ['Thanh Huong Ames', 'Thanh', 'Thanh'],
]));

test('finding 3: across every family name the lists know as written first, typed as the name they go by before one of their people\'s given names, never greeted', () => {
  const marked = markedNames;
  const givenAfter = { Tien: 'Yu-ting', Jen: 'Hsin-yi', Kai: 'Yuki', Yuki: 'Hiroshi', Aida: 'Hiroshi', Miki: 'Hiroshi', Sakura: 'Hiroshi', Joe: 'Min-jun', Yong: 'Min-jun', Thanh: 'Minh',
    Vinh: 'Minh', Trang: 'Minh', Luc: 'Minh', Hoa: 'Minh', Quang: 'Minh', Sam: 'Sokha', Em: 'Sokha', Nou: 'Sokha',
    /* r23: the family names round 23 finds from each people's own list (Japanese, Korean, Cambodian ones), each before its people's given name */
    Kawai: 'Hiroshi', Ken: 'Hiroshi', Rin: 'Hiroshi', Hiro: 'Hiroshi', Ike: 'Hiroshi', Seung: 'Min-jun', Ann: 'Min-jun', Sem: 'Sokha' };
  const bad = [];
  for (const fam of marked().familyFirstBefore) {
    const fullName = `${fam} ${givenAfter[fam] || 'Xiaoming'}`;
    if (greetName({ fullName, preferredName: fam }) || greetName({ fullName })) bad.push(fullName);
  }
  for (const fam of ['Kim', 'Lee', 'Park', 'Kato', 'Abe', 'Chong', 'Nguyen', 'Tran', 'Wang']) if (greetName({ fullName: `${fam} Min-jun`, preferredName: fam })) bad.push(`${fam} Min-jun`);
  for (const given of [...(marked().hungarian || ['András']), ...(marked().hungarianAccented || ['Márta'])]) if (greetName({ fullName: `Simon ${given}`, preferredName: 'Simon' })) bad.push(`Simon ${given}`);
  assert.deepEqual(bad, []);
});

// ─── Finding 4: places and organizations ─────────────────────────────

test('finding 4: a word for a church or other congregation, a medical or care practice, a trade, a shop or service, a studio, a farm, or a state or city written last, makes the full name no name', () => say([
  // (the tester's rows)
  ['Grace Baptist', '', ''], ['Trinity Baptist', '', ''], ['Faith Baptist', '', ''], ['Hope Baptist', '', ''], ['Grace Anglican', '', ''], ['Trinity Orthodox', '', ''],
  ['Grace Reformed', '', ''], ['Faith Apostolic', '', ''], ['Grace Nazarene', '', ''], ['Hope Mennonite', '', ''], ['Trinity Wesleyan', '', ''], ['Grady Memorial', '', ''],
  ['Hope Dermatology', '', ''], ['Grace Counseling', '', ''], ['Faith Accounting', '', ''], ['Jordan Contracting', '', ''], ['Taylor Remodeling', '', ''],
  ['Jordan Interiors', '', ''], ['Ashley Furniture', '', ''], ['Grace Photography', '', ''], ['Jordan Productions', '', ''], ['Hope Fitness', '', ''],
  ['Grace Yoga', '', ''], ['Faith Catering', '', ''], ['Faith Farms', '', ''], ['Jordan Pools', '', ''], ['Hope Atlanta', '', ''], ['Austin Georgia', '', ''],
  ['Tucker Georgia', '', ''],
  // (and the kinds, written out: not only the tester's words)
  ['Grace Presbyterian', '', ''], ['Hope Pentecostal', '', ''], ['Faith Tabernacle', '', ''], ['Grace Moravian', '', ''], ['Hope Pediatrics', '', ''],
  ['Grace Cardiology', '', ''], ['Hope Hospice', '', ''], ['Jordan Plumbers', '', ''], ['Taylor Roofers', '', ''], ['Jordan Landscapes', '', ''], ['Jordan Flooring', '', ''],
  ['Grace Boutiques', '', ''], ['Ashley Jewelers', '', ''], ['Jordan Autos', '', ''], ['Hope Florist', '', ''], ['Grace Films', '', ''], ['Jordan Records', '', ''],
  ['Faith Ranch', '', ''], ['Hope Vineyard', '', ''], ['Jordan Atlanta', '', ''], ['Grace Alpharetta', '', ''], ['Jordan Chicago', '', ''], ['Hope Savannah', '', ''],
  ['Grace Virginia', '', ''], ['Jordan Virginia Beach', '', ''], ['Grace Fort Worth', '', ''], ['GRACE BAPTIST', '', ''], ['grace baptist', '', ''],
  ['Hope Atlanta Georgia', '', ''],
  // (family names that are places or trades too are people's names, greeted; so is a city or state alone or first, or in the middle)
  ['Grant Park', '', 'Grant'], ['Morgan Stanley', '', 'Morgan'], ['Robert E. Lee', '', 'Robert'], ['Jordan Park', '', 'Jordan'], ['Jordan Farmer', '', 'Jordan'],
  ['Taylor Mercer', '', 'Taylor'], ['Grace Christian', '', 'Grace'], ['Jordan Austin', '', 'Jordan'], ['Jordan Tucker', '', 'Jordan'], ['Jordan Washington', '', 'Jordan'],
  ['Jordan Madison', '', 'Jordan'], ['Jordan Houston', '', 'Jordan'], ['Jordan Dallas', '', 'Jordan'], ['Jordan Kitchens', '', 'Jordan'], ['Jordan Pool', '', 'Jordan'],
  ['Jordan Woods', '', 'Jordan'], ['Jordan Stone', '', 'Jordan'], ['Jordan Plaza', '', 'Jordan'], ['Jordan Savannah Smith', '', 'Jordan'], ['Charlotte Ames', '', 'Charlotte'],
  ['Virginia Ames', '', 'Virginia'],
]));

test('finding 4: no word on the place and organization lists is a given name on the lists (the cities that are names too aside, counted only last) or one of these family names', async () => {
  const { placeLists, placeWord, whereWord } = await import('../functions/api/_advisory-form.js');
  const l = placeLists();
  assert.ok(l.anywhere.length >= 500, `${l.anywhere.length} words`);
  assert.ok(l.last.length >= 120, `${l.last.length} states and cities`);
  assert.deepEqual([...l.anywhere, ...l.last].filter((w) => givenName(w)), [], 'a given name on the lists');
  assert.deepEqual([...l.anywhere, ...l.last, ...l.lastNamed].filter((w) => familyFirst(w)), [], 'a family name that comes first');
  const FAMILY = `park parks stanley lee mercer farmer austin houston dallas denver washington jackson lincoln madison tucker kitchen kitchens pool woods
    meadows hill hills banks bell brooks stone glass marble lake rivers bay grove ridge plaza arena montana colorado maine cleveland durham henderson
    richmond rochester birmingham montgomery lancaster salem reno irvine stockton fremont toledo mesa orlando dayton raleigh burbank lafayette decatur
    dunwoody norcross covington conyers calhoun dalton cumming milton forsyth cobb fulton clayton macon rome boston grill gallery
    baker cook carpenter mason painter turner fisher hunter gardner miller butler porter cooper barber potter church christian marina saint`
    /* r23: chamblee (a Georgia city, rule 6d), coffee and dance (business kinds, rule 6c) and orchard (orchards' singular, rule 6b) are place words now, the lead's decision */
    .split(/\s+/).filter(Boolean);
  assert.deepEqual(FAMILY.filter((w) => placeWord(w) || whereWord(w)), [], 'a family name on a place list');
});

// ─── Findings 5 and 6: a comma in the full name ──────────────────────

test('finding 5: a whole name before the comma (it starts with a given name) is the reading, its web address that name alone whatever is after the comma; "Family, Given" only for a family name on its own and a given name with no place or organization after it', () => {
  const tails = ['Grace Church', 'Sandy Springs', 'Mercy Hospital', 'Trinity Lutheran', 'Faith Ministries', 'Hope Clinic', 'Grace Fellowship', 'Holly Springs',
    'Grace Baptist Church', 'Edward Jones', 'Raymond James', 'Morgan Stanley', 'Harry Norman', 'Taylor Morrison', 'Ashley Furniture', 'Allen & Overy', 'Ernst & Young',
    'Atlanta', 'Decatur', 'she/her', 'Amy', 'Amy and Sam'];
  for (const head of ['Jordan Ames', 'JORDAN AMES', 'Dr. Jordan Ames', 'J. R. Ames', 'Mary-Kate Quill', 'Jordan & Amy Rowe']) {
    for (const tail of tails) {
      const n = `${head}, ${tail}`;
      const r = readName(n);
      const want = readName(head).words.join(' ');
      assert.equal((r.address || r.words).join(' '), want, `${n}: the address, as Add makes it`);
      assert.equal(r.words.join(' '), want, `${n}: what Add matches people on`);
      assert.equal(r.also, null, `${n}: never read last name first too`);
      assert.equal(r.apart, undefined, `${n}: never matched as part of a name`);
      assert.equal(r.shown, n.replace(/\s+/g, ' '), `${n}: People's name stays as typed`);
    }
  }
  // (a family name on its own: "Family, Given" with a given name after the comma, the words before it with a place or
  // an organization after it, or anything else)
  for (const [n, address] of [['De La Cruz, Maria', 'De La Cruz Maria'], ['Garcia Lopez, Ana', 'Garcia Lopez Ana'], ['van der Berg, Jan', 'van der Berg Jan'],
    ['St. James, Jordan', 'St. James Jordan'], ['Al Fayed, Mohammed', 'Al Fayed Mohammed'], ['De La Cruz, Grace Church', 'De La Cruz'], ['Garcia Lopez, Holly Springs', 'Garcia Lopez'],
    ['van der Berg, Mercy Hospital', 'van der Berg'], ['St. James, Hope Clinic', 'St. James'], ['De La Cruz, Maria, Atlanta', 'De La Cruz Maria'] /* r23: rule 8, the name's words only: a place after the second comma is left out of the address, the given name kept */, ['Del Rey, Compass', 'Del Rey'],
    ['De La Cruz, Maria de los Angeles', 'De La Cruz Maria de los Angeles']]) {
    const r = readName(n);
    assert.equal((r.address || r.words).join(' '), address, n);
  }
  // (one word before the comma: their first name after it, unless it's a place or an organization)
  for (const [n, words, shown] of [['Ames, Jordan', 'Jordan Ames', 'Jordan Ames'], ['Ames, Savannah', 'Savannah Ames', 'Savannah Ames'], ['Ames, Georgia', 'Georgia Ames', 'Georgia Ames'],
    ['Reyes, Ma. de los Angeles', 'Ma. de los Angeles Reyes', 'Ma. de los Angeles Reyes'], ['Ames, Grace Church', 'Ames', 'Ames, Grace Church'], ['Ames, Sandy Springs', 'Ames', 'Ames, Sandy Springs'],
    ['Ames, Atlanta', 'Ames', 'Ames, Atlanta'], ['Ames, Jordan, Atlanta', 'Jordan Ames', 'Ames, Jordan, Atlanta']]) {
    const r = readName(n);
    assert.deepEqual([r.words.join(' '), r.shown], [words, shown], n);
  }
});

// A made-up applicant world for Add, on its own: each application stored as the public form stores it, then planned by the admin
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
  const applied = async (fullName) => (await submitApplication(env, { ...BASE, fullName, email: `r22.${++k}@example.org`, signature: fullName }, { headshot: shot })).app;
  const ctx = (method, body, query = '') => ({ env, request: new Request(`https://site.test/api/advisory-applications-admin${query}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), data: { userEmail: 'linzi@soardcharity.com' }, waitUntil: () => {} });
  const plan = async (id) => (await (await adminApi.onRequestGet(ctx('GET', undefined, `?plan=${id}`))).json()).plan;
  const addNew = async (app) => { const p = await plan(app.id); const r = await (await adminApi.onRequestPost(ctx('POST', { add: { id: app.id, as: 'new', seen: p.key } }))).json(); assert.equal(r.success, true, r.error); return p; };
  return { applied, plan, addNew };
}
const among = (p) => [p.person?.slug, ...(p.others || []).map((o) => o.slug)].filter(Boolean);
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

test('finding 5: through Add, a new record\'s web address is the whole name before the comma alone, and a place or organization after a family name on its own is left out', () => withFakes(async () => {
  for (const [name, slug] of [['Jordan Ames, Grace Church', 'jordan-ames'], ['Jordan Ames, Sandy Springs', 'jordan-ames'], ['Jordan Ames, Edward Jones', 'jordan-ames'],
    ['Jordan Ames, Ernst & Young', 'jordan-ames'], ['De La Cruz, Grace Church', 'de-la-cruz'], ['De La Cruz, Maria', 'de-la-cruz-maria']]) {
    const w = await addWorld();
    const p = await w.plan((await w.applied(name)).id);
    assert.deepEqual([p.kind, p.slug], ['new', slug], name);
  }
}));

test('finding 6: through Add, the same whole name before a comma with anything after it is offered as the same person; relatives written "Family, Given" are still never offered', () => withFakes(async () => {
  // (the tester's pairs, each in a world of its own: the first added, then the second planned)
  for (const [first, second] of [['Jordan Ames, Atlanta', 'Jordan Ames, Decatur'], ['Jordan Ames, she/her', 'Jordan Ames, Grace Church'], ['Jordan Ames, Grace Church', 'Jordan Ames, Hope Clinic'],
    ['Jordan Ames, Atlanta', 'Jordan Ames'], ['Jordan Ames', 'Jordan Ames, Edward Jones'], ['Jordan Ames, Realtor', 'Jordan Ames, Grace Church']]) {
    const w = await addWorld();
    const a = await w.addNew(await w.applied(first));
    assert.deepEqual([a.kind, a.slug], ['new', 'jordan-ames'], first);
    const b = await w.plan((await w.applied(second)).id);
    assert.deepEqual([b.kind, among(b), b.slug], ['choose', ['jordan-ames'], 'jordan-ames-2'], `${second}: asked whether it's ${first}`);
  }
  // (relatives, round 21: never offered; and the words before the comma alone still asked about the person they are)
  for (const [first, second, secondSlug] of [['De La Cruz, Maria', 'De La Cruz, Jose', 'de-la-cruz-jose'], ['Garcia Lopez, Maria', 'Garcia Lopez, Ana', 'garcia-lopez-ana'],
    ['van der Berg, Piet', 'van der Berg, Klaas', 'van-der-berg-klaas'] /* r23: rule 7, a particle proves a family name, so Piet and Klaas are given names and in their addresses (Piet at van-der-berg-piet) */]) {
    const w = await addWorld();
    await w.addNew(await w.applied(first));
    const b = await w.plan((await w.applied(second)).id);
    assert.deepEqual([b.kind, among(b), b.slug], ['new', [], secondSlug], `${second}: never offered ${first}`);
  }
  const w = await addWorld();
  await w.addNew(await w.applied('Del Taylor'));
  const co = await w.plan((await w.applied('Del Taylor, Compass')).id);
  assert.deepEqual([co.kind, among(co)], ['choose', ['del-taylor']]);
}));

// ─── Finding 7: a long run of one character in an answer ─────────────

test('finding 7: every question\'s answer at the request\'s full size (64 KB of the worst repeated pieces) is checked, greeted and written into the notices in under 100 ms a call, run apart so a slow pattern fails here instead of hanging the suite', () => {
  const child = fileURLToPath(new URL('./lib/advisory-r22-slow-answers.mjs', import.meta.url));
  const LIMIT_S = 300;
  const r = spawnSync(process.execPath, [child], { encoding: 'utf8', timeout: LIMIT_S * 1000, maxBuffer: 64 * 1024 * 1024 });
  const last = String(r.stderr || '').trim().split('\n').pop();
  assert.ok(!r.error && r.signal == null, `the checks didn't finish in ${LIMIT_S} s (stopped: ${r.signal || r.error}); the question they were on: ${last}`);
  assert.equal(r.status, 0, String(r.stderr).slice(-2000));
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(out.size, 64 * 1024);
  assert.ok(out.fields.length >= 30 && out.calls >= 50000, `${out.fields.length} questions, ${out.calls} calls`);
  assert.deepEqual(out.over, [], `calls over 100 ms: ${JSON.stringify(out.over.slice(0, 5))}`);
});

test('finding 7: each answer is cut to its question\'s limit before it\'s cleaned, so what\'s past the limit is never read; what the page can send reads as before', () => {
  const GOOD = { fullName: 'Jordan Ames', email: 'jordan@example.org', phone: '(770) 555-0142', heardFrom: 'A friend', why: 'To help.', connection: 'Neighbors.', involved: 'No',
    strengths: 'Events.', fundraising: 'A match.', introductions: 'Yes', networks: 'No', conflict: 'No', hostEvent: 'No', meetings: 'Yes', ambassador: 'Yes',
    refName: 'Sam Lee', refRelationship: 'Former manager', refEmail: 'sam@example.org', acknowledge: true, signature: 'Jordan Ames', headshot: 'added' };
  // (60,000 spaces and then words: the box stops at 3,000, so the words are past it)
  assert.equal(checkAnswers({ ...GOOD, why: `${' '.repeat(60000)}To help.` }).problems.why, 'Please fill this in.');
  // (within the limit, as the page sends it: the spaces at each line's end and around it gone, as before)
  const c = checkAnswers({ ...GOOD, why: `${' '.repeat(2000)}To help. \t \nA lot.   \r\n\r\nThanks.  ` });
  assert.deepEqual([c.problems, c.answers.why], [{}, 'To help.\nA lot.\n\nThanks.']);
  assert.equal(checkAnswers({ ...GOOD, why: 'x'.repeat(5000) }).answers.why.length, 3000);
  assert.equal(checkAnswers({ ...GOOD, fullName: `Jordan${' '.repeat(5000)}Ames` }).answers.fullName, 'Jordan');
  assert.equal(checkAnswers({ ...GOOD, phone: `(770) 555-0142${' '.repeat(5000)}x12` }).answers.phone, '(770) 555-0142');
  assert.equal(checkAnswers({ ...GOOD, phone: '404.555.0188 x12' }).problems.phone, undefined, 'a work extension is still fine');
});

test('finding 7: a send is checked once, and a send of 64 KB of spaces in one answer is answered at once', async () => {
  const publicApi = await import('../functions/api/advisory-apply.js');
  const jpg = new Uint8Array(await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#c4aa8c' } }).jpeg().toBuffer());
  const env = { DB: await createD1(), CF_ACCOUNT_ID: 'acct', CF_IMAGES_TOKEN: 't' };
  const GOOD = { fullName: 'Jordan Ames', email: 'jordan@example.org', phone: '(770) 555-0142', heardFrom: 'A friend', why: 'To help.', connection: 'Neighbors.', involved: 'No',
    strengths: 'Events.', fundraising: 'A match.', introductions: 'Yes', networks: 'No', conflict: 'No', hostEvent: 'No', meetings: 'Yes', ambassador: 'Yes',
    refName: 'Sam Lee', refRelationship: 'Former manager', refEmail: 'sam@example.org', acknowledge: true, signature: 'Jordan Ames', headshot: 'added' };
  let n = 0;
  const send = async (answers) => {
    const form = new FormData();
    form.append('payload', JSON.stringify({ answers, website: '', startedAt: Date.now() - 10 * 60 * 1000, sendId: `r22-send-${++n}-0000000000` }));
    form.append('headshot', new File([jpg], 'headshot.jpg', { type: 'image/jpeg' }));
    const t = performance.now();
    const res = await publicApi.onRequestPost({ env, request: new Request('https://site.test/api/advisory-apply', { method: 'POST', headers: { 'CF-Connecting-IP': '203.0.113.9' }, body: form }), waitUntil: () => {} });
    return { status: res.status, body: await res.json(), ms: performance.now() - t };
  };
  await withFakes(async () => {
    // (how often the send's answers are read: once by each check of them, so the handler's JSON is watched)
    const realParse = JSON.parse;
    const reads = [];
    JSON.parse = (text, ...rest) => {
      const v = realParse(text, ...rest);
      if (v && typeof v === 'object' && v.answers && typeof v.answers === 'object') v.answers = new Proxy(v.answers, { get: (o, k) => { if (k === 'why') reads.push(k); return o[k]; } });
      return v;
    };
    let ok;
    try { ok = await send({ ...GOOD }); } finally { JSON.parse = realParse; }
    assert.deepEqual([ok.status, ok.body.ok], [200, true], JSON.stringify(ok.body));
    assert.equal(reads.length, 1, `the answers were checked ${reads.length} times`);
    // (60,000 spaces before the words: past the box's limit, so turned back as an empty answer, at once; and 2,900, within it, stored)
    const long = await send({ ...GOOD, email: 'jordan.long@example.org', why: `${' '.repeat(60000)}To help.` });
    assert.deepEqual([long.status, long.body.problems?.why], [422, 'Please fill this in.']);
    assert.ok(long.ms < 1000, `${Math.round(long.ms)} ms`);
    const within = await send({ ...GOOD, email: 'jordan.within@example.org', why: `${' '.repeat(2900)}To help.` });
    assert.deepEqual([within.status, within.body.ok], [200, true], JSON.stringify(within.body));
    const row = await env.DB.prepare('SELECT answers FROM advisory_applications WHERE email = ?').bind('jordan.within@example.org').first();
    assert.equal(JSON.parse(row.answers).why, 'To help.');
  });
});
