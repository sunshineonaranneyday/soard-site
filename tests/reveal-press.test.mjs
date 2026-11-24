/**
 * The press release: drafted in the sender's own Gmail when JobTread confirms a reveal, the press list in Bcc,
 * kept in step with JobTread while nobody has touched it, and the sender told by email. Real module on an
 * in-memory D1; Google, Gmail, Workers AI and Resend faked. Made-up people only (the repo is public).
 *
 *   node --test tests/reveal-press.test.mjs
 */
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createD1 } from './lib/d1-shim.mjs';
import { clearTokenCache } from '../functions/api/_google-calendar.js';
import {
  pressRelease, syncPressRelease, parseList, cleanSettings, writePressSettings, readPressSettings, readPressRow, keepStory, roomPhrase,
  whatOpening, whatClosing, cityOf, pressTime, familyWord, pressStatus, PRESS_DEFAULTS, storySentences, gmailLink, childOf, ageOn,
} from '../functions/api/_reveal-press.js';
import { parseAddresses, pressStep } from '../public/admin/reveal-press.js';

const { privateKey: PEM } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const KEY = JSON.stringify({ type: 'service_account', client_email: 'site@example.iam.gserviceaccount.com', client_id: '1', project_id: 'soard-site', private_key: PEM, token_uri: 'https://oauth2.googleapis.com/token' });

const SENDER = 'linzi@soardcharity.com';
const CF = 'https://imagedelivery.net/ROYFuPmfN2vPS6mt5sCkZQ';
const KID = {
  name: 'Rowan', slug: 'rowan-test', publishStatus: 'published', age: 12, diagnosis: 'Spinal Muscular Atrophy', roomTypes: ['Accessible Bathroom'],
  heroImage: `${CF}/kids/rowan-test/hero.jpg/public`,
  heroSummary: 'Rowan has spinal muscular atrophy and uses a power wheelchair. He needs a bathroom he can get into safely.',
  bio: '<p>Rowan was born with Spinal Muscular Atrophy, which weakens his muscles. He uses a power wheelchair and loves trains.</p><p>His parents lift him into the tub every night, which is getting harder as he grows. Please donate today to help Rowan.</p>',
  photos: [{ url: `${CF}/kids/rowan-test/hero.jpg/public` }, { url: `${CF}/kids/rowan-test/a.jpg/public` }, { url: `${CF}/kids/rowan-test/b.jpg/public` }],
  sponsors: ['acme-foundation', 'example-builders'],
};
const WHO = { name: 'Rowan', slug: 'rowan-test', url: '/kids/rowan-test/' };
const JOB = '22PTestJob001';
const plan = (over = {}) => ({ action: 'upsert', confirmed: true, date: '2027-03-12', facts: { date: '2027-03-12', start: '16:00', end: '17:00', confirmed: true, address: '100 Example Way, Atlanta, GA 30301', details: 'Park on the street.', ...over } });
const LIST = 'Ross, Kaitlyn <kross@example.com>, <desk@example.org>, "Lee Park" <lee@example.net>, desk@example.org';

// ─── Fake Google: token, Gmail (drafts, messages, search, send-as), and Resend ──
let gmail; let emails; let tokens; let resendDown;
const decode = (raw) => {
  const s = Buffer.from(raw, 'base64url').toString('utf8');
  const [head] = s.split('\r\n\r\n');
  const header = (n) => head.match(new RegExp(`^${n}: (.*(?:\\r\\n .*)*)$`, 'm'))?.[1]?.replace(/\r\n /g, '') || '';
  const parts = [...s.matchAll(/Content-Type: text\/(plain|html); charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--/g)]
    .map((m) => [m[1] === 'plain' ? 'text' : 'html', Buffer.from(m[2].replace(/\r\n/g, ''), 'base64').toString('utf8')]);
  return { from: header('From'), to: header('To'), bcc: header('Bcc'), subject: header('Subject'), ...Object.fromEntries(parts) };
};
const subjectOf = (enc) => (enc.includes('=?') ? [...enc.matchAll(/=\?UTF-8\?B\?([^?]*)\?=/g)].map((m) => Buffer.from(m[1], 'base64').toString('utf8')).join('') : enc);
let nextId = 1;
const fetchImpl = async (input, init = {}) => {
  const url = String(input);
  const method = (init.method || 'GET').toUpperCase();
  if (url === 'https://oauth2.googleapis.com/token') {
    const claims = JSON.parse(Buffer.from(new URLSearchParams(init.body).get('assertion').split('.')[1], 'base64url').toString());
    tokens.push(claims);
    if (gmail.tokenRefused) return Response.json({ error: 'unauthorized_client', error_description: 'Client is unauthorized' }, { status: 401 });
    return Response.json({ access_token: `tok-${claims.sub}`, expires_in: 3600 });
  }
  const G = 'https://gmail.googleapis.com/gmail/v1/users/me';
  if (!url.startsWith(G)) throw new Error(`unexpected ${method} ${url}`);
  const path = url.slice(G.length);
  gmail.calls.push(`${method} ${path.split('?')[0]}`);
  if (gmail.down) return Response.json({ error: { message: 'Backend Error' } }, { status: 500 });
  if (path === '/settings/sendAs') return Response.json({ sendAs: [{ sendAsEmail: SENDER, displayName: 'Linzi Example', signature: '<div>Linzi Example<br>Director of Operations</div>', isDefault: true }] });
  if (path.startsWith('/drafts?')) {
    const q = new URL(`https://x${path}`).searchParams.get('q');
    const hit = [...gmail.drafts.values()].find((d) => q.includes(subjectOf(decode(d.message.raw).subject).replace(/"/g, '')));
    return Response.json(hit ? { drafts: [{ id: hit.id, message: { id: hit.message.id } }] } : {});
  }
  if (path === '/drafts' && method === 'POST') {
    const body = JSON.parse(init.body);
    const d = { id: `d${nextId++}`, message: { id: `m${nextId++}`, raw: body.message.raw } };
    gmail.drafts.set(d.id, d);
    return Response.json({ id: d.id, message: { id: d.message.id } });
  }
  const dm = path.match(/^\/drafts\/([^?]+)/);
  if (dm) {
    const d = gmail.drafts.get(decodeURIComponent(dm[1]));
    if (!d) return Response.json({ error: { message: 'Not Found' } }, { status: 404 });
    if (method === 'PUT') {
      const body = JSON.parse(init.body);
      d.message = { id: `m${nextId++}`, raw: body.message.raw };
      return Response.json({ id: d.id, message: { id: d.message.id } });
    }
    return Response.json({ id: d.id, message: { id: d.message.id } });
  }
  if (path.startsWith('/messages?')) {
    gmail.searches.push(new URL(`https://x${path}`).searchParams.get('q'));
    return Response.json(gmail.sentFound ? { messages: [{ id: gmail.sentFound }] } : {});
  }
  const mm = path.match(/^\/messages\/([^?]+)/);
  if (mm) {
    const m = gmail.messages.get(decodeURIComponent(mm[1]));
    return m ? Response.json(m) : Response.json({ error: { message: 'Not Found' } }, { status: 404 });
  }
  throw new Error(`unexpected Gmail ${method} ${path}`);
};
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(typeof input === 'string' ? input : input.url);
  if (url.startsWith('https://api.resend.com/emails/batch')) {
    if (resendDown) return new Response('down', { status: 500 });
    const body = JSON.parse(init.body);
    for (const e of body) emails.push(e);
    return Response.json({ data: body.map((_, i) => ({ id: `re_${emails.length}_${i}` })) });
  }
  if (/slack/.test(url)) throw new Error('Slack was called: the sender hears by email only');
  return fetchImpl(input, init);
};
after(() => { globalThis.fetch = realFetch; });

/** What Linzi does in Gmail */
const only = () => [...gmail.drafts.values()][0];
const draftMail = () => decode(only().message.raw);
const editInGmail = () => { only().message = { ...only().message, id: `m${nextId++}` }; };
const sendFromGmail = (keepId = true) => {
  const d = only();
  gmail.drafts.delete(d.id);
  const m = decode(d.message.raw);
  const id = keepId ? d.message.id : `m${nextId++}`;
  gmail.messages.set(id, { id, labelIds: ['SENT'], internalDate: String(Date.parse('2027-03-01T15:00:00Z')), payload: { headers: [{ name: 'To', value: m.to }, { name: 'Bcc', value: m.bcc }] } });
  if (!keepId) gmail.sentFound = id;
};

let env;
let aiCalls;
beforeEach(async () => {
  clearTokenCache();
  gmail = { drafts: new Map(), messages: new Map(), calls: [], searches: [], sentFound: null };
  emails = []; tokens = []; resendDown = false; aiCalls = 0;
  const DB = await createD1({ schemaFiles: ['scripts/schema.sql'] });
  await DB.prepare('INSERT INTO kids (slug, name, year, status, data) VALUES (?, ?, ?, ?, ?)').bind(KID.slug, KID.name, 2027, 'in-progress', JSON.stringify(KID)).run();
  for (const [slug, name] of [['acme-foundation', 'Acme Foundation'], ['example-builders', 'Example Builders']]) {
    await DB.prepare('INSERT INTO partners (slug, name, data) VALUES (?, ?, ?)').bind(slug, name, JSON.stringify({ name })).run();
  }
  await DB.prepare("INSERT INTO site_config (key, data) VALUES ('settings', ?)").bind(JSON.stringify({ phone: '(555) 010-0000', address: { city: 'Roswell' } })).run();
  env = { DB, GOOGLE_CALENDAR_KEY: KEY, RESEND_API_KEY: 're_test' };
  await writePressSettings(DB, { list: LIST });
});
const sync = (p = plan(), extra = {}) => syncPressRelease(env, { jobId: JOB, plan: p, who: WHO, room: 'Bathroom', fetchImpl, ...extra });

// ─── The press release ───────────────────────────────────────────────────

test('the press release: Linzi’s layout, filled in from JobTread and the kid’s page', () => {
  const m = pressRelease({
    kid: KID, room: 'Bathroom', date: '2027-03-12', time: '16:00', address: '100 Example Way, Atlanta, GA 30301, USA', details: 'Park on the street.\nCome to the side door.',
    story: 'Rowan uses a power wheelchair.', sponsors: ['Acme Foundation', 'Example Builders'], contact: { name: 'Linzi Example', title: 'Director of Operations & Development', email: SENDER, phone: '(555) 010-0000' },
    signature: '<div>sig</div>',
  });
  assert.equal(m.subject, 'Press Release: Sunshine on a Ranney Day Unveiling for Rowan’s Accessible Bathroom');
  const order = ['PRESS RELEASE', 'FOR IMMEDIATE RELEASE', 'Unveiling for Rowan’s Accessible Bathroom', 'WHAT:', 'WHEN:', 'WHERE:', 'WHY:', 'MEDIA AVAILABILITY:', 'ABOUT SUNSHINE ON A RANNEY DAY:', 'Media Contact:'];
  let at = -1;
  for (const s of order) { const i = m.html.indexOf(s.replace(/&/g, '&amp;')); assert.ok(i > at, `${s} in order`); at = i; }
  assert.match(m.text, /Sunshine on a Ranney Day, a charity based in Roswell, will unveil a custom wheelchair-accessible bathroom for 12-year-old Rowan and his family on Friday, March 12, at 4:00 p\.m\. in Atlanta\. Rowan uses a power wheelchair\. The project, at no cost to the family, was made possible by generous support from Acme Foundation and Example Builders\./);
  assert.match(m.text, /Reveal: Friday, March 12, at 4:00 p\.m\./);
  assert.match(m.text, /100 Example Way, Atlanta, GA 30301\nPark on the street\.\nCome to the side door\./, 'the address without “USA”, then JobTread’s notes');
  assert.match(m.text, /Interviews available with:\n– Rowan’s parents/);
  assert.match(m.html, /brand-logo-circle-tagline-display/, 'the official circle logo with the tagline');
  assert.match(m.html, /kids\/rowan-test\/hero\.jpg\/w=640[^"]*"[\s\S]*kids\/rowan-test\/a\.jpg\/w=640/, 'two of the kid’s photos, the hero first');
  assert.match(m.html, /href="[^"]*hero\.jpg\/w=2400/, 'each links to a full-size copy for the press');
  assert.equal((m.html.match(/hero\.jpg\/w=640/g) || []).length, 1, 'the hero isn’t shown twice');
  assert.match(m.html, /<div class="gmail_signature"><div>sig<\/div><\/div>$/, 'her Gmail signature last');
  assert.match(m.html, /mailto:linzi@soardcharity\.com/);
  assert.ok(!/—/.test(m.html + m.text + m.subject), 'no em dashes');
});

test('the press release before JobTread confirms a time, and words that can’t break out of it', () => {
  const m = pressRelease({ kid: { ...KID, name: '<b>Ro</b>' }, date: '2027-03-12', time: null, address: '<script>x</script>', details: '<img src=x onerror=1>' });
  assert.match(m.text, /on Friday, March 12 \(time to be confirmed\)/);
  assert.match(m.text, /Reveal: Friday, March 12, time to be confirmed/);
  assert.ok(!m.html.includes('<script>x') && !m.html.includes('<img src=x') && !m.html.includes('<b>Ro'), 'escaped');
});

test('it’s called a press release, and what it’s called is a setting', () => {
  const m = pressRelease({ kid: KID, date: '2027-03-12', time: '16:00' });
  assert.match(m.subject, /^Press Release: /);
  assert.match(m.text, /^PRESS RELEASE\nFOR IMMEDIATE RELEASE\n/);
  const adv = pressRelease({ kid: KID, date: '2027-03-12', time: '16:00', settings: cleanSettings({ called: 'Media Advisory' }) });
  assert.match(adv.subject, /^Media Advisory: /);
  assert.match(adv.html, />MEDIA ADVISORY</);
  assert.equal(cleanSettings({ called: '  ' }).called, 'Press Release', 'an emptied box goes back to Press Release');
});

test('the age is the one on the reveal day, from JobTread’s Birthday; his or her from its Gender', () => {
  const job = { location: { account: { customFieldValues: { nodes: [
    { value: '2011-12-02', customField: { id: '22P46syd4j6E' } }, { value: 'Male', customField: { id: '22P4VnkCXPSY' } },
  ] } } } };
  assert.deepEqual(childOf(job), { birthday: '2011-12-02', gender: 'Male' });
  assert.deepEqual(childOf({}), { birthday: null, gender: null });
  assert.equal(ageOn('2011-12-02', '2026-11-20'), 14, 'the day before a birthday');
  assert.equal(ageOn('2011-12-02', '2026-12-02'), 15, 'on the birthday');
  assert.equal(ageOn('bad', '2026-12-02'), null);
  const kid = { name: 'Max', age: 13, roomTypes: ['Accessible Bathroom'], bio: 'Her mother says she loves it.' };
  assert.match(whatOpening({ kid, date: '2026-12-03', time: '16:00', child: childOf(job) }), /for 15-year-old Max and his family/, 'JobTread over the page’s age and words');
  assert.match(whatOpening({ kid, date: '2026-12-03', time: '16:00' }), /for 13-year-old Max and her family on Thursday, December 3, at 4:00 p\.m\.$/, 'the page’s age and words without JobTread’s, and one period after “p.m.”');
});

test('the WHAT sentences: rooms, ages, families, cities, times, sponsors', () => {
  assert.equal(roomPhrase({ roomTypes: ['Dream Bedroom', 'Accessible Bathroom'] }), 'a custom dream bedroom and a wheelchair-accessible bathroom');
  assert.equal(roomPhrase({ roomTypes: ['Dream Bedroom'], bedroomCount: 2 }), 'two custom dream bedrooms');
  assert.equal(roomPhrase({ roomTypes: ['Therapy Room'] }), 'a custom in-home therapy room');
  assert.equal(roomPhrase({}, 'Bathroom'), 'a custom accessible bathroom', 'JobTread’s makeover type when the page has none');
  assert.equal(cityOf('2060 Example Dr, Atlanta, GA 30345'), 'Atlanta');
  assert.equal(cityOf('12 Main St, Lake City, Georgia 30260'), 'Lake City');
  assert.equal(cityOf(''), '');
  assert.equal(pressTime('09:30'), '9:30 a.m.');
  assert.equal(pressTime('12:00'), '12:00 p.m.');
  assert.equal(familyWord({ name: 'Remi & Nico' }), 'their family');
  assert.equal(familyWord({ name: 'Ava', bio: 'She loves art. Her room is small.' }), 'her family');
  assert.equal(familyWord({ name: 'Sam', bio: 'Sam loves art.' }), 'the family');
  assert.match(whatOpening({ kid: { name: 'Remi & Nico', age: [9, 7], roomTypes: ['Dream Bedroom'] }, date: '2027-03-12', time: '10:00', address: '' }), /for Remi & Nico and their family on Friday, March 12, at 10:00 a\.m\.\.?$/);
  assert.equal(whatClosing([]), 'The project comes at no cost to the family, made possible by Sunshine on a Ranney Day’s donors and partners.');
  assert.equal(whatClosing(['A', 'B', 'C']), 'The project, at no cost to the family, was made possible by generous support from A, B, and C.');
});

test('the AI’s sentences are kept only when they keep to the story', async () => {
  const source = `${KID.name}\n12\n${KID.diagnosis}\n${KID.bio.replace(/<[^>]+>/g, ' ')}\n${KID.heroSummary}`;
  const good = 'Rowan was born with Spinal Muscular Atrophy, which weakens his muscles. He uses a power wheelchair, and his parents lift him into the tub every night, which gets harder as he grows.';
  assert.equal(keepStory(good, { name: 'Rowan', source }), good);
  assert.equal(keepStory(good.replace('every night', 'every night at Emory'), { name: 'Rowan', source }), '', 'a place that isn’t in the story');
  assert.equal(keepStory(good.replace('every night', 'for 6 years'), { name: 'Rowan', source }), '', 'a number that isn’t in the story');
  assert.equal(keepStory(`${good} Please give today.`, { name: 'Rowan', source }), '', 'an appeal');
  assert.equal(keepStory(good.replace(/Rowan/g, 'He'), { name: 'Rowan', source }), '', 'it has to name the kid');
  assert.equal(keepStory('Rowan — a boy who uses a power wheelchair — needs a bathroom he can get into safely, his parents say, as he grows.', { name: 'Rowan', source }), 'Rowan, a boy who uses a power wheelchair, needs a bathroom he can get into safely, his parents say, as he grows.', 'em dashes become commas');

  const ai = (story) => ({ AI: { run: async () => { aiCalls++; return { response: { story } }; } } });
  assert.deepEqual(await storySentences(ai(good), KID), { story: good, by: 'ai' });
  assert.deepEqual(await storySentences(ai('Rowan, 14, loves Disney World.'), KID), { story: KID.heroSummary, by: 'page' }, 'an invented fact falls back to the page’s summary');
  assert.deepEqual(await storySentences({}, KID), { story: KID.heroSummary, by: 'page' }, 'no AI: the page’s summary');
});

test('settings that can’t be read are an error, never an empty press list', async () => {
  await assert.rejects(readPressSettings({ prepare: () => ({ bind: () => ({ first: async () => { throw new Error('D1 is down'); } }) }) }), /D1 is down/);
  await sync();
  const before = only().message.id;
  const realPrepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql) => (/FROM site_config WHERE key = \?/.test(sql) ? { bind: () => ({ first: async () => { throw new Error('D1 is down'); } }) } : realPrepare(sql));
  await assert.rejects(sync(), /D1 is down/);
  env.DB.prepare = realPrepare;
  assert.equal(only().message.id, before, 'the draft and its Bcc are untouched');
  assert.equal((draftMail().bcc.match(/@/g) || []).length, 3, 'all three still in Bcc');
});

test('the press list takes addresses as people paste them, page and server alike', () => {
  const want = [{ email: 'kross@example.com', name: 'Ross, Kaitlyn' }, { email: 'desk@example.org', name: '' }, { email: 'lee@example.net', name: 'Lee Park' }];
  assert.deepEqual(parseList(LIST), want);
  assert.deepEqual(parseAddresses(LIST), want);
  assert.deepEqual(parseList('A@Example.com\nb@example.com; mailto:c@example.com, not-an-address, a@example.com'), [{ email: 'a@example.com', name: '' }, { email: 'b@example.com', name: '' }, { email: 'c@example.com', name: '' }]);
  assert.deepEqual(parseList([{ email: 'x@example.com', name: 'X' }, 'y@example.com']), [{ email: 'x@example.com', name: 'X' }, { email: 'y@example.com', name: '' }]);
  const s = cleanSettings({ about: '   ', contactPhone: '  ', interviews: '- Rowan’s mom\n\n• A board member  ', arrival: 'x'.repeat(400) });
  assert.equal(s.about, PRESS_DEFAULTS.about, 'an emptied box goes back to the site’s words');
  assert.equal(s.contactPhone, '', 'an empty phone means SOARD’s own');
  assert.equal(s.interviews, 'Rowan’s mom\nA board member', 'one per line, without the dashes');
  assert.equal(s.arrival.length, 300);
});

// ─── In Gmail ───────────────────────────────────────────────────────

test('confirmed with a time: one draft in Linzi’s own Gmail, the press list in Bcc, and she’s emailed', async () => {
  const r = await sync();
  assert.equal(r.press, 'drafted');
  assert.equal(gmail.drafts.size, 1);
  assert.equal(tokens[0].sub, SENDER, 'as Linzi, through the site’s delegation');
  assert.equal(tokens[0].scope, 'https://www.googleapis.com/auth/gmail.modify');
  const m = draftMail();
  assert.equal(m.from, 'Linzi Example <linzi@soardcharity.com>', 'her name as her Gmail has it');
  assert.equal(m.to, 'Linzi Example <linzi@soardcharity.com>', 'to herself, so the outlets don’t see each other');
  assert.equal(m.bcc, '"Ross, Kaitlyn" <kross@example.com>, desk@example.org, Lee Park <lee@example.net>');
  assert.equal(subjectOf(m.subject), 'Press Release: Sunshine on a Ranney Day Unveiling for Rowan’s Accessible Bathroom');
  assert.match(m.html, /Director of Operations<\/div><\/div>$/, 'her Gmail signature');
  assert.match(m.text, /Linzi Example, Director of Operations & Development\nlinzi@soardcharity\.com\n\(555\) 010-0000/, 'the media contact: her, and SOARD’s phone');
  assert.match(m.text, /generous support from Acme Foundation and Example Builders/, 'the room’s sponsors from the kid’s page');
  assert.ok(!gmail.calls.some((c) => /\/(messages|drafts)\/send$/.test(c)), 'never sent by the site');
  assert.deepEqual(gmail.calls.filter((c) => !/^GET \/settings\/sendAs$/.test(c)), ['GET /drafts', 'POST /drafts'], 'only a draft is made, once none is there');

  assert.equal(emails.length, 1);
  assert.deepEqual(emails[0].to, [SENDER]);
  assert.equal(emails[0].subject, 'Rowan’s press release is in your Gmail drafts');
  assert.match(emails[0].html, /authuser=linzi%40soardcharity\.com#drafts\?compose=m\d+/, 'a button that opens the draft');
  const row = await readPressRow(env.DB, JOB);
  assert.equal(row.state, 'draft');
  assert.match(row.told, /^drafted:/);

  assert.equal((await sync()).press, 'unchanged', 'a second look changes nothing');
  assert.equal(gmail.drafts.size, 1);
  assert.equal(emails.length, 1);
});

test('not confirmed: nothing; from the admin early: drafted with the time to come, then filled in when JobTread confirms', async () => {
  const tentative = plan({ start: null, confirmed: false });
  tentative.confirmed = false;
  assert.equal((await sync(tentative)).press, 'skip');
  assert.equal(gmail.calls.length, 0, 'Gmail isn’t even asked');

  assert.equal((await sync(tentative, { early: true })).press, 'drafted');
  assert.match(draftMail().text, /time to be confirmed/);
  assert.equal(emails.at(-1).subject, 'Rowan’s press release is in your Gmail drafts');
  assert.match(emails.at(-1).text, /Hold it until JobTread confirms/);

  assert.equal((await sync()).press, 'updated');
  assert.match(draftMail().text, /at 4:00 p\.m\./);
  assert.equal(gmail.drafts.size, 1, 'the same draft');
  assert.equal(emails.at(-1).subject, 'Rowan’s press release has the new details');
});

test('a new day on an untouched draft rewrites it and tells her; a new press list rewrites it quietly', async () => {
  await sync();
  await sync(plan({ date: '2027-03-19' }));
  assert.match(draftMail().text, /Friday, March 19, at 4:00 p\.m\./);
  assert.equal(emails.length, 2);
  assert.equal(emails[1].subject, 'Rowan’s press release has the new details');
  assert.match(emails[1].text, /When: Friday, March 19, at 4:00 p\.m\./);

  await writePressSettings(env.DB, { list: 'desk@example.org, new@example.com' });
  assert.equal((await sync(plan({ date: '2027-03-19' }))).press, 'updated');
  assert.equal(draftMail().bcc, 'desk@example.org, new@example.com');
  assert.equal(emails.length, 2, 'no email for a press list change');
});

test('edited in Gmail: left as she made it, and a JobTread change reaches her once, by email', async () => {
  await sync();
  editInGmail();
  const before = only().message.id;
  assert.equal((await sync()).press, 'edited');
  assert.equal(emails.length, 1, 'her edit alone is nothing to tell her about');
  const r = await sync(plan({ start: '10:00' }));
  assert.equal(r.press, 'edited');
  assert.equal(only().message.id, before, 'never rewritten');
  assert.ok(!gmail.calls.includes('PUT /drafts/d1'));
  assert.equal(emails.at(-1).subject, 'Rowan’s reveal changed: please update your press release');
  assert.match(emails.at(-1).text, /When: Friday, March 12, at 10:00 a\.m\./);
  await sync(plan({ start: '10:00' }));
  assert.equal(emails.length, 2, 'told once');
  const st = await pressStatus(env, [JOB]);
  assert.equal(st[JOB].state, 'edited');
});

test('sent from Gmail: marked sent with how many it went to; a change after that asks her to update the press', async () => {
  await sync();
  sendFromGmail();
  const r = await sync();
  assert.equal(r.press, 'sent');
  assert.equal(r.count, 3, 'the Bcc list, not herself');
  await sync(plan({ date: '2027-03-26' }));
  assert.equal(emails.at(-1).subject, 'Rowan’s reveal changed after the press release went out');
  await sync(plan({ date: '2027-03-26' }));
  assert.equal(emails.length, 2, 'told once');
  const st = await pressStatus(env, [JOB]);
  assert.equal(st[JOB].state, 'sent');
  assert.match(st[JOB].link, /#sent\//);
});

test('a change she was told of before she sent it is no news after; the admin sees a send at once', async () => {
  await sync();
  editInGmail();
  await sync(plan({ start: '10:00' }));
  assert.equal(emails.at(-1).subject, 'Rowan’s reveal changed: please update your press release');
  sendFromGmail(false);
  const st = await pressStatus(env, [JOB], { look: true, names: { [JOB]: 'Rowan' }, fetchImpl });
  assert.equal(st[JOB].state, 'sent', 'the page’s look finds it in her Sent mail');
  await sync(plan({ start: '10:00' }));
  assert.equal(emails.length, 2, 'no “changed after it went out” for what she already had');
  await sync(plan({ start: '11:00' }));
  assert.equal(emails.at(-1).subject, 'Rowan’s reveal changed after the press release went out', 'a later change is news');
});

test('sent after she changed it is found in her Sent mail by the kid’s name; deleted is left deleted', async () => {
  await sync();
  editInGmail();
  sendFromGmail(false);
  assert.equal((await sync()).press, 'sent');
  assert.match(gmail.searches[0], /^in:sent after:\d+ subject:"Rowan" \(subject:unveiling OR subject:"press release" OR subject:advisory\)$/);

  // Another reveal: deleted in Gmail
  const other = '22PTestJob002';
  await syncPressRelease(env, { jobId: other, plan: plan(), who: WHO, fetchImpl });
  gmail.drafts.delete([...gmail.drafts.keys()].at(-1));
  gmail.sentFound = null;
  assert.equal((await syncPressRelease(env, { jobId: other, plan: plan(), who: WHO, fetchImpl })).press, 'gone');
  assert.equal((await syncPressRelease(env, { jobId: other, plan: plan({ date: '2027-04-02' }), who: WHO, fetchImpl })).press, 'skip', 'never made again by itself');
  assert.equal((await syncPressRelease(env, { jobId: other, plan: plan(), who: WHO, fetchImpl, early: true })).press, 'drafted', 'Draft it again from the admin');
});

test('JobTread says it may be off: she’s asked to hold it, once, and told when it’s back on', async () => {
  await sync();
  assert.equal((await sync(null, { hold: 'job closed' })).press, 'held');
  assert.equal(emails.at(-1).subject, 'Please hold Rowan’s press release');
  await sync(null, { hold: 'job closed' });
  assert.equal(emails.length, 2, 'once');
  await sync();
  assert.equal(emails.at(-1).subject, 'Rowan’s reveal is back on');
  assert.equal(emails.length, 3);
});

test('rehearsals, community projects, a missing page and the switch: nothing in Gmail', async () => {
  assert.equal((await sync(plan(), { sandbox: true })).press, 'skip');
  assert.equal((await syncPressRelease(env, { jobId: JOB, plan: plan(), who: { name: 'The Example Center', slug: null, url: '/community/example/', project: true }, fetchImpl })).press, 'skip');
  assert.equal(gmail.calls.length, 0);
  const r = await syncPressRelease(env, { jobId: JOB, plan: plan(), who: { name: 'Nobody', slug: 'nobody' }, fetchImpl });
  assert.equal(r.press, 'error');
  assert.match(r.error, /kid page isn’t published/);
  assert.equal(gmail.drafts.size, 0);
  await writePressSettings(env.DB, { enabled: false });
  assert.equal((await sync()).press, 'off');
});

test('a problem shows at once and is emailed to staff only when it’s still there on the next look', async () => {
  gmail.tokenRefused = true;
  const r1 = await sync(plan(), { alertTo: ['peter@soardcharity.com'] });
  assert.equal(r1.press, 'error');
  assert.match(r1.error, /couldn’t open linzi@soardcharity\.com’s Gmail/);
  assert.equal(emails.length, 0, 'a blip isn’t an alarm');
  await sync(plan(), { alertTo: ['peter@soardcharity.com'] });
  assert.equal(emails.length, 1);
  assert.equal(emails[0].subject, '[SOARD] Rowan’s press release couldn’t be drafted');
  await sync(plan(), { alertTo: ['peter@soardcharity.com'] });
  assert.equal(emails.length, 1, 'once per problem');
  gmail.tokenRefused = false;
  clearTokenCache();
  assert.equal((await sync(plan(), { alertTo: ['peter@soardcharity.com'] })).press, 'drafted', 'fixes itself');
  assert.equal((await readPressRow(env.DB, JOB)).error, null);
});

test('the draft says the age JobTread’s Birthday gives on the reveal day', async () => {
  await sync(plan(), { child: { birthday: '2014-06-01', gender: 'Male' } });
  assert.match(draftMail().text, /for 12-year-old Rowan and his family on Friday, March 12/);
  await sync(plan(), { child: { birthday: '2014-03-01', gender: 'Male' } });
  assert.match(draftMail().text, /for 13-year-old Rowan/, 'a corrected birthday reaches an untouched draft');
});

test('one already in her drafts (an answer from Gmail that never came back): never a second, and never rewritten', async () => {
  await sync();
  await env.DB.prepare('DELETE FROM reveal_press').run();
  const r = await sync(plan({ date: '2027-03-19' }));
  assert.equal(r.press, 'edited');
  assert.equal(r.found, true);
  assert.equal(gmail.drafts.size, 1, 'no second draft');
  assert.match(draftMail().text, /March 12/, 'left as it was');
  assert.equal((await readPressRow(env.DB, JOB)).state, 'edited');
});

test('an email to her that didn’t go is sent on the next look', async () => {
  resendDown = true;
  assert.equal((await sync()).told, false);
  resendDown = false;
  await sync();
  assert.equal(emails.length, 1);
  assert.equal(emails[0].subject, 'Rowan’s press release is in your Gmail drafts');
});

test('the step on Reveals → Now says where it stands', () => {
  const r = { jobId: JOB, name: 'Rowan', slug: 'rowan-test', pageReady: true, preview: {}, confirmed: true, time: '16:00' };
  const press = { enabled: true, from: SENDER, name: 'Linzi Example' };
  assert.equal(pressStep({ ...r, test: true }, { press, invites: { enabled: true } }).state, 'off');
  const waiting = pressStep(r, { press, invites: { enabled: true } });
  assert.equal(waiting.label, 'Press release in Linzi’s Gmail');
  assert.equal(waiting.draft, 'Draft press release');
  const drafted = pressStep({ ...r, press: { state: 'draft', count: 21, link: gmailLink(SENDER, { messageId: 'm1' }) } }, { press, invites: { enabled: true } });
  assert.match(drafted.text, /In Linzi’s drafts, to the 21 people on the press list/);
  assert.equal(drafted.link.label, 'Open in Linzi’s Gmail ↗');
  assert.equal(pressStep({ ...r, press: { state: 'sent', count: 21, sentAt: '2027-03-01T15:00:00Z' } }, { press }).state, 'done');
  assert.equal(pressStep({ ...r, press: { state: 'gone' } }, { press }).draft, 'Draft it again');
  assert.equal(pressStep(r, { press: { ...press, enabled: false }, invites: { enabled: true } }).state, 'off');
});
