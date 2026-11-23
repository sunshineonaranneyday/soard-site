/**
 * Advisory Board QA round 21 (Nov 22 2026): how the public application reads a name to greet them (the thank-you, the
 * applicant's copy, the welcome and the monthly ask all greet with greetName), from the round 21 tester's findings
 * (test-results/qa21-public: x01 to x06, n01, n04, n05 W1 to W6, n06). The greeting rule from round 20 stands: greet only
 * on positive evidence; a missed name is fine, a wrong one never is. Made-up people only; nothing leaves this machine.
 * Run: node --test tests/advisory-round21-names.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ─── Major 1: no pattern on the name path backtracks ─────────────────

test('major 1: every exported name function answers in time on adversarial names at the field\'s full length (long letter runs with dots, hyphens, apostrophes, spaces and commas, ending in a digit or a symbol), run apart so a pattern that backtracks fails here instead of hanging the suite', () => {
  const child = fileURLToPath(new URL('./lib/advisory-r21-slow-names.mjs', import.meta.url));
  const LIMIT_S = 120;
  const r = spawnSync(process.execPath, [child], { encoding: 'utf8', timeout: LIMIT_S * 1000, maxBuffer: 64 * 1024 * 1024 });
  const last = String(r.stderr || '').trim().split('\n').pop();
  assert.ok(!r.error && r.signal == null, `the name functions didn't finish in ${LIMIT_S} s (stopped: ${r.signal || r.error}); the name they were on: ${last}`);
  assert.equal(r.status, 0, String(r.stderr).slice(-2000));
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.ok(out.names >= 4000 && out.calls >= 100000, `${out.names} names, ${out.calls} calls`);
  for (const f of ['greetName', 'readName', 'plainWords', 'fieldProblem', 'checkAnswers']) assert.ok(out.functions.includes(`_advisory-form.js ${f}`), f);
  for (const f of ['givenName', 'givenPair', 'familyFirst', 'titleToo', 'lettersToo', 'nameKey']) assert.ok(out.functions.includes(`_given-names.js ${f}`), f);
  assert.deepEqual(out.over, [], `calls over 100 ms: ${JSON.stringify(out.over.slice(0, 5))}`);
});

// ─── The greeting's findings ─────────────────────────────────────────

const J = 'Joanna Ames';
// Each row: [full name, preferred name, the greeting]; the applicant's copy's first line says the same
const say = async (rows) => {
  const { greetName } = await import('../functions/api/_advisory-form.js');
  const { applicantEmail } = await import('../functions/api/_advisory-applications.js');
  for (const [fullName, preferredName, want] of rows) {
    assert.equal(greetName({ fullName, preferredName }), want, `${JSON.stringify(fullName)} pref=${JSON.stringify(preferredName)}`);
    assert.equal(applicantEmail({ answers: { fullName, preferredName }, headshot: null }).text.split('\n')[0], want ? `Thank you, ${want}.` : 'Thank you.', fullName);
  }
};

test('major 2: after a woman\'s courtesy title (Mrs, Ms, Miss, Madame, Frau, Señora, Signora and the like, any capitals, with or without the dot) the next word is greeted only when it\'s a woman\'s name or one women go by as often; a wife written by her husband\'s name is no name, and the name she goes by still wins', () => say([
  // (the tester's W1 rows)
  ['Mrs. John Ames', '', ''], ['Mrs John Ames', '', ''], ['MRS. JOHN AMES', '', ''], ['mrs john ames', '', ''], ['Mrs. John A. Ames', '', ''],
  ['Mrs. William Grant III', '', ''], ['Mrs. Robert E. Lee', '', ''], ['Mrs. Thomas Rowe, Jr.', '', ''], ['Madame Jean Dupont', '', ''], ['Frau Hans Müller', '', ''],
  ['Ms. John Ames', '', ''], ['Mrs. John Ames Jr.', '', ''], ['Mrs. Charles Quill', '', ''], ['Mrs. Henry Ames Sr.', '', ''], ['Mrs. James Earl Rowe', '', ''],
  ['Señora Juan Ames', '', ''], ['Sra. José García', '', ''], ['Doña Juan Pérez', '', ''], ['Mme Jean-Pierre Dupont', '', ''], ['Signora Marco Rossi', '', ''], ['Lady John Smith', '', ''],
  // (a woman's name in one place and a man's in another is no evidence: Jean, Andrea, Simone, Ali)
  ['Mrs. Jean Ames', '', ''], ['Signora Andrea Rossi', '', ''], ['Mrs. Ali Hassan', '', ''], ['Mrs. Jean Marie Ames', '', ''],
  // (a woman's name, or one both go by, is hers; so is a pair of hers)
  ['Mrs. Amy Ames', '', 'Amy'], ['MRS. AMY AMES', '', 'Amy'], ['Ms Jordan Ames', '', 'Jordan'], ['Miss Taylor Rowe', '', 'Taylor'], ['Mrs. Mary Beth Rowe', '', 'Mary Beth'],
  ['Mrs. Mary-Kate Quill', '', 'Mary-Kate'], ['Mrs. Jo-Ann Ames', '', 'Jo-Ann'], ['Madame Marie-Claire Dupont', '', 'Marie-Claire'], ['Frau Ingrid Müller', '', 'Ingrid'],
  ['Señora María López', '', 'María'], ['Signora Giulia Rossi', '', 'Giulia'], ['Senhora Ana Souza', '', 'Ana'], ['Sister Mary Ames', '', 'Mary'], ['Mrs. Chioma Okafor', '', 'Chioma'],
  ['Mrs. Priya Patel', '', 'Priya'], ['Mrs. Fatima Ali', '', 'Fatima'], ['Dr. John Ames', '', 'John'], ['Mr. John Ames', '', 'John'],
  // (the name she goes by wins)
  ['Mrs. John Ames', 'Amy', 'Amy'], ['Mrs. John (Amy) Ames', '', ''],
]));

test('major 2: every name the women\'s list marks is a given name on the lists, and none it leaves out is marked', async () => {
  const { givenName, womansName, markedNames, listSizes } = await import('../functions/api/_given-names.js');
  const m = markedNames();
  assert.deepEqual(m.women.filter((w) => !givenName(w)), [], 'marked but not on the given-names list');
  assert.deepEqual(m.womenNot.filter((w) => womansName(w)), [], 'left out but marked');
  for (const w of ['Amy', 'Jordan', 'Taylor', 'María', 'Chioma', 'Priya', 'Mei', 'Yuki', 'Ngozi', 'Mary-Kate', 'Marie-Claire']) assert.ok(womansName(w), w);
  for (const w of ['John', 'William', 'Robert', 'Thomas', 'Charles', 'Hans', 'Juan', 'Jean', 'Jean-Pierre', 'Jean-Marie', 'Andrea', 'Ali', 'Jan', 'Kwame', 'Hiroshi']) assert.ok(!womansName(w), w);
  assert.ok(listSizes().women >= 1900, `${listSizes().women} women's names`);
});

test('minor 3: a family name written first that\'s a given name elsewhere (Japanese, Korean, Chinese, Cambodian), and a Hungarian name, family name first, get no name; the same names written given name first are greeted', () => say([
  // (the tester's W2 rows)
  ['Kato Yuki', '', ''], ['Katō Yuki', '', ''], ['KATO YUKI', '', ''], ['Abe Hiroshi', '', ''], ['Abe Shinzō', '', ''], ['Chong Min-ho', '', ''], ['Chong Wei Ming', '', ''],
  ['Chao Yu-ting', '', ''], ['Myung Soo-jin', '', ''], ['Sam Rainsy', '', ''], ['Simon Zoltán', '', ''], ['Balázs Péter', '', ''], ['László Gábor', '', ''],
  ['Gáspár Katalin', '', ''], ['Bogdán Eszter', '', ''], ['SIMON ZOLTÁN', '', ''], ['simon zoltán', '', ''], ['Kato Haruki', '', ''], ['Chao Wei Ming', '', ''], ['Joe Min-ji', '', ''],
  // (given name first: theirs. Sam and Joe before a name that isn't their people's own given name are Sam and Joe)
  ['Yuki Kato', '', 'Yuki'], ['Hiroshi Abe', '', 'Hiroshi'], ['Soo-jin Myung', '', 'Soo-jin'], ['Min-ji Chong', '', 'Min-ji'], ['Zoltán Simon', '', 'Zoltán'], ['Péter Balázs', '', ''], ['Sam Rowe', '', 'Sam'],
  ['Sam Lee', '', 'Sam'], ['Joe Min', '', '' /* r22: the lead's rule for finding 2, a family name written first before a given name of its own people's (Min is Korean's) is no name even when that given name is a family name too, as "Ming Wei" is */], ['Joe Rowe', '', 'Joe'], ['Eva Gabor', '', 'Eva'], ['Maria Gaspar', '', 'Maria'], ['Ana Bogdan', '', 'Ana'], ['Peter Balazs', '', ''],
]));

test('minor 3: title words: "Ida Bagus" and "Ida Ayu" (Balinese) are no name; Malik, Earl, Rana and Sai are greeted only in the plain shape of two words, never with three or more', () => say([
  // (the tester's W3 rows)
  ['Malik Riaz Hussain', '', ''], ['Ida Bagus Mantra', '', ''], ['Ida Ayu Putri', '', ''], ['Earl Jordan Ames', '', ''], ['Malik Muhammad Ahmed', '', ''],
  ['Rana Sanaullah Khan', '', ''], ['Sai Mauk Kham', '', ''], ['IDA BAGUS MANTRA', '', ''], ['Earl A. Ames', '', ''],
  // (two words: their name)
  ['Malik Jones', '', 'Malik'], ['Earl Smith', '', 'Earl'], ['Earl Smith Jr.', '', 'Earl'], ['Rana Ahmed', '', 'Rana'], ['Ida Ames', '', 'Ida'], ['Ida Bagus', '', ''],
  [J, 'Malik', 'Malik'], [J, 'Earl', 'Earl'],
]));

test('minor 4: two given names people go by together, on the pairs list, before a family name are greeted whole, as the name they go by already is', async () => {
  // (the tester's n04 list and W4 rows)
  await say([
    ['Mary Beth Rowe', '', 'Mary Beth'], ['Mary Kate Ames', '', 'Mary Kate'], ['Anna Grace Rowe', '', 'Anna Grace'], ['Sarah Jane Ames', '', 'Sarah Jane'],
    ['Billy Bob Thornton', '', 'Billy Bob'], ['Billy Ray Cyrus', '', 'Billy Ray'], ['Juan Carlos Pérez', '', 'Juan Carlos'], ['José Luis Ames', '', 'José Luis'],
    ['Jean Paul Ames', '', 'Jean Paul'], ['Jean Pierre Dupont', '', 'Jean Pierre'], ['Marie Claire Dupont', '', 'Marie Claire'], ['Anne Marie Ames', '', 'Anne Marie'],
    ['Mary Ann Smith', '', 'Mary Ann'], ['Peggy Sue Ames', '', 'Peggy Sue'], ['Ella Mae Rowe', '', 'Ella Mae'], ['John Paul Ames', '', 'John Paul'],
    ['Thanh Huong Ames', '', 'Thanh Huong'], ['MARY BETH ROWE', '', 'Mary Beth'], ['mary beth rowe', '', 'Mary Beth'], ['Mary Beth Ames, PhD', '', 'Mary Beth'],
    ['Dr. Mary Beth Ames', '', 'Mary Beth'], ['Soo Jin Park', '', 'Soo Jin'],
    // (as the name they go by)
    ['Mary Beth Rowe', 'Mary Beth', 'Mary Beth'], ['Jean Paul Ames', 'Jean Paul', 'Jean Paul'],
    // (two words alone are a given name and a family name; a given name and one that isn't a pair, the first; a family name first, none)
    ['Mary Beth', '', 'Mary'], ['Juan Carlos', '', 'Juan'], ['Katie Harrison Smith', '', 'Katie'], ['Mary A. Rowe', '', 'Mary'], ['Mei Ling Ames', '', ''], ['Kim Anh Nguyen', '', ''],
  ]);
});

test('minor 5: a preferred name that\'s one of the full name\'s family-name words is set aside whatever shape the full name has (a comma, pronouns, letters after, a job, a couple, a title, "Family")', () => say([
  // (the tester's W5 rows: set aside, and the full name read instead)
  ['Grant, Jordan', 'Grant', ''], ['Jordan Grant (she/her)', 'Grant', ''], ['Jordan Grant, Realtor', 'Grant', ''], ['Jordan Ames-Grant', 'Grant', 'Jordan'],
  ['Jordan Grant-Ames', 'Grant', 'Jordan'], ['Jordan Grant & Amy Rowe', 'Grant', ''], ['Mr. Grant', 'Grant', ''], ['Grant Family', 'Grant', ''], ['Jordan Grant, PhD', 'Grant', 'Jordan'],
  ['Dr. Jordan Grant', 'Grant', 'Jordan'], ['Jordan A. Grant', 'Grant', 'Jordan'], ['Jordan Grant Jr.', 'Grant', 'Jordan'], ['JORDAN GRANT', 'grant', 'Jordan'],
  ['De La Cruz, Maria', 'Cruz', ''], ['GRANT, JORDAN', 'Grant', ''],
  // (their given name, or a middle name they go by, is theirs)
  ['Ames, Jordan', 'Jordan', 'Jordan'], ['Jordan Grant, Realtor', 'Jordan', 'Jordan'], ['Jordan Grant (she/her)', 'Jordan', 'Jordan'], ['Garcia Lopez, Maria', 'Maria', 'Maria'],
  ['Jordan Grant Ames', 'Grant', 'Grant'], ['Mrs. John Ames', 'Amy', 'Amy'], ['Grant', 'Grant', 'Grant'], ['Mary Beth Rowe', 'Beth', 'Beth'],
]));

test('minor 7: a word that\'s never a family name and marks a place or an organization (Springs, Hospital, Lutheran, Garden, a state) makes the full name no name; one that\'s a family name too (Park, Stanley, Lee) doesn\'t', () => say([
  // (the tester's W6 rows and its n01 places)
  ['Sandy Springs', '', ''], ['Holly Springs', '', ''], ['Mercy Hospital', '', ''], ['Trinity Lutheran', '', ''], ['Olive Garden', '', ''], ['Rose Garden', '', ''],
  ['Chase Manhattan', '', ''], ['Austin Texas', '', ''], ['Jackson Mississippi', '', ''], ['Lincoln Nebraska', '', ''], ['Madison Wisconsin', '', ''],
  ['Charlotte North Carolina', '', ''], ['Ivy League', '', ''], ['Grace Methodist', '', ''], ['Hope Academy', '', ''], ['Faith Bank', '', ''], ['Joy Restaurant', '', ''],
  ['Victoria Gardens', '', ''], ['Destiny Church', '', ''], ['Grace Presbyterian Church', '', ''],
  // (people's names)
  ['Grant Park', '', 'Grant'], ['Morgan Stanley', '', 'Morgan'], ['Robert E. Lee', '', 'Robert'], ['Jordan Park', '', 'Jordan'], ['Hunter Douglas', '', 'Hunter'], ['Edward Jones', '', 'Edward'],
]));

// ─── Minor 6: a family name of more than one word before a comma ────

test('minor 6: a name with more than one word before the comma and a given name after it ("Family, Given") has every word in its address, in the order typed; with anything else after the comma, the words before it; its People name stays as typed either way', async () => {
  const { readName } = await import('../functions/api/_advisory-form.js');
  for (const [n, address, shown] of [['De La Cruz, Maria', 'De La Cruz Maria', 'De La Cruz, Maria'], ['Garcia Lopez, Ana', 'Garcia Lopez Ana', 'Garcia Lopez, Ana'],
    ['van der Berg, Jan', 'van der Berg Jan', 'van der Berg, Jan'], ['De La Cruz, Maria PhD', 'De La Cruz Maria', 'De La Cruz, Maria PhD'], ['Garcia Lopez, Maria & Jose', 'Garcia Lopez Maria Jose', 'Garcia Lopez, Maria & Jose'],
    ['van der Berg, Mary Beth', 'van der Berg Mary Beth', 'van der Berg, Mary Beth'], ['DE LA CRUZ, MARIA', 'DE LA CRUZ MARIA', 'DE LA CRUZ, MARIA'],
    // (the lead, Nov 22 2026: only the "Family, Given" shape, a given name or a pair first after the comma; pronouns, a place,
    // a company after it, the words before it alone, as round 20 had them)
    ['Jordan Ames, she/her', 'Jordan Ames', 'Jordan Ames, she/her'], ['Jordan Ames, Atlanta', 'Jordan Ames', 'Jordan Ames, Atlanta'], ['Del Rey, Compass', 'Del Rey', 'Del Rey, Compass'],
    ['Jordan Quill, McKinsey', 'Jordan Quill', 'Jordan Quill, McKinsey'], ['Van Jones, Dream Corps', 'Van Jones', 'Van Jones, Dream Corps']]) {
    const r = readName(n);
    assert.equal((r.address || r.words).join(' '), address, `${n}: the address, as Add makes it`);
    assert.equal(r.shown, shown, n);
    assert.equal(r.sure, false, `${n}: nothing says which is the first name`);
  }
  // (one family name before the comma is put first name first, as round 20 has it)
  assert.deepEqual([readName('Ames, Jordan').words, readName('Ames, Jordan').shown], [['Jordan', 'Ames'], 'Jordan Ames']);
});

test('minor 6: Add compares the whole name, so a relative written the same way is never offered as the same person, while the same person written either way still is; each new one at the address of all of their name', async () => {
  const sharp = (await import('sharp')).default;
  const { createD1 } = await import('./lib/d1-shim.mjs');
  const { readHeadshot, submitApplication } = await import('../functions/api/_advisory-applications.js');
  const adminApi = await import('../functions/api/advisory-applications-admin.js');
  const jpg = new Uint8Array(await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#c4aa8c' } }).jpeg().toBuffer());
  const shot = (await readHeadshot(new File([jpg], 'h.jpg', { type: 'image/jpeg' }))).headshot;
  const env = { DB: await createD1(), CF_ACCOUNT_ID: 'acct', CF_IMAGES_TOKEN: 't', RESEND_API_KEY: 'r' };
  await env.DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.pathname.includes('/images/v1') && init.method === 'POST') { const id = init.body.get('id'); return Response.json({ success: true, result: { id, variants: [`https://imagedelivery.net/x/${id}/public`] } }); }
    if (url.host === 'api.resend.com') { const b = [JSON.parse(init.body)].flat(); return Response.json({ data: b.map((_, i) => ({ id: `e${i}` })) }); }
    throw new Error(`no route for ${url.href}`);
  };
  try {
    const BASE = { phone: '(770) 555-0142', heardFrom: 'A friend', why: 'To help.', connection: 'Neighbors.', involved: 'No', strengths: 'Events.', fundraising: 'A match.',
      introductions: 'Yes', networks: 'No', conflict: 'No', hostEvent: 'No', meetings: 'Yes', ambassador: 'Yes', refName: 'Sam Lee', refRelationship: 'Former manager', refEmail: 'sam@example.org', acknowledge: true };
    let k = 0;
    const applied = async (fullName) => (await submitApplication(env, { ...BASE, fullName, email: `r21.${++k}@example.org`, signature: fullName }, { headshot: shot })).app;
    const ctx = (method, body, query = '') => ({ env, request: new Request(`https://site.test/api/advisory-applications-admin${query}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), data: { userEmail: 'linzi@soardcharity.com' }, waitUntil: () => {} });
    const plan = async (id) => (await (await adminApi.onRequestGet(ctx('GET', undefined, `?plan=${id}`))).json()).plan;
    const addNew = async (app) => { const p = await plan(app.id); const r = await (await adminApi.onRequestPost(ctx('POST', { add: { id: app.id, as: 'new', seen: p.key } }))).json(); assert.equal(r.success, true, r.error); return p; };
    const among = (p) => [p.person?.slug, ...(p.others || []).map((o) => o.slug)].filter(Boolean);
    // (the tester's n06 pairs: the first added, then the second planned)
    for (const [first, second, firstSlug, secondSlug] of [['De La Cruz, Maria', 'De La Cruz, Jose', 'de-la-cruz-maria', 'de-la-cruz-jose'], ['Garcia Lopez, Maria', 'Garcia Lopez, Ana', 'garcia-lopez-maria', 'garcia-lopez-ana'],
      ['van der Berg, Jan', 'van der Berg, Pieter', 'van-der-berg-jan', 'van-der-berg-pieter']]) {
      const a = await addNew(await applied(first));
      assert.deepEqual([a.kind, a.slug, a.asName || first], ['new', firstSlug, first], first);
      const b = await plan((await applied(second)).id);
      assert.deepEqual([b.kind, b.slug, among(b)], ['new', secondSlug, []], `${second}: never offered ${first}`);
    }
    // (a given name the list doesn't have after the comma: the address is the words before it, and still never offered as
    // the relative: "Piet" isn't on the list)
    const piet = await plan((await applied('van der Berg, Piet')).id);
    assert.deepEqual([piet.kind, piet.slug, among(piet)], ['new', 'van-der-berg-piet' /* r23: rule 7, a particle proves a family name: Piet, off the list, is still the given name, in the address */, []], 'van der Berg, Piet');
    // (the same person written the other way round is asked about, both ways)
    const back = await plan((await applied('Maria De La Cruz')).id);
    assert.deepEqual([back.kind, among(back)], ['choose', ['de-la-cruz-maria']]);
    const again = await plan((await applied('De La Cruz, Maria')).id);
    assert.deepEqual([again.kind, among(again)], ['choose', ['de-la-cruz-maria']]);
    // (and the words before the comma alone are still asked about the person they are, a company after them: round 15)
    await addNew(await applied('Del Taylor'));
    const co = await plan((await applied('Del Taylor, Compass')).id);
    assert.deepEqual([co.kind, among(co)], ['choose', ['del-taylor']]);
  } finally {
    globalThis.fetch = realFetch;
  }
});
