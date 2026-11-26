/**
 * Advisory Board QA round 24 (Nov 23 2026): how the public application reads a name, findings 1 to 6 of the round 24
 * public tester (test-results/qa24-public: n01 to n07, n03-wg, n03-hu, n04, accent, e03, p01, a01). The greeting greets
 * only on positive evidence: a missed name is fine, a wrong one is the finding. Add to Advisory Board's web address, its
 * People name and its "same person?" question take the name's own words only. Made-up people only (the repo is public).
 * (Read through the modules' namespaces, so on the code before round 24 each test fails on its own.)
 * Run: node --test tests/advisory-round24-names.test.mjs
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

// ─── Finding 1: Wade-Giles (and Hong Kong) forms made from the pinyin ──

test('finding 1: every Chinese family name in pinyin has its Wade-Giles form made by the romanization\'s rules, and its Hong Kong form, and each is a family name the lists know', () => {
  assert.equal(typeof G.chineseForms, 'function', 'the pinyin family names with their made forms (round 24)');
  const forms = G.chineseForms();
  assert.ok(forms.length >= 220, `${forms.length} pinyin family names`);
  const known = new Set(G.markedNames().familyNamesOf.chinese.map(G.nameKey));
  assert.deepEqual(forms.filter((f) => !f.wadeGiles).map((f) => f.pinyin), [], 'a pinyin family name with no Wade-Giles form');
  assert.deepEqual(forms.filter((f) => !f.hongKong.length).map((f) => f.pinyin), [], 'a pinyin family name with no Hong Kong form');
  assert.deepEqual(forms.flatMap((f) => [f.wadeGiles, ...f.hongKong]).filter((w) => !known.has(G.nameKey(w))), [], 'a made form the family lists don\'t know');
  // (the romanization's rules, as Taiwan writes them, apostrophes and marks aside: ch'ü is chu, hsü hsu)
  const wg = Object.fromEntries(forms.map((f) => [f.pinyin, f.wadeGiles]));
  for (const [py, want] of [['Ruan', 'juan'], ['Ran', 'jan'], ['Rui', 'jui'], ['Ru', 'ju'], ['Rao', 'jao'], ['Si', 'ssu'], ['Lian', 'lien'], ['Rong', 'jung'], ['Zhang', 'chang'],
    ['Xu', 'hsu'], ['Xie', 'hsieh'], ['Cai', 'tsai'], ['Zhuang', 'chuang'], ['Jiang', 'chiang'], ['Zhou', 'chou'], ['Qiu', 'chiu'], ['Xiong', 'hsiung'], ['Cao', 'tsao'],
    ['Gu', 'ku'], ['Guo', 'kuo'], ['Gao', 'kao'], ['Dong', 'tung'], ['Bao', 'pao'], ['Tian', 'tien'], ['Ren', 'jen'], ['Shi', 'shih'], ['Zhi', 'chih'], ['Zuo', 'tso'], ['Situ', 'ssutu']]) {
    assert.equal(wg[py], want, py);
  }
});

test('finding 1: Wade-Giles Juan (Ruan) and Jan (Ran) are family names before their people\'s given names, as Tung is; written given name first they\'re greeted', () => say([
  // (the tester's rows)
  ['Juan Yu-ting', '', ''], ['Juan Chih-ming', '', ''], ['Juan Hsin-yi', '', ''], ['Juan Mei-ling', '', ''], ['Juan Wei', '', ''], ['Juan Xiaoming', '', ''],
  ['Jan Yu-ting', '', ''], ['Jan Chih-ming', '', ''], ['Jan Hsin-yi', '', ''], ['Jan Xiaoming', '', ''], ['Juan Yu-ting', 'Juan', ''], ['Tung Chih-ming', '', ''],
  // (Spanish Juan and Dutch, Czech or Polish Jan before their own family names: theirs)
  ['Juan Carlos', '', 'Juan'], ['Juan Martinez', '', 'Juan'], ['Juan Lopez Garcia', '', 'Juan'], ['Jan Kowalski', '', 'Jan'], ['Jan de Vries', '', 'Jan'], ['Juan Dela Cruz', '', 'Juan'],
]));

// ─── Finding 2: apostrophes in the spelling-neutral key ────────────────

test('finding 2: a name written with an apostrophe of any kind is the same name without it, on the lists and as typed ("Ch\'un-hui" is Chun-hui)', () => {
  for (const [a, b] of [["Ch'un-hui", 'Chun-hui'], ['Ch’un-hui', 'Chunhui'], ['Chʻun-hui', 'Chun-hui'], ['Ch`un-hui', 'Chun-hui'], ['Ch´un-hui', 'Chun-hui'], ["O'Neil", 'Oneil'], ["De'Andre", 'DeAndre']]) {
    assert.equal(G.nameKey(a), G.nameKey(b), `${a} ${b}`);
  }
  say([
    ["Tien Ch'un-hui", '', ''], ['Tien Ch’un-hui', '', ''], ['Tien Chʻun-hui', '', ''], ["Tung Ch'ih-ming", '', ''], ["Pao Ch'ing-wen", '', ''], ["Jen Ch'ia-hui", '', ''],
    ["Shan Ch'un-hui", '', ''], ['Tien Chun-hui', '', ''],
    // (names other peoples write with an apostrophe read as before)
    ["D'Angelo Russell", '', "D'Angelo"], ["Kevin O'Brien", '', 'Kevin'], ["O'Neil Bell", '', "O'Neil"], ['Oneil Bell', '', 'Oneil'], ["Shaquille O'Neal", '', 'Shaquille'],
    ["De'Andre Hunter", '', "De'Andre"], ['DeAndre Jordan', '', 'DeAndre'], ['D’Andre Smith', '', "D'Andre"], ["N'Golo Kanté", '', ''], ["Joanna Ames", "D'Angelo", "D'Angelo"],
  ]);
});

// ─── Finding 3: given names of family-first peoples by their shape ─────

test('finding 3: a word with a family-first people\'s given-name shape after one of their family names is their given name (the tester\'s rows), and the name gets no name', () => say([
  ['Kai Daisuke', '', ''], ['Kai Daisuke', 'Kai', ''], ['Miki Hiroyuki', '', ''], ['Yuki Takahiro', '', ''], ['Aida Kyoko', '', ''], ['Kawai Takahiro', '', ''], ['Sakura Akemi', '', ''],
  ['Ken Atsushi', '', ''], ['Rin Hinata', '', ''], ['Ann Woo-jin', '', ''], ['Joe Seung-hyun', '', ''], ['Ann Na-yeon', '', ''], ['Joe Su-bin', '', ''], ['Yong Young-hee', '', ''],
  ['Bo Xiaohua', '', ''], ['Bo Jianmin', 'Bo', ''], ['Tung Wai-keung', '', ''], ['Tung Wai-keung', 'Tung', ''], ['Shan Shu-chuan', '', ''], ['Jen Hsiu-chin', '', ''],
  ['Ming Kwok-wing', '', ''], ['Ying Pui-shan', '', ''], ['Tien Xiaohua', 'Tien', ''], ['Sam Panha', '', ''], ['Sam Vannara', '', ''], ['Em Lyhour', '', ''], ['Nou Sophearith', '', ''],
]));

test('finding 3: written given name first, before a family name the lists know (one that always comes first, or one of these peoples\' that\'s nobody\'s given name), they\'re greeted, as decided', () => say([
  ['Yuki Kato', '', ''] /* r25: Yuki is a family name some people write first and Kato no family name of a people who write it last: no evidence of the order, no name (finding 1's rule) */, ['Yuki Kato', 'Kato', ''] /* r25: Yuki is a family name some people write first and Kato no family name of a people who write it last: no evidence of the order, no name (finding 1's rule) */, ['Kai Chen', '', ''] /* r25: Kai is a family name some people write first and Chen no family name of a people who write it last: no evidence of the order, no name (finding 1's rule) */, ['Ken Masuda', '', ''] /* r25: Ken is a family name some people write first and Masuda no family name of a people who write it last: no evidence of the order, no name (finding 1's rule) */, ['Ken Watanabe', '', ''] /* r25: Ken is a family name some people write first and Watanabe no family name of a people who write it last: no evidence of the order, no name (finding 1's rule) */, ['Ken Iida', '', ''] /* r25: Ken is a family name some people write first and Iida no family name of a people who write it last: no evidence of the order, no name (finding 1's rule) */, ['Rin Tanaka', '', ''] /* r25: Rin is a family name some people write first and Tanaka no family name of a people who write it last: no evidence of the order, no name (finding 1's rule) */,
  ['Ken Smith', '', 'Ken'], ['Kai Jones', '', 'Kai'], ['Sam Rowe', '', 'Sam'], ['Joe Rowe', '', 'Joe'], ['Ann Taylor', '', 'Ann'], ['Tien Smith', '', 'Tien'], ['Ming Yao', '', ''] /* r25: Ming is a family name some people write first and Yao no family name of a people who write it last: no evidence of the order, no name (finding 1's rule) */,
  ['Jen Smith', '', 'Jen'], ['Pat Lee', '', 'Pat'], ['Lou Ames', '', 'Lou'], ['Joe Park', '', ''] /* r25: Joe is a family name some people write first and Park no family name of a people who write it last: no evidence of the order, no name (finding 1's rule) */, ['Ann Kim', '', ''] /* r25: Ann is a family name some people write first and Kim no family name of a people who write it last: no evidence of the order, no name (finding 1's rule) */, ['Sam Lee', '', 'Sam'], ['Soo-jin Myung', '', 'Soo-jin'],
]));

test('finding 3: each shape is built from its romanization\'s syllables, the lists carry none of them by hand, and Khmer is a written list of a few hundred', () => {
  assert.equal(typeof G.givenShape, 'function', 'the shapes (round 24)');
  for (const w of ['Daisuke', 'Hiroyuki', 'Takahiro', 'Kosuke', 'Akemi', 'Hinata', 'Junnosuke', 'Shintaro', 'Ohno']) assert.ok(G.givenShape('japanese', w), w);
  for (const w of ['Woo-jin', 'Seung-hyun', 'Ji-sung', 'Ye-won', 'Na-yeon', 'Su-bin', 'Young-hee', 'Minjun', 'Ji-an']) assert.ok(G.givenShape('korean', w), w);
  for (const w of ['Xiaohua', 'Xiao-ping', 'Shu-chuan', 'Hsiu-chin', 'Kwok-wing', 'Wai-keung', 'Pui-shan', 'Wei', 'Chunyi']) assert.ok(G.givenShape('chinese', w), w);
  for (const [p, w] of [['japanese', 'Smith'], ['japanese', 'Lisa'], ['korean', 'Jones'], /* r25: ['korean', 'Mason'] left out: by the romanizations' own rules Ma-son is two Korean syllables (round 25, finding 1); a known family name beats a shape, so "Ann Mason" is still greeted (advisory-round25-names) */ ['chinese', 'Martinez'], ['chinese', 'Kowalski']]) assert.ok(!G.givenShape(p, w), `${p} ${w}`);
  const s = G.listSizes();
  assert.ok(s.khmer >= 300, `${s.khmer} Khmer given names`);
  assert.ok(s.pinyin >= 400 && s.wadeGiles >= 300 && s.hongKong >= 400 && s.morae >= 100, JSON.stringify(s));
});

// ─── Finding 4: Hungarian ─────────────────────────────────────────────

test('finding 4a: a wife by her husband\'s name with "-ne" for "-né" is no name after any of Hungary\'s men\'s names, accented ones too, by the spelling-neutral key', () => say([
  ['Simon Péterne', '', ''], ['Simon Peterne', '', ''], ['Simon Ádámne', '', ''], ['Simon Gáborne', '', ''], ['Simon Sándorne', '', ''], ['Simon Dánielne', '', ''],
  ['Simon Róbertne', '', ''], ['Dr. Simon Gáborne', '', ''], ['Fábián Péterne', '', ''], ['Ádám Mártonne', '', ''], ['Albert Gáborne', '', ''], ['Kovács Péterne', '', ''],
  ['Simon Péterne', 'Simon', ''], ['Simon Péterné', '', ''], ['Simon Zoltánne', '', ''],
  // (never a woman's name: hers is never made from a woman's, "Juliane", "Mariane", "Marianne" are names of their own)
  ['Jordan Juliane', '', 'Jordan'], ['Anna Mariane Silva', '', 'Anna'], ['Mary Marianne Ames', '', 'Mary'], ['Jean Jeanne Ames', '', 'Jean'],
]));

test('finding 4b: Hungary\'s given names that are its family names too, written first before any Hungarian given name, are the family name', () => {
  say([
    ['Gábor Rita', '', ''], ['Gábor Anna Rita', '', ''], ['Ábrahám Anna', '', ''], ['Jordán Erika', '', ''], ['István Rita', '', ''], ['Ottó Kevin', '', ''], ['Attila Laura', '', ''],
    ['Csaba Anna', '', ''], ['Iván Erika', '', ''], ['Ferenc Linda', '', ''], ['Bálint Rita', '', ''], ['Imre Anna', '', ''], ['Lukács Erika', '', ''], ['Tamás Rita', '', ''],
    // (the plain spelling of an accented one is other people's, and given name first it's theirs, as decided)
    ['Gabor Rita', '', 'Gabor'], ['Jordan Erika', '', 'Jordan'], ['Ivan Petrov', '', 'Ivan'], ['Attila Smith', '', 'Attila'], ['Zoltán Simon', '', 'Zoltán'], ['Simon Rita', '', ''],
  ]);
  for (const w of ['Gábor', 'Ábrahám', 'Jordán', 'István', 'Ottó', 'Attila', 'Csaba', 'Iván', 'Ferenc', 'Balázs', 'Bálint', 'Fábián', 'Gergely', 'Imre', 'Lukács', 'Máté',
    'Mihály', 'Pál', 'Péter', 'Simon', 'Tamás', 'Vince']) assert.ok(G.markedNames().hungarianFamily.includes(w), w);
  for (const w of ['Gabor', 'Adam', 'Peter', 'Ivan', 'Jordan']) assert.ok(!G.hungarianFamily(w), w);
});

// ─── Finding 5: the name's own words, on every path ───────────────────

test('finding 5: the web address and the words Add matches on are the name\'s own, with no comma too: never pronouns, brackets, what follows a slash, a job after a spaced dash, a place or a company after the name', () => {
  for (const [n, address] of [['Jordan Ames (she/her)', 'jordan-ames'], ['Jordan Ames she/her', 'jordan-ames'], ['Jordan Ames - Realtor', 'jordan-ames'], ['Jordan Ames Atlanta GA', 'jordan-ames'],
    ['Jordan Ames (Compass)', 'jordan-ames'], ['Jordan Ames – Compass', 'jordan-ames'], ['Jordan Ames [Atlanta]', 'jordan-ames'], ['Jordan Ames - Atlanta, GA', 'jordan-ames'],
    ['Jordan Ames / Edward Jones', 'jordan-ames'], ['Jordan Ames @ Compass', 'jordan-ames'], ['Jordan Ames of Atlanta', 'jordan-ames'], ['Jordan Ames Decatur GA', 'jordan-ames'],
    ['Jordan Ames Compass', 'jordan-ames'], ['Jordan Ames Realtor', 'jordan-ames'], ['Jordan Ames GA', 'jordan-ames'], ['Jordan (Jo) Ames', 'jordan-ames'], ['Jordan/Jo Ames', 'jordan-ames'],
    ['Jordan Ames (she/her), Realtor', 'jordan-ames'], ['Jordan Rowe w/ kids', 'jordan-rowe'], ['Jordan Ames Holly Springs', 'jordan-ames'], ['Jordan Ames New York', 'jordan-ames'],
    // (what the code can't know stays as typed: a word that's a family name as often, a company that's a person's name)
    ['Jordan Lee Church', 'jordan-lee-church'], ['Jordan Ames - Lee', 'jordan-ames-lee'], ['Jordan Lee Ames GA', 'jordan-lee-ames'], ['Charlotte North Carolina', 'charlotte-north-carolina'],
    ['Law Offices of Jordan Nguyen', 'law-offices-of-jordan-nguyen']]) {
    assert.equal(addressOf(n), address, n);
  }
  // (People's name as typed when it stays in the order typed; first name first from its own words on "Family, Given")
  for (const [n, shown] of [['Jordan Ames (she/her)', 'Jordan Ames (she/her)'], ['Jordan Ames - Realtor', 'Jordan Ames - Realtor'], ['Ames, Jordan she/her', 'Jordan Ames'],
    ['Ames, Jordan (she/her)', 'Jordan Ames'], ['Ames, Jordan / Edward Jones', 'Jordan Ames'], ['Ames, Jordan - Realtor', 'Jordan Ames'], ['Ames, DeKalb County', 'Ames, DeKalb County'],
    ['Ames, Fulton County', 'Ames, Fulton County'], ['Ames, Jordan, Atlanta', 'Ames, Jordan, Atlanta'], ['Jordan Ames, she/her', 'Jordan Ames, she/her']]) {
    assert.equal(F.readName(n).shown, shown, n);
  }
  for (const n of ['Jordan Ames (she/her)', 'Jordan Ames - Realtor', 'Jordan Ames Atlanta GA', 'Ames, Jordan she/her', 'Ames, Fulton County']) assert.equal(F.greetName({ fullName: n }), '', n);
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
  const applied = async (fullName) => (await submitApplication(env, { ...BASE, fullName, email: `r24n.${++k}@example.org`, signature: fullName }, { headshot: shot })).app;
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

test('finding 5: through Add, the same person is asked about whatever is typed around their name, at the address of their own words; People\'s name never a mix', () => withFakes(async () => {
  for (const [second, asName] of [['Jordan Ames (she/her)', null], ['Jordan Ames - Realtor', null], ['Jordan Ames Atlanta GA', null], ['Jordan Ames (Compass)', null],
    ['Ames, Jordan she/her', 'Jordan Ames'], ['Ames, Jordan / Edward Jones', 'Jordan Ames'], ['Ames, Jordan (she/her)', 'Jordan Ames']]) {
    const w = await addWorld();
    const a = await w.addNew(await w.applied('Jordan Ames'));
    assert.deepEqual([a.kind, a.slug], ['new', 'jordan-ames']);
    const b = await w.plan((await w.applied(second)).id);
    assert.deepEqual([b.kind, among(b), b.slug, b.asName || null], ['choose', ['jordan-ames'], 'jordan-ames-2', asName], `${second}: asked whether it's Jordan Ames`);
  }
}));

// ─── Finding 6: places and organizations ──────────────────────────────

test('finding 6: counties, "City of", "State of", the military, countries, large employers and Spanish business words after a comma are never a first name; through Add, "Ames, Fulton County" is at ames, its People name as typed', () => withFakes(async () => {
  for (const tail of ['Fulton County', 'Cobb County', 'Clayton County', 'Henry County', 'Cherokee County', 'Forsyth County', 'Douglas County', 'Hall County', 'Paulding County',
    'Fayette County', 'City of Decatur', 'State of Georgia', 'US Army', 'U.S. Army', 'Georgia State', 'Federal Reserve', 'Nigeria', 'Puerto Rico', 'Costa Rica', 'Vietnam', 'Haiti',
    'Delta', 'Starbucks', 'Waffle House', 'Wells Fargo', 'Home Depot', 'Chick-fil-A', 'Coca-Cola', 'UPS', 'Iglesia', 'Restaurante', 'Panadería', 'Tienda', 'Seguros', 'Abogados',
    'Clínica', 'Taquería', 'Taqueria', 'Self-employed']) {
    const n = `Ames, ${tail}`;
    assert.deepEqual([addressOf(n), F.readName(n).shown], ['ames', n], n);
  }
  for (const n of ['Ames, Fulton County', 'Ames, Nigeria']) {
    const w = await addWorld();
    const app = await w.applied(n);
    const p = await w.plan(app.id);
    assert.deepEqual([p.kind, p.slug, p.asName || app.name], ['new', 'ames', n], n);
  }
}));

test('finding 6: after a given name, a country or a large employer is a place, by the spelling-neutral key; a country that\'s a common family name never is, and one that\'s a given name only last', () => {
  say([
    ['Hope Nigeria', '', ''], ['Grace Haiti', '', ''], ['Hope Puerto Rico', '', ''], ['Jordan Vietnam', '', ''], ['Hope Costa Rica', '', ''], ['Jordan Delta', '', ''],
    ['Jordan Starbucks', '', ''], ['Hope Waffle House', '', ''], ['Jordan Wells Fargo', '', ''], ['Jordan Taquería', '', ''], ['Jordan Taqueria', '', ''], ['Jordan Iglesia', '', ''],
    ['Hope Seguros', '', ''], ['Grace Clínica', '', ''], ['Hope India', '', ''], ['Hope Chad', '', ''], ['Grace Kenya', '', ''],
    // (common family names there, and given names first: theirs)
    ['Grace Jordan', '', 'Grace'], ['Amy Israel', '', 'Amy'], ['Kate Holland', '', 'Kate'], ['Ann England', '', 'Ann'], ['Jordan Mercado', '', 'Jordan'], ['Julio Iglesias', '', 'Julio'],
    ['Chad Smith', '', 'Chad'], ['Edward Jones', '', 'Edward'], ['Jordan Ames', '', 'Jordan'],
  ]);
  for (const w of ['taquería', 'taqueria', 'Taquería', 'panaderia', 'nigeria', 'starbucks', "arby's", 'arbys', 'chick-fil-a', 'county']) assert.ok(F.placeWord(w), w);
  for (const w of ['jordan', 'israel', 'mercado', 'iglesias', 'india', 'chad']) assert.ok(!F.placeWord(w), w);
  for (const w of ['india', 'chad', 'kenya', 'georgia']) assert.ok(F.whereWord(w) && !F.whereWord(w, { named: false }), w);
});

// ─── The lead's refinements, after the first pass ─────────────────────

test('refinement 1: a known family name beats a shape: a common family name of any people\'s after a marked family-first family name, not on that people\'s own list, is the family name and the first word is greeted; a given name of theirs still gets none', () => {
  say([
    // (lost to a shape in the first pass, greeted again)
    ['Juan Luna', '', 'Juan'], ['Ken Johnson', '', 'Ken'], ['Aida Romero', '', 'Aida'], ['Kai Mason', '', 'Kai'], ['Jan Hansen', '', 'Jan'], ['Juan Soto', '', 'Juan'],
    ['Ken Moore', '', 'Ken'], ['Pat Hanna', '', 'Pat'], ['Yuki Rose', '', 'Yuki'], ['Jen Wade', '', 'Jen'], ['Bo Jackson', '', 'Bo'], ['Lou Moran', '', 'Lou'],
    // (Lin always comes first and isn't on the Chinese list: the family name, so Pat is greeted)
    ['Pat Lin', '', ''] /* r25: Pat is a family name some people write first and Lin no family name of a people who write it last: no evidence of the order, no name (finding 1's rule) */, ['Kai Chen', '', ''] /* r25: Kai is a family name some people write first and Chen no family name of a people who write it last: no evidence of the order, no name (finding 1's rule) */, ['Yuki Kato', '', ''] /* r25: Yuki is a family name some people write first and Kato no family name of a people who write it last: no evidence of the order, no name (finding 1's rule) */,
    // (their people's given names, by the list or the shape: still none, and one on their own list beats a surname)
    ['Juan Yu-ting', '', ''], ['Kai Daisuke', '', ''], ['Ann Woo-jin', '', ''], ['Bo Xiaohua', '', ''], ['Tung Wai-keung', '', ''], ['Bo Bowen', '', ''],
  ]);
  assert.ok((G.markedNames().commonFamilyNames || []).length >= 1000, 'the common family names written out (round 24)');
});

test('refinement 2: Hokkien, Teochew and Hakka as Singapore and Malaysia write them, and the older spellings, are Chinese given names\' shapes too', () => {
  say([
    ['Tan Boon Hock', '', ''], ['Lim Chee-hwa', '', ''], ['Bo Boon Hock', '', ''], ['Ming Chee-hwa', '', ''], ['Bo Kiat', '', ''], ['Jian Siew Ling', '', ''],
    ['Tung Yat-sen', '', ''], ['Shan Ing-wen', '', ''], ['Ming Ying-jeou', '', ''], ['Kai Hwee', '', ''], ['Ping Fook', '', ''], ['Juan Teck', '', ''],
    // (given name first, before a family name the lists know: theirs)
    ['Ming Tsai', '', ''] /* r25: Ming is a family name some people write first and Tsai no family name of a people who write it last: no evidence of the order, no name (finding 1's rule) */, ['Bo Tan', '', ''] /* r25: Bo is a family name some people write first and Tan no family name of a people who write it last: no evidence of the order, no name (finding 1's rule) */, ['Kai Goh', '', ''] /* r25: Kai is a family name some people write first and Goh no family name of a people who write it last: no evidence of the order, no name (finding 1's rule) */,
  ]);
  for (const w of ['Boon', 'Hock', 'Huat', 'Chye', 'Teck', 'Siew', 'Hwee', 'Kiat', 'Keng', 'Seng', 'Chee-hwa', 'Yat-sen', 'Ying-jeou', 'Ing-wen']) assert.ok(G.givenShape('chinese', w), w);
  assert.ok(G.listSizes().hokkien >= 500, `${G.listSizes().hokkien} Hokkien, Teochew and Hakka syllables`);
});
