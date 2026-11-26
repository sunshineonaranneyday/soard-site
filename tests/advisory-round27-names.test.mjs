/**
 * Advisory Board QA round 27 (Nov 26 2026): how the public application reads a name, findings 1 to 5 of the round 27
 * public tester (test-results/qa27-public: e02, e03, p02 27a to 27d, p03 27e and 27f, a11, a14, a15, n10). The greeting
 * greets only on positive evidence: a missed name is fine, a wrong one is the finding. Add to Advisory Board's web address,
 * its People's name and its "Is this ...?" question never take a place, a company, a job or the military, and never drop
 * a word that may be the person's name; two people are never offered as one because of what the code doesn't know, and the
 * same person is offered whatever is typed around their name. Made-up people only (the repo is public).
 * (Read through the modules' namespaces, so on the code before round 27 each test fails on its own.)
 * Run: node --test tests/advisory-round27-names.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import * as F from '../functions/api/_advisory-form.js';
import * as G from '../functions/api/_given-names.js';
import { applicantEmail, readHeadshot, submitApplication } from '../functions/api/_advisory-applications.js';
import { slugOf } from '../public/admin/team-shared.js';
import { createD1 } from './lib/d1-shim.mjs';
import { R27_FAMILY_NAMES } from './lib/advisory-r27-family-names.mjs';
import { R27_OFFICIAL, R27_SHORT, R27_LOCAL, R27_COUNTRIES } from './lib/advisory-r27-places.mjs';
import { R26_DECIDED } from './lib/advisory-r26-places.mjs';

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
const shownOf = (n) => F.readName(n).shown;
const words = (s) => s.split(/\s+/).filter(Boolean);

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
  const applied = async (fullName) => (await submitApplication(env, { ...BASE, fullName, email: `r27n.${++k}@example.org`, signature: fullName }, { headshot: shot })).app;
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

// ─── Finding 1: a family name is never taken for a place or an organisation ──

test('finding 1 (the root): no word the place lists count as a place or an organisation on its own is a family name of a people who write it last, on the code\'s lists (SURNAMES, FAMILY_LAST) or on a list written apart (West African, Spanish, Portuguese, German and others\', Camara and Kinder among them); the family names that are names more than words are never a place word at all', () => {
  const L = F.placeLists();
  const apart = new Set(words(R27_FAMILY_NAMES).map(G.nameKey));
  for (const w of ['camara', 'kinder', 'capilla', 'condado', 'reino', 'junta', 'banco', 'carne', 'carnes']) assert.ok(apart.has(w), `${w} on the list written apart`);
  const common = new Set(G.markedNames().commonFamilyNames.map(G.nameKey));
  const more = new Set((G.markedNames().moreFamilyNames || []).map(G.nameKey));
  const family = (w) => common.has(w) || more.has(w) || apart.has(w);
  // (on its own: what starts what's after a name, a city or a state last, the military's and work's words; before round 27,
  // which didn't list them apart, every word that counts anywhere)
  const own = [...new Set([...(L.standalone || L.anywhere), ...(L.onItsOwn || []), ...(L.wheres || L.last)])];
  assert.deepEqual(own.filter(family), [], 'a word that ends a name on its own is a family name');
  // (and a place word anywhere, the greeting's too: never one of FAMILY_LAST's or the list written apart)
  assert.deepEqual(L.anywhere.filter((w) => more.has(w) || apart.has(w)), [], 'a place word that\'s a family name more than a word');
  // (the Spanish and Portuguese heads are no place words on their own any more, as round 26 made them)
  for (const w of ['camara', 'capilla', 'condado', 'reino', 'junta', 'banco', 'ciudad', 'centro', 'estado', 'distrito', 'alianza', 'consulado']) assert.ok(!F.placeWord(w), w);
  // (a country that's a family name follows Georgia's rule, as one that's a given name does: "Spain")
  assert.ok(L.named.includes('spain') && !L.anywhere.includes('spain'), 'Spain, a family name too, only last');
  assert.equal(typeof G.familyNameLast, 'function', 'the family names written last (round 27)');
});

test('finding 1: the tester\'s names keep their family name in the web address, and are greeted as the live site greets them; "Mohamed Lamine" is never "Mohamed Lamine Camara"', () => {
  const rows = [
    // [as typed, the address, the greeting: as on the live site, 366ddc84]
    ['Mohamed Lamine Camara', 'mohamed-lamine-camara', 'Mohamed'], ['Ibrahima Sory Camara', 'ibrahima-sory-camara', 'Ibrahima'],
    ['Aminata Camara', 'aminata-camara', 'Aminata'], ['Ana Paula Câmara', 'ana-paula-camara', 'Ana Paula'], ['Carlos Alberto Cámara', 'carlos-alberto-camara', 'Carlos Alberto'],
    ['Ana Paula Câmara de Oliveira', 'ana-paula-camara-de-oliveira', ''], ['Luiz Felipe Câmara de Sousa', 'luiz-felipe-camara-de-sousa', ''],
    ['José Luis Cámara del Río', 'jose-luis-camara-del-rio', ''], ['Mary Beth Kinder', 'mary-beth-kinder', 'Mary Beth'],
    ['Juan Pérez Capilla de la Torre', 'juan-perez-capilla-de-la-torre', ''], ['Ana López Cámara de la Cruz', 'ana-lopez-camara-de-la-cruz', ''],
    ['Maria Capilla', 'maria-capilla', 'Maria'], ['Ana Condado', 'ana-condado', 'Ana'], ['Rosa Reino', 'rosa-reino', 'Rosa'], ['Luis Junta', 'luis-junta', 'Luis'],
    ['Marco Banco', 'marco-banco', 'Marco'], ['Mary Carnes', 'mary-carnes', 'Mary'], ['Mary Beth Moultrie', 'mary-beth-moultrie', 'Mary Beth'],
    // (the controls)
    ['Mohamed Lamine Diallo', 'mohamed-lamine-diallo', 'Mohamed'], ['Ana Paula Moreira', 'ana-paula-moreira', 'Ana Paula'],
  ];
  const bad = rows.filter(([n, a, g]) => addressOf(n) !== a || F.greetName({ fullName: n }) !== g || shownOf(n) !== n).map(([n]) => `${n}: ${addressOf(n)} ${JSON.stringify(F.greetName({ fullName: n }))}`);
  assert.deepEqual(bad, []);
});

test('finding 1: a Spanish or Portuguese head starts an organisation only with its join and an organisation\'s word or a known place after it, never on its own and never before a family name', () => {
  for (const o of ['Cámara de Comercio', 'Banco de Chile', 'Junta de Andalucía', 'Banco de México', 'Ciudad de Atlanta', 'Consulado de México', 'Iglesia de Dios',
    'Cámara de Comercio Hispana', 'Salón de Belleza', 'Constructora del Sur', 'Câmara dos Deputados', 'Igreja de Deus', 'Banco do Brasil', 'Junta de Gobierno']) {
    assert.deepEqual([addressOf(`Jordan Ames ${o}`), addressOf(`Ames, Jordan ${o}`), shownOf(`Ames, Jordan ${o}`)], ['jordan-ames', 'jordan-ames', 'Jordan Ames'], o);
  }
  // (a family name after the join, or the head alone: the name's)
  for (const n of ['Ana Paula Câmara de Oliveira', 'José Luis Cámara del Río', 'Juan Pérez Capilla de la Torre', 'Ana Lucía Banco de la Fuente', 'Pedro Junta de Souza',
    'María José Cámara', 'Jordan Ames Cámara', 'Jordan Ames Capilla', 'Jordan Ames Condado', 'Jordan Ames Reino', 'Jordan Ames Junta', 'Jordan Ames Banco']) {
    assert.equal(addressOf(n), slugOf(n), n);
  }
});

test('finding 1: through Add, the tester\'s names are added at their whole name, and two people are never offered as one because a family name was read as a place', () => withFakes(async () => {
  const w = await addWorld();
  const bad = [];
  const added = async (n, want) => { const p = await w.addNew(await w.applied(n)); if (p.kind !== 'new' || p.slug !== want) bad.push(`${n}: ${p.kind} ${p.slug}`); };
  await added('Mohamed Lamine Camara', 'mohamed-lamine-camara');
  await added('Ana López', 'ana-lopez');
  await added('Juan Pérez', 'juan-perez');
  for (const [n, slug] of [['Mohamed Lamine', 'mohamed-lamine'], ['Ana López Cámara de la Cruz', 'ana-lopez-camara-de-la-cruz'], ['Juan Pérez Capilla de la Torre', 'juan-perez-capilla-de-la-torre'],
    ['Ibrahima Sory Camara', 'ibrahima-sory-camara'], ['Mary Beth Kinder', 'mary-beth-kinder'], ['José Luis Cámara del Río', 'jose-luis-camara-del-rio']]) {
    const p = await w.plan((await w.applied(n)).id);
    if (JSON.stringify([p.kind, p.slug, p.person?.slug || null]) !== JSON.stringify(['new', slug, null])) bad.push(`${n}: ${JSON.stringify([p.kind, p.slug, p.person?.slug])}`);
  }
  // (the same person whatever's typed: "Mohamed Lamine Camara" again is asked about)
  const again = await w.plan((await w.applied('Mohamed Lamine Camara')).id);
  if (again.kind !== 'choose' || again.person?.slug !== 'mohamed-lamine-camara') bad.push(`again: ${again.kind} ${again.person?.slug}`);
  assert.deepEqual(bad, []);
}));

// ─── Finding 2: "Family, Given" with an organisation after it ──

test('finding 2: after "Family, Given", People\'s name is never a mix: a word that starts an organisation belongs to it even when it\'s a given name too, and when nothing is sure the name is exactly as typed', () => {
  // (the decided)
  assert.deepEqual([shownOf('Ames, Jordan Mercy Hospital of Atlanta'), addressOf('Ames, Jordan Mercy Hospital of Atlanta')], ['Jordan Ames', 'jordan-ames']);
  for (const n of ['Ames, Grace Church of God', 'Ames, Art Institute of Atlanta', 'Ames, Hope for Children']) assert.deepEqual([shownOf(n), addressOf(n)], [n, 'ames'], n);
  // (every one of the tester's: "Jordan Ames" at jordan-ames, or as typed at ames; never a mix)
  const orgs = ['Mercy Hospital of Atlanta', 'Grace Church of God', 'Faith Temple of Praise', 'Trinity Church of Atlanta', 'Hope for Children', 'Joy Center for Kids',
    'Autism Society of Georgia', 'Down Syndrome Association of Atlanta', 'Spina Bifida Association of Georgia', 'The Arc of Georgia', 'Junior League of Atlanta',
    'Rotary Club of Atlanta', 'Emory University School of Medicine', 'Fraternal Order of Police', 'March of Dimes', 'Ronald McDonald House Charities of Atlanta',
    'Marine Veteran', 'Disabled Veteran', 'JAG Corps', 'Navy Nurse Corps', "Children's Healthcare of Atlanta"];
  const bad = [];
  for (const o of orgs) {
    const n = `Ames, Jordan ${o}`;
    const got = [shownOf(n), addressOf(n)];
    if (JSON.stringify(got) !== JSON.stringify(['Jordan Ames', 'jordan-ames']) && JSON.stringify(got) !== JSON.stringify([n, 'ames'])) bad.push(`${n}: ${JSON.stringify(got)}`);
  }
  assert.deepEqual(bad, []);
  // (these read whole: "Jordan Ames")
  for (const o of ['Mercy Hospital of Atlanta', 'Grace Church of God', 'Faith Temple of Praise', 'Trinity Church of Atlanta', 'Hope for Children', 'Joy Center for Kids',
    'Junior League of Atlanta', 'Autism Society of Georgia', 'Rotary Club of Atlanta', 'Fraternal Order of Police', 'Marine Veteran', 'Disabled Veteran', 'JAG Corps', 'Navy Nurse Corps']) {
    assert.equal(shownOf(`Ames, Jordan ${o}`), 'Jordan Ames', o);
  }
  // (a given name that's surely the name's, and what's no organisation, as before)
  for (const [n, shown] of [['Ames, Jordan Lee of Atlanta', 'Jordan Lee Ames'], ['Ames, Jordan Ann Realtor', 'Jordan Ann Ames'], ['Rowe, Jordan & Amy of Atlanta', 'Jordan & Amy Rowe'],
    ['Ames, Jordan YMCA of Metro Atlanta', 'Jordan Ames'], ['Ames, Jordan Republic of Albania', 'Jordan Ames'], ['Ames, Jordan Town of Tyrone', 'Jordan Ames'], ['Ames, Grace Church', 'Ames, Grace Church']]) {
    assert.equal(shownOf(n), shown, n);
  }
});

test('finding 2: the natural order the same: after the family name an organisation is cut from its first word, a given name too; a word the lists don\'t know, or a family name, stops it and the name keeps it', () => {
  for (const [n, a] of [['Jordan Ames Mercy Hospital of Atlanta', 'jordan-ames'], ['Jordan Ames Grace Church of God', 'jordan-ames'], ['Jordan Ames Junior League of Atlanta', 'jordan-ames'],
    ['Jordan Ames Hope for Children', 'jordan-ames'], ['Jordan Ames Faith Temple of Praise', 'jordan-ames'], ['Jordan Ames Joy Center for Kids', 'jordan-ames'],
    ['Jordan Ames Autism Society of Georgia', 'jordan-ames'], ['Jordan Ames Rotary Club of Atlanta', 'jordan-ames'], ['Jordan Ames Down Syndrome Association of Atlanta', 'jordan-ames'],
    ['Jordan Lee Qorvath Church of God', 'jordan-lee-qorvath'], ['Jordan Grace Church of God', 'jordan-grace'], ['Jordan Mercy Hospital of Atlanta', 'jordan-mercy'],
    ['Jordan Ames Ronald McDonald House Charities of Atlanta', 'jordan-ames-ronald-mcdonald'], ['Jordan Ames for Congress', 'jordan-ames'], ['Jordan Ames Mercy Hospital', 'jordan-ames-mercy-hospital']]) {
    assert.equal(addressOf(n), a, n);
    assert.equal(shownOf(n), n, n);
  }
  // (the words that start an organisation and are given names too: each one a given name on the lists, or a generation's or the Marines')
  const L = F.placeLists();
  assert.ok(Array.isArray(L.orgNames) && L.orgNames.length >= 40, 'the given names organisations are named by');
  assert.deepEqual(L.orgNames.filter((w) => !G.onTheLists(w) && !/^(?:junior|senior|marine|marines|art|arts|valor|valour|independence|patriot|legend|eagle|golden|noble|royal|summit|cedar|magnolia|olive|pearl|star|sky|sunshine|truth|spirit|bliss|blessing|peace|justice|honour|honor|legacy|promise|haven|glory|providence|harmony|unity|victory|liberty|charity|freedom|serenity|zion|eden|bethel|bethany|shiloh|genesis|christian|heaven|angel|angels|emmanuel|immanuel|calvary|carmel|sharon|hebron|canaan|goshen|jericho|galilee|nazareth|bethesda|gethsemane|sterling|rose|lily|grace|mercy|hope|faith|trinity|joy|destiny)$/u.test(w)), []);
});

test('finding 2: through Add, "Is this Jordan Ames?" is asked at jordan-ames-2 for "Ames, Jordan Mercy Hospital of Atlanta", People\'s name "Jordan Ames"; when nothing is sure, as typed, never a mix', () => withFakes(async () => {
  const w = await addWorld();
  const a = await w.addNew(await w.applied('Jordan Ames'));
  assert.deepEqual([a.kind, a.slug], ['new', 'jordan-ames']);
  const bad = [];
  for (const o of ['Mercy Hospital of Atlanta', 'Grace Church of God', 'Faith Temple of Praise', 'Hope for Children', 'Junior League of Atlanta', 'Rotary Club of Atlanta', 'Marine Veteran']) {
    const b = await w.plan((await w.applied(`Ames, Jordan ${o}`)).id);
    if (JSON.stringify([b.kind, b.person?.slug, b.slug, b.asName || null]) !== JSON.stringify(['choose', 'jordan-ames', 'jordan-ames-2', 'Jordan Ames'])) bad.push(`Ames, Jordan ${o}: ${JSON.stringify([b.kind, b.person?.slug, b.slug, b.asName])}`);
    const c = await w.plan((await w.applied(`Jordan Ames ${o}`)).id);
    if (JSON.stringify([c.kind, c.person?.slug, c.slug, c.asName || null]) !== JSON.stringify(['choose', 'jordan-ames', 'jordan-ames-2', null])) bad.push(`Jordan Ames ${o}: ${JSON.stringify([c.kind, c.person?.slug, c.slug, c.asName])}`);
  }
  for (const n of ['Ames, Grace Church of God', 'Ames, Art Institute of Atlanta', 'Ames, Jordan Ronald McDonald House Charities of Atlanta']) {
    const b = await w.plan((await w.applied(n)).id);
    if (b.asName && b.asName !== 'Jordan Ames') bad.push(`${n}: a mix, ${b.asName}`);
  }
  assert.deepEqual(bad, []);
}));

// ─── Finding 3: Chinese family names in their Taishanese (Chinese American) spellings ──

test('finding 3: the Taishanese and other Chinese American spellings of Chinese family names are written by rule from each surname\'s readings, so a Chinese given name after one is never greeted', () => {
  say([
    // (the tester's, on the page and through the handler)
    ['Tom Mei-Ling', '', ''], ['Tom Mei Ling', '', ''], ['Tom Wai-Man', '', ''], ['Tom Ka Ho', '', ''], ['Louie Mei Ling', '', ''], ['Louie Wai-Man', '', ''],
    ['Louis Mei Ling', '', ''], ['Louis Siu Ming', '', ''], ['Louis Wai Man', '', ''], ['Tom Mei-Ling', 'Tom', ''], ['Tam Mei-Ling', '', ''], ['Lui Mei Ling', '', ''],
    // (a western given name that's such a spelling, before a western family name: greeted)
    ['Tom Smith', '', 'Tom'], ['Tom Hanks', '', 'Tom'], ['Tom Brady', '', 'Tom'], ['Louis Armstrong', '', 'Louis'], ['Louie Anderson', '', 'Louie'], ['Tom Smith', 'Tom', 'Tom'],
    // (a spelling that's a given name's syllable too never beats that shape, so no name is greeted because of one)
    ['Tung Do Jiu', '', ''], ['Tung Do Jue', '', ''], ['Tung Jiu', '', ''], ['Kai Jue', '', ''],
  ]);
  assert.equal(typeof G.taishanSpelt, 'function', 'the Chinese American spellings by rule (round 27)');
  for (const [r, want] of [['tam', ['tom', 'tum']], ['ham', ['hom', 'hum']], ['lui', ['louie', 'louis']], ['lau', ['low', 'lew']], ['ji', ['jee', 'gee']], ['yi', ['yee']],
    ['moi', ['moy']], ['toi', ['toy']], ['ma', ['mah', 'mar']], ['chin', ['chinn']], ['wu', ['woo']], ['kwan', ['quan']], ['jeng', ['jeong']], ['jau', ['jow', 'jew']], ['dai', ['day']]]) {
    const got = G.taishanSpelt(r);
    for (const x of want) assert.ok(got.includes(x), `${r}: ${x}`);
  }
  const chinese = new Set(G.markedNames().familyNamesOf.chinese.map(G.nameKey));
  const missing = words('Tom Hom Louie Louis Lew Low Gee Yee Fong Dong Quan Jeong Jung Chin Chinn Lum Moy Mar Mah Toy Woo Jow Jew Eng Ng Wong Seto Szeto Soohoo Owyang Der Hoe Jang Gong Gum Kwok Gock Yip Yep Look Mock Mack Doo Day Chew Hew Lowe')
    .filter((w) => w !== 'Lowe' && !chinese.has(G.nameKey(w)));
  assert.deepEqual(missing, [], 'a common Chinese American spelling the lists don\'t have');
});

// ─── Finding 4: the US military, whole ──

test('finding 4: the academies by name and letters, ROTC and JROTC, the bases, the veterans\' groups, the JAG, the Seabees and "Ret" without its period are known: never greeted after a given name', () => {
  const tails = ['USNA', 'USMA', 'USAFA', 'USCGA', 'USMMA', 'West Point', 'Annapolis', 'ROTC', 'JROTC', 'NROTC', 'AFROTC', 'Army ROTC', 'Air Force ROTC', 'Fort Bragg', 'Fort Liberty',
    'Fort Hood', 'Fort Cavazos', 'Fort Campbell', 'Fort Knox', 'Fort Moore', 'Ft. Benning', 'Camp Lejeune', 'Camp Pendleton', 'Robins AFB', 'Moody Air Force Base', 'Dobbins ARB',
    'Naval Station Norfolk', 'Joint Base San Antonio', 'MCAS Miramar', 'Naval Air Station Pensacola', 'Quantico', 'Pentagon', 'The Pentagon', 'The Citadel', 'Citadel', 'VMI',
    'VFW', 'DAV', 'AMVETS', 'VVA', 'American Legion', 'USO', 'Wounded Warrior', 'Gold Star', 'Blue Star', 'JAG', 'Navy JAG', 'Army JAG', 'JAG Corps', 'Seabees', 'Navy Seabees',
    'Ret', 'Retd', "Ret'd", 'Reservist', 'Reserves', 'Navy Reserves', 'Airborne', 'Rangers', 'SEALs', 'Marine Veteran', 'Disabled Veteran', 'Navy Vet', 'Delta Force'];
  const bad = [];
  for (const t of tails) for (const f of ['Hope', 'Grace', 'Joy', 'Faith', 'Jordan']) if (F.greetName({ fullName: `${f} ${t}` })) bad.push(`${f} ${t}`);
  assert.deepEqual(bad, []);
  say([['Hope USNA', '', ''], ['Grace VFW', '', ''], ['Joy ROTC', '', ''], ['Hope Fort Bragg', '', ''],
    // (the controls: a family name, a word that's no base)
    ['Jordan Fort', '', 'Jordan'], ['Mary Beth Camp', '', 'Mary Beth'], ['Jordan Camp Smith', '', 'Jordan'], ['Hope Seals', '', 'Hope'], ['Jordan Ang', '', 'Jordan']]);
});

test('finding 4: Add reads them as the military, in both orders: the address the name\'s alone, People\'s name "Jordan Ames" after a comma', () => {
  const tails = ['USNA', 'VFW', 'US Army Retd', "US Army Ret'd", 'Marine Veteran', 'Navy JAG', 'JAG Corps', 'Navy Nurse Corps', 'Disabled Veteran', 'Fort Bragg', 'Camp Lejeune',
    'Robins AFB', 'Naval Station Norfolk', 'Seabees', 'ROTC', 'JROTC', 'West Point', 'Gold Star Mother', 'American Legion', 'Veterans of Foreign Wars', 'Col. USAF Ret.', 'LTC US Army'];
  const bad = [];
  for (const t of tails) {
    const got = [addressOf(`Jordan Ames ${t}`), addressOf(`Ames, Jordan ${t}`), shownOf(`Ames, Jordan ${t}`)];
    if (JSON.stringify(got) !== JSON.stringify(['jordan-ames', 'jordan-ames', 'Jordan Ames'])) bad.push(`${t}: ${JSON.stringify(got)}`);
  }
  assert.deepEqual(bad, []);
  // (a family name that's a base's own word stays the name's: "Mary Beth Camp", "Jordan Camp Smith")
  for (const n of ['Mary Beth Camp', 'Jordan Camp Smith', 'Jordan Ann Fort', 'Mary Beth Seals']) assert.equal(addressOf(n), slugOf(n), n);
});

test('finding 4: one list of ranks, every branch\'s and their abbreviations, read the same way by the greeting and by Add: a rank the greeting sets apart, Add sets apart too', () => {
  for (const [n, a] of [['Adm. Jordan Ames', 'jordan-ames'], ['Cmdr. Jordan Ames', 'jordan-ames'], ['LTC Jordan Ames', 'jordan-ames'], ['Major Jordan Ames', 'jordan-ames'],
    ['General Jordan Ames', 'jordan-ames'], ['Commander Jordan Ames', 'jordan-ames']]) assert.equal(addressOf(n), a, n);
  assert.equal(typeof F.rankLists, 'function', 'the ranks (round 27)');
  const { ranks, phrases } = F.rankLists();
  for (const r of ['adm', 'cmdr', 'ltc', 'cpt', '=mg', '=bg', '~major', 'general', 'commander', 'sfc', 'ssg', 'pvt', 'pfc', 'ens', 'ltjg', 'radm', 'vadm', 'cwo', 'amn', 'sra']) assert.ok(ranks.includes(r), r);
  for (const p of ['lieutenant colonel', 'rear admiral', 'master sergeant', 'chief petty officer', 'lt col', 'staff sgt']) assert.ok(phrases.includes(p), p);
  const bad = [];
  const forms = [...ranks.map((r) => r.replace(/^[=~]/, '')).flatMap((r) => [r, `${r.charAt(0).toUpperCase()}${r.slice(1)}.`, r.toUpperCase()]), ...phrases.map((p) => p.split(' ').map((x) => `${x.charAt(0).toUpperCase()}${x.slice(1)}`).join(' '))];
  for (const r of forms) {
    const n = `${r} Jordan Ames`;
    if (F.greetName({ fullName: n }) === 'Jordan' && addressOf(n) !== 'jordan-ames') bad.push(`${n}: greeted Jordan, at ${addressOf(n)}`);
  }
  assert.deepEqual(bad, []);
  say([['Adm. Jordan Ames', '', 'Jordan'], ['Cmdr. Jordan Ames', '', 'Jordan'], ['Col. Jordan Ames', '', 'Jordan'], ['Lt. Col. Jordan Ames', '', 'Jordan'], ['LTC Jordan Ames', '', 'Jordan'],
    ['CPT Jordan Ames', '', 'Jordan'], ['SFC Jordan Ames', '', 'Jordan'], ['Major Jordan Ames', '', 'Jordan'], ['General Jordan Ames', '', 'Jordan'], ['Commander Jordan Ames', '', 'Jordan'],
    ['Rear Admiral Jordan Ames', '', 'Jordan'], ['Master Sgt. Jordan Ames', '', 'Jordan'],
    // (one that's a name or initials too: no name, as before)
    ['MG Jordan Ames', '', ''], ['GEN Jordan Ames', '', ''], ['Gen Tanaka', '', ''], ['Major Harris', '', ''], ['Major Lee Smith', '', '']]);
  for (const [n, a] of [['Adm. Jordan Ames', 'jordan-ames'], ['MG Jordan Ames', 'jordan-ames'], ['Major Harris', 'major-harris'], ['Gen Tanaka', 'gen-tanaka'], ['Jordan Ames LTC', 'jordan-ames'],
    ['Ames, Jordan LTC', 'jordan-ames'], ['Jordan Ames Col. USAF Ret.', 'jordan-ames'], ['LTC Jordan Ames USA Ret.', 'jordan-ames']]) assert.equal(addressOf(n), a, n);
});

test('finding 4: through Add, every rank before or after the name is offered as Jordan Ames, at jordan-ames-2', () => withFakes(async () => {
  const w = await addWorld();
  await w.addNew(await w.applied('Jordan Ames'));
  const bad = [];
  for (const n of ['Adm. Jordan Ames', 'Cmdr. Jordan Ames', 'Col. Jordan Ames', 'Lt. Col. Jordan Ames', 'LTC Jordan Ames', 'MG Jordan Ames', 'CPT Jordan Ames', 'Major Jordan Ames',
    'General Jordan Ames', 'Commander Jordan Ames', 'LTC Jordan Ames USA Ret.', 'Jordan Ames Col. USAF Ret.', 'Ames, Jordan LTC', 'Jordan Ames USNA', 'Ames, Jordan VFW',
    'Jordan Ames US Army Retd', "Jordan Ames US Army Ret'd", 'Jordan Ames Marine Veteran', 'Jordan Ames Navy JAG']) {
    const p = await w.plan((await w.applied(n)).id);
    if (JSON.stringify([p.kind, p.person?.slug, p.slug]) !== JSON.stringify(['choose', 'jordan-ames', 'jordan-ames-2'])) bad.push(`${n}: ${JSON.stringify([p.kind, p.person?.slug, p.slug])}`);
  }
  assert.deepEqual(bad, []);
}));

// ─── Finding 5: official names in their own languages ──

const keyOf = (c) => c.split(/\s+/).map((w) => (w === '&' ? 'and' : G.nameKey(w).replace(/[^\p{L}\p{N}]+/gu, ''))).filter(Boolean).join(' ');
const known = () => {
  const L = F.placeLists();
  const all = new Set([...L.anywhere, ...L.named, ...L.never, ...L.phrases]);
  return { has: (k) => all.has(k) || (k.startsWith('the ') && all.has(k.slice(4))) || all.has(k.replace(/ /g, '')) };
};
const NAMED = new Set(R26_DECIDED.map(keyOf));
const readWhole = (c) => [F.greetName({ fullName: `Jordan ${c}` }), F.greetName({ fullName: `Hope ${c}` }), addressOf(`Jordan Ames ${c}`), addressOf(`Ames, Jordan ${c}`), shownOf(`Ames, Jordan ${c}`)];
const WHOLE = JSON.stringify(['', '', 'jordan-ames', 'jordan-ames', 'Jordan Ames']);

test('finding 5: every UN member\'s and observer state\'s official name in each of its official languages is known, with its accents and without, and read whole on every path', () => {
  assert.ok(R27_OFFICIAL.length >= 230, 'the official names in their own languages');
  const plainOf = (c) => c.normalize('NFKD').replace(/\p{M}/gu, '');
  const K = known();
  assert.deepEqual([...R27_OFFICIAL, ...R27_OFFICIAL.map(plainOf)].filter((c) => !K.has(keyOf(c)) && !NAMED.has(keyOf(c))), [], 'an official name the lists don\'t know');
  const bad = [];
  for (const c of [...new Set([...R27_OFFICIAL, ...R27_OFFICIAL.map(plainOf)])]) if (JSON.stringify(readWhole(c)) !== WHOLE) bad.push(`${c}: ${JSON.stringify(readWhole(c))}`);
  assert.deepEqual(bad, []);
});

test('finding 5: the common own-language and neighbouring-language short forms ("Estados Unidos", "États-Unis", "Reino Unido"), and the tester\'s own lists, are known and read whole, apart from the decided ones', () => {
  const K = known();
  assert.deepEqual([...R27_SHORT, ...R27_LOCAL].filter((c) => !K.has(keyOf(c)) && !NAMED.has(keyOf(c))), [], 'a form the lists don\'t know');
  const bad = [];
  for (const c of [...R27_SHORT, ...R27_LOCAL].filter((x) => !NAMED.has(keyOf(x)))) if (JSON.stringify(readWhole(c)) !== WHOLE) bad.push(`${c}: ${JSON.stringify(readWhole(c))}`);
  assert.deepEqual(bad, []);
  // (the tester's other list: every form of a UN member, territory or region read whole, apart from the decided: a family name in parts,
  // "St. Thomas", "St. John", "St. Croix"; the countries that are names, "England UK", "Wales UK"; and peoples, not places)
  const decided = new Set(['St. Croix', 'St. Thomas', 'Saint Thomas', 'St. John USVI', 'England UK', 'Wales UK', 'Ogoni', 'Yoruba Nation']);
  const also = [];
  for (const c of R27_COUNTRIES.filter((x) => !decided.has(x) && !NAMED.has(keyOf(x)))) if (JSON.stringify(readWhole(c)) !== WHOLE) also.push(`${c}: ${JSON.stringify(readWhole(c))}`);
  assert.deepEqual(also, []);
  // (the decided, as round 26 had them: a country that's a name, plain "Island", the two-comma form as typed)
  say([['Grace Jordan', '', 'Grace'], ['Ann England', '', 'Ann'], ['Chad Smith', '', 'Chad']]);
  assert.equal(addressOf('Jordan Ames Island'), 'jordan-ames-island');
  assert.equal(addressOf('Ames, Jordan, Elliniki Dimokratia'), 'ames-jordan');
});
