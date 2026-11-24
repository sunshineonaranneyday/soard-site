/**
 * The Advisory Board application (/advisory-board/apply/): the form's rules
 * (functions/api/_advisory-form.js), the public endpoint, the headshot (on
 * Cloudflare Images, faked here), the emails, the admin's actions (Add to
 * Advisory Board's welcome email among them), and the Jotform applications
 * brought in once
 * Run: node --test tests/
 */
import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createD1 } from './lib/d1-shim.mjs';
import { checkAnswers, ADVISORY_FIELDS, ADVISORY_STEPS, normalizeLink, answerSections, greetName, HEADSHOT_MIN } from '../functions/api/_advisory-form.js';
import { applicantEmail, staffEmail, staffSlack, fromJotform, importJotformApplications, listAdvisoryApplications, getAdvisorySettings, submitApplication, readHeadshot, getAdvisoryApplication } from '../functions/api/_advisory-applications.js';
import * as publicApi from '../functions/api/advisory-apply.js';
import * as adminApi from '../functions/api/advisory-applications-admin.js';
import { cfId as imageIdOf } from '../public/admin/team-shared.js';

/** A complete, made-up application */
export const GOOD = {
  fullName: 'Jordan Avery', preferredName: 'Jo', email: 'Jordan@Example.org', phone: '(770) 555-0142', address: '12 Maple Dr\nMarietta, GA 30062',
  company: 'Peachtree Builders', jobTitle: 'Director of Partnerships', link: 'linkedin.com/in/jordan-avery',
  heardFrom: 'A friend on the board', why: 'I have watched what a room can do for a child.', connection: 'My nephew uses a wheelchair.',
  involved: 'Yes', involvedHow: 'Volunteered at the 2025 gala.',
  strengths: 'Corporate partnerships and event planning.', fundraising: 'An employer match and a team golf foursome.',
  introductions: 'Yes', networks: 'Maybe', networksMore: 'Our local builders association.', conflict: 'No',
  hostEvent: 'Maybe', meetings: 'Yes', ambassador: 'Yes', meetingTimes: 'Weekday evenings',
  hopeToGain: 'Purpose and friendships.', anythingElse: '',
  refName: 'Sam Lee', refRelationship: 'Former manager', refEmail: 'sam@example.org', refPhone: '',
  acknowledge: true, signature: 'Jordan Avery',
  headshot: 'added', // what the page says once it has a photo (the server goes by the photo itself)
};

/** A photo as the page sends one: a JPEG it drew */
const picture = async (w, h, fmt = 'jpeg') => new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: { r: 217, g: 200, b: 180 } } })[fmt]().toBuffer());
let HEADSHOT;
before(async () => { HEADSHOT = await picture(900, 1200); });
const asFile = (bytes, name = 'headshot.jpg', type = 'image/jpeg') => new File([bytes], name, { type });
const shotOf = async (bytes = HEADSHOT) => (await readHeadshot(asFile(bytes))).headshot;

let env;
let sent;
// Cloudflare Images, faked: what went up and came off, and a switch to make it refuse
let images;
const realFetch = globalThis.fetch;
beforeEach(async () => {
  env = { DB: await createD1(), RESEND_API_KEY: 'resend', SLACK_WEBHOOK_URL: 'https://hooks.slack.test/T0/B0/x', CF_ACCOUNT_ID: 'acct', CF_IMAGES_TOKEN: 'img-token' };
  sent = { emails: [], slack: [] };
  images = { up: [], down: [], failUp: false, failDown: false };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.host === 'api.resend.com') { const batch = JSON.parse(init.body); sent.emails.push(...batch); return Response.json({ data: batch.map((_, i) => ({ id: `em${i}` })) }); }
    if (url.host === 'hooks.slack.test') { sent.slack.push(JSON.parse(init.body)); return new Response('ok'); }
    if (url.host === 'challenges.cloudflare.com') return Response.json({ success: true });
    if (url.host === 'api.cloudflare.com' && url.pathname.startsWith('/client/v4/accounts/acct/images/v1')) {
      if ((init.method || 'GET') === 'POST') {
        if (images.failUp) return Response.json({ success: false, errors: [{ message: 'busy' }] }, { status: 500 });
        const id = init.body.get('id');
        const file = init.body.get('file');
        images.up.push({ id, bytes: new Uint8Array(await file.arrayBuffer()), type: file.type, auth: init.headers?.Authorization });
        return Response.json({ success: true, result: { id, variants: [`https://imagedelivery.net/ROYFuPmfN2vPS6mt5sCkZQ/${id}/public`] } });
      }
      if (init.method === 'DELETE') {
        if (images.failDown) return Response.json({ success: false, errors: [{ message: 'busy' }] }, { status: 500 });
        images.down.push(decodeURIComponent(url.pathname.replace('/client/v4/accounts/acct/images/v1/', '')));
        return Response.json({ success: true, result: {} });
      }
    }
    if (env.access && url.host === 'api.cloudflare.com' && url.pathname.startsWith('/client/v4/accounts/acct/access/')) return env.access(url, init);
    throw new Error(`no route for ${url.href}`);
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

const ctx = (method, body, { ip = '203.0.113.7', url = 'https://site.test/api/advisory-apply', form = null } = {}) => {
  const waits = [];
  return {
    env,
    request: form
      ? new Request(url, { method, headers: { 'CF-Connecting-IP': ip }, body: form })
      : new Request(url, { method, headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip }, body: body ? JSON.stringify(body) : undefined }),
    waitUntil: (p) => waits.push(p),
    data: { userEmail: 'linzi@soardcharity.com' },
    waits,
  };
};
/**
 * Send it as the page does: the answers as JSON in "payload", the headshot as a file. photo: bytes (HEADSHOT
 * unless given), null for none; json: true sends it the way a page from before the headshot did
 */
const apply = async (answers, extra = {}, { photo, photoName = 'headshot.jpg', photoType = 'image/jpeg', json = false, ...opts } = {}) => {
  const payload = { answers, website: '', startedAt: Date.now() - 10 * 60 * 1000, ...extra };
  let c;
  if (json) c = ctx('POST', payload, opts);
  else {
    const form = new FormData();
    form.append('payload', JSON.stringify(payload));
    const bytes = photo === undefined ? HEADSHOT : photo;
    if (bytes) form.append('headshot', asFile(bytes, photoName, photoType));
    c = ctx('POST', null, { ...opts, form });
  }
  const res = await publicApi.onRequestPost(c);
  await Promise.all(c.waits);
  return { res, body: await res.json() };
};
const admin = async (method, body, query = '') => {
  const res = method === 'GET' ? await adminApi.onRequestGet(ctx('GET', null, { url: `https://site.test/api/advisory-applications-admin${query}` })) : await adminApi.onRequestPost(ctx('POST', body, { url: 'https://site.test/api/advisory-applications-admin' }));
  return res.json();
};

test('the rules: what has to be answered, follow-ups only when they apply, and clean values', () => {
  const ok = checkAnswers(GOOD);
  assert.deepEqual(ok.problems, {});
  assert.equal(ok.answers.email, 'jordan@example.org', 'emails are kept in lower case');
  assert.equal(ok.answers.link, 'https://linkedin.com/in/jordan-avery', 'a link without https:// works');
  // An email typed as the link isn't one (it would be sent as https://jordan@example.com): said so, in its own words
  for (const link of ['jordan@example.com', 'mailto:jordan@example.com']) assert.match(checkAnswers({ ...GOOD, link }).problems.link || '', /email address/, link);
  for (const link of ['www.example', 'https://', 'javascript:alert(1)']) assert.match(checkAnswers({ ...GOOD, link }).problems.link || '', /web address/, link);
  assert.equal(checkAnswers({ ...GOOD, link: 'https://www.linkedin.com/in/jordan-avery/?trk=x' }).problems.link, undefined);
  assert.match(checkAnswers({ ...GOOD, link: 'N/A' }).problems.link || '', /Leave this blank if you don’t have one/, 'an optional link says it can be left blank');
  assert.equal(ok.answers.anythingElse, undefined, 'empty answers are left out');

  const bad = checkAnswers({ ...GOOD, email: 'jordan@', phone: '123', meetings: 'Sometimes', acknowledge: false, conflict: 'Yes', conflictMore: '', why: '   ', link: 'not a link', surprise: 'x' });
  assert.deepEqual(Object.keys(bad.problems).sort(), ['acknowledge', 'conflictMore', 'email', 'link', 'meetings', 'phone', 'why']);
  assert.equal(bad.problems.conflictMore, 'Please fill this in.', 'a Yes on conflicts asks for the reason');
  assert.equal(bad.answers.surprise, undefined, 'unknown fields are dropped');

  // The phone: ten digits, as the family application asks (a work extension and a + number from abroad are fine)
  for (const [phone, ok2] of [['404555012', false], ['404-555-01', false], ['(770) 555-0142', true], ['1 770 555 0142', true], ['404.555.0188 x12', true], ['404 555 0188 ext. 7', true], ['+44 20 7946 0958', true]]) {
    assert.equal(!checkAnswers({ ...GOOD, phone }).problems.phone, ok2, phone);
  }
  const no = checkAnswers({ ...GOOD, involved: 'No', involvedHow: 'left over from a Yes' });
  assert.equal(no.answers.involvedHow, undefined, 'a follow-up that no longer applies isn’t kept');
  const one = checkAnswers({ fullName: 'A B' }, { step: 'you' });
  assert.deepEqual(Object.keys(one.problems).sort(), ['email', 'headshot', 'phone'], 'one step at a time');
  assert.equal(one.problems.headshot, 'Please add a headshot.');
  assert.equal(checkAnswers({ ...GOOD, headshot: 'yes please' }).problems.headshot, 'Please add a headshot.', 'only "added" says there is one');
  assert.equal(normalizeLink('www.example.org'), 'https://www.example.org');
  assert.equal(ADVISORY_STEPS.length, 5);
  assert.ok(ADVISORY_FIELDS.every((f) => !/[—–]/.test(`${f.label} ${f.hint || ''}`)), 'no em or en dashes in the questions');
});

test('a name (theirs, or typed to sign) is more than one letter', () => {
  const { problems } = checkAnswers({ ...GOOD, fullName: 'J', signature: 'x' });
  assert.equal(problems.fullName, 'Please type your full name.');
  assert.equal(problems.signature, 'Please type your full name.');
  assert.deepEqual(checkAnswers({ ...GOOD, signature: 'Jo' }).problems, {});
});

test('an email with ".." is turned away; an apostrophe before the @ is fine', () => {
  assert.equal(checkAnswers({ ...GOOD, email: 'robin@example..com' }).problems.email, 'That doesn’t look like an email address.');
  assert.equal(checkAnswers({ ...GOOD, email: "o'brien@example.com" }).problems.email, undefined);
});

test('a phone number no one can dial ("123-456-7890") is asked to be checked', () => {
  assert.equal(checkAnswers({ ...GOOD, phone: '123-456-7890' }).problems.phone, 'That doesn’t look like a US phone number. Please check it.');
  assert.equal(checkAnswers({ ...GOOD, phone: '+44 20 7946 0958' }).problems.phone, undefined);
});

test('applying: stored, the applicant gets a copy, staff get an email and a Slack post', async () => {
  const { res, body } = await apply(GOOD);
  assert.equal(res.status, 200);
  assert.deepEqual(body, { ok: true, first: 'Jo' }, 'thanks by their preferred name');
  const [app] = await listAdvisoryApplications(env.DB);
  assert.equal(app.name, 'Jordan Avery');
  assert.equal(app.status, 'new');
  assert.equal(app.company, 'Peachtree Builders');
  // The headshot: up to Cloudflare Images once, under the application and a part nobody can guess
  assert.equal(images.up.length, 1);
  assert.match(images.up[0].id, new RegExp(`^advisory-applications/${app.id}/[0-9a-f]{24}$`));
  assert.equal(images.up[0].type, 'image/jpeg');
  assert.equal(images.up[0].auth, 'Bearer img-token');
  assert.deepEqual(app.headshot, { url: `https://imagedelivery.net/ROYFuPmfN2vPS6mt5sCkZQ/${images.up[0].id}/public`, width: 900, height: 1200 });
  assert.equal((await getAdvisoryApplication(env.DB, app.id)).answers.headshot, undefined, 'the picture isn’t kept as an answer');

  const copy = sent.emails.find((e) => e.to[0] === 'jordan@example.org');
  assert.equal(copy.subject, 'We have your Advisory Board application');
  assert.match(copy.html, /Thank you, Jo/);
  assert.match(copy.html, /Corporate partnerships and event planning/, 'their answers, as a copy');
  assert.match(copy.html, new RegExp(`<img src="https://imagedelivery\\.net/ROYFuPmfN2vPS6mt5sCkZQ/${images.up[0].id}/w=144,h=144,fit=cover,gravity=face`), 'their headshot, in their copy');
  assert.match(copy.text, /A headshot\nSent with your application/);
  const staff = sent.emails.find((e) => e.to[0] === 'info@soardcharity.com');
  assert.equal(staff.subject, 'New Advisory Board application: Jordan Avery');
  assert.match(staff.html, /#advisory-applications\/adv-/, 'links straight to the application in the admin');
  assert.match(staff.html, /alt="Jordan Avery’s headshot"/, 'staff see who it is');
  assert.equal(sent.slack.length, 1);
  const slack = JSON.stringify(sent.slack[0]);
  assert.match(slack, /Advisory Board application: Jordan Avery/);
  assert.equal(/jordan@example\.org|770/.test(slack), false, 'no contact details in Slack');
  for (const e of sent.emails) assert.equal(/—/.test(e.text), false, 'no em dashes in the emails');

  // A double tap is the same application
  await apply(GOOD);
  assert.equal((await listAdvisoryApplications(env.DB)).length, 1);
  assert.equal(sent.emails.length, 2, 'and nobody is emailed twice');
  assert.equal(images.up.length, 1, 'nor is the headshot sent up twice');
  // A page closed while it sent, sent again days later: the same one (it had arrived)
  const later = await submitApplication(env, GOOD, { now: Date.now() + 5 * 864e5, headshot: await shotOf() });
  assert.equal(later.repeat, true);
  assert.equal((await submitApplication(env, GOOD, { now: Date.now() + 40 * 864e5, headshot: await shotOf() })).repeat, undefined, 'a month on, a new one');
  assert.equal(images.up.length, 2);
});

test('answers that need a look come back by field; bots are answered and dropped', async () => {
  const { res, body } = await apply({ ...GOOD, email: 'nope', meetings: '' });
  assert.equal(res.status, 422);
  assert.deepEqual(Object.keys(body.problems).sort(), ['email', 'meetings']);
  assert.equal((await apply(GOOD, { website: 'spam.example' })).body.ok, true, 'the honeypot looks like a success');
  // Too fast is said, never a "Thank you" for something dropped (a person whose clock was changed lands here too)
  const fast = await apply(GOOD, { startedAt: Date.now() - 3000 });
  assert.deepEqual([fast.res.status, fast.body.ok, fast.body.code], [400, false, 'too-fast']);
  assert.match(fast.body.error, /look over your answers, then press Send again/);
  assert.equal((await listAdvisoryApplications(env.DB)).length, 0, 'none of them stored');
  assert.equal(sent.emails.length, 0);
});

test('Turnstile, once it’s set up, and a daily limit per address', async () => {
  env.TURNSTILE_SECRET_KEY = 'secret';
  const get = await (await publicApi.onRequestGet({ env })).json();
  assert.match(get.turnstileSiteKey, /^0x/);
  const noToken = await apply(GOOD);
  assert.equal(noToken.res.status, 400);
  assert.equal(noToken.body.code, 'turnstile');
  delete env.TURNSTILE_SECRET_KEY;
  assert.equal((await (await publicApi.onRequestGet({ env })).json()).turnstileSiteKey, null, 'no key: the page shows no widget');
  for (let i = 0; i < 5; i++) assert.equal((await apply({ ...GOOD, why: `Reason ${i}` }, {}, { ip: '198.51.100.9' })).res.status, 200);
  const sixth = await apply({ ...GOOD, why: 'Reason 6' }, {}, { ip: '198.51.100.9' });
  assert.equal(sixth.res.status, 429);
  assert.match(sixth.body.error, /info@soardcharity\.com/);
});

test('the admin: read it, move it along, notes, Joined when they’re on People, who hears, delete', async () => {
  await apply(GOOD);
  const list = await admin('GET');
  assert.equal(list.applications.length, 1);
  assert.deepEqual(list.statuses.map((s) => s.id), ['new', 'talking', 'joined', 'not-now']);
  assert.equal((await admin('GET', null, '?count=1')).new, 1);
  const id = list.applications[0].id;
  const one = (await admin('GET', null, `?id=${id}`)).application;
  assert.deepEqual(one.sections.map((s) => s.id), ['you', 'interest', 'bring', 'commitment', 'reference']);
  assert.equal(one.sections.flatMap((s) => s.items).some((i) => i.id === 'acknowledge'), false, 'the checkbox isn’t shown as an answer');

  assert.equal((await admin('POST', { status: { id, status: 'talking' } })).application.status, 'talking');
  assert.equal((await admin('POST', { status: { id, status: 'maybe' } })).success, false);
  const noted = (await admin('POST', { note: { id, text: 'Called Monday, coffee next week.' } })).application;
  assert.equal(noted.notes[0].by, 'linzi@soardcharity.com');
  // (linked by hand: only to the person Add finds for it, through Add's own rules)
  await addedOnPeople('jordan-avery', 'Jordan Avery', 'jordan@example.org');
  const joined = (await admin('POST', { person: { id, slug: 'jordan-avery' } })).application;
  assert.equal(joined.status, 'joined');
  assert.equal(joined.personSlug, 'jordan-avery');
  assert.equal((await admin('GET', null, '?count=1')).new, 0);

  assert.equal((await admin('POST', { settings: { staffEmails: 'peter@example.org\nnot-an-email' } })).problems.staffEmails, 'not-an-email isn’t an email address.');
  assert.deepEqual((await admin('POST', { settings: { staffEmails: 'Peter@Example.org, linzi@example.org' } })).settings.staffEmails, ['peter@example.org', 'linzi@example.org']);
  sent.emails.length = 0;
  await apply({ ...GOOD, why: 'A second applicant', fullName: 'Casey Reed', email: 'casey@example.org', signature: 'Casey Reed' });
  assert.deepEqual(sent.emails.filter((e) => /New Advisory/.test(e.subject)).map((e) => e.to[0]).sort(), ['linzi@example.org', 'peter@example.org']);

  const gone = await admin('POST', { remove: { id } });
  assert.equal(gone.removed, id, JSON.stringify(gone));
  assert.equal((await admin('GET', null, `?id=${id}`)).success, false);
  assert.deepEqual(images.down, [], 'its headshot stays: Add made it their People photo');
  assert.equal((await admin('POST', { remove: { id: '../x' } })).success, false, 'ids are checked');
});

test('the Jotform applications come in once; anyone already on People → Advisory is Joined', async () => {
  for (const sql of (await import('../functions/api/_jotform-backfill.js')).SCHEMA) await env.DB.exec(sql.replace(/\s+/g, ' ')); // the backfill's own table, as in D1
  await env.DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, data TEXT)');
  await env.DB.prepare('INSERT INTO team (slug, data) VALUES (?, ?)').bind('casey-reed', JSON.stringify({ name: 'Casey Reed', group: 'advisory' })).run();
  // (their email on file is what links an old application to them)
  await env.DB.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  await env.DB.prepare("INSERT INTO reveal_board_emails VALUES ('casey-reed', 'casey@example.org', null)").run();
  const sub = (first, last, extra = {}) => JSON.stringify({ formId: '261805783731058', createdAt: '2026-07-08 14:20:00', answers: {
    3: { type: 'control_fullname', text: 'Full Name', answer: { first, last } },
    5: { type: 'control_email', text: 'Email Address', answer: `${first.toLowerCase()}@example.org` },
    6: { type: 'control_phone', text: 'Phone Number', answer: { full: '(404) 555-0100' } },
    7: { type: 'control_address', text: 'Home Address', answer: { addr_line1: '1 Elm St', city: 'Roswell', state: 'GA', postal: '30075' } },
    9: { type: 'control_textbox', text: 'Employer / Company', answer: 'Acme' },
    14: { type: 'control_radio', text: 'Are you able to commit to attending at least four meetings per year?', answer: 'yes' },
    20: { type: 'control_checkbox', text: 'I have read and understand the Advisory Board expectations', answer: ['I agree'] },
    21: { type: 'control_signature', text: 'Applicant Signature', answer: 'https://www.jotform.com/uploads/sig.png' },
    22: { type: 'control_textarea', text: 'A question added later', answer: 'Something new' },
    1: { type: 'control_head', text: 'Applicant Information' },
    ...extra,
  } });
  await env.DB.batch([
    env.DB.prepare("INSERT INTO jotform_backfill (submission_id, form_id, kind, name, submitted_at, answers, updated_at) VALUES ('6261000000000000001', '261805783731058', 'advisory', 'Casey Reed', '2026-07-08 14:20:00', ?, 'x')").bind(sub('Casey', 'Reed')),
    env.DB.prepare("INSERT INTO jotform_backfill (submission_id, form_id, kind, name, submitted_at, answers, updated_at) VALUES ('6261000000000000002', '261805783731058', 'advisory', 'Riley Stone', '2026-07-09 09:00:00', ?, 'x')").bind(sub('Riley', 'Stone')),
    env.DB.prepare("INSERT INTO jotform_backfill (submission_id, form_id, kind, name, submitted_at, answers, updated_at) VALUES ('6380000000000000003', '252326779451161', 'makeover', 'A Child', null, '{}', 'x')"),
  ]);
  const first = await admin('GET');
  assert.equal(first.imported, 2, 'the makeover form’s aren’t advisory applications');
  const byName = Object.fromEntries(first.applications.map((a) => [a.name, a]));
  assert.equal(byName['Casey Reed'].status, 'joined');
  assert.equal(byName['Casey Reed'].personSlug, 'casey-reed');
  assert.equal(byName['Riley Stone'].status, 'new');
  assert.equal(byName['Riley Stone'].source, 'jotform');
  assert.equal(byName['Riley Stone'].createdAt, '2026-07-08T14:20:00.000Z', 'dated when they applied');
  const riley = (await admin('GET', null, `?id=${byName['Riley Stone'].id}`)).application;
  assert.equal(riley.answers.phone, '(404) 555-0100');
  assert.equal(riley.answers.address, '1 Elm St\nRoswell, GA\n30075');
  assert.equal(riley.answers.meetings, 'Yes', 'a choice reads like the site’s');
  assert.equal(riley.answers.acknowledge, true);
  assert.match(riley.answers.anythingElse, /A question added later\nSomething new/, 'a question this form doesn’t ask is kept');
  assert.equal((await admin('GET')).imported, 0, 'once');
  assert.equal(sent.emails.length + sent.slack.length, 0, 'bringing them in emails nobody');
});

test('a fixable answer never spends the Turnstile check; a TEST application reaches only the tester', async () => {
  env.TURNSTILE_SECRET_KEY = 'secret';
  let verifies = 0;
  const base = globalThis.fetch;
  globalThis.fetch = async (input, init) => { if (String(input).includes('challenges.cloudflare.com')) verifies++; return base(input, init); };
  const typo = await apply({ ...GOOD, email: 'jordan@' }, { turnstileToken: 'tok' });
  assert.equal(typo.res.status, 422);
  assert.equal(verifies, 0, 'answers are checked first, so the token is still good for the fixed send');
  const good = await apply({ ...GOOD, fullName: 'TEST Advisory Check', email: 'tester@example.org', signature: 'TEST Advisory Check' }, { turnstileToken: 'tok' });
  assert.equal(good.res.status, 200);
  assert.equal(verifies, 1);
  delete env.TURNSTILE_SECRET_KEY;
  assert.deepEqual(sent.emails.map((e) => e.to[0]).sort(), ['tester@example.org', 'tester@example.org'], 'the copy and the staff email both go to the tester, never the staff list');
  assert.match(sent.emails.find((e) => /New Advisory/.test(e.subject)).subject, /^\[TEST\] /);
  assert.match(JSON.stringify(sent.slack[0]), /Test application · not a real applicant/, 'Slack marks it 🧪');
  const list = await admin('GET');
  assert.equal(list.applications[0].isTest, true, 'the admin tags it');
  assert.equal((await admin('GET', null, '?count=1')).new, 0, 'and it never counts as New');
});

test('who hears: the saved emails, and whoever People → Board puts on the committee, read when each email goes', async () => {
  await env.DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, data TEXT)');
  await env.DB.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  const board = (slug, name, extra) => env.DB.prepare('INSERT OR REPLACE INTO team (slug, data) VALUES (?, ?)').bind(slug, JSON.stringify({ name, group: 'board', ...extra })).run();
  await board('pat-chair', 'Pat Chair', { committees: ['Finance'] });
  await env.DB.prepare("INSERT INTO reveal_board_emails VALUES ('pat-chair', 'pat@example.org', null), ('lee-lead', 'lee@example.org', null)").run();

  let st = (await admin('GET')).settings;
  assert.equal(st.committee, 'Advisory Board', 'the Advisory Board committee unless someone picks another');
  assert.deepEqual(st.committeeMembers, [], 'nobody is on it yet');
  assert.ok(st.committees.includes('Advisory Board') && st.committees.includes('Finance'), 'the pick lists the board’s committees');

  const saved = await admin('POST', { settings: { staffEmails: 'holly@example.org\nlinzi@example.org', committee: 'Advisory Board' } });
  assert.deepEqual(saved.settings.staffEmails, ['holly@example.org', 'linzi@example.org']);
  // Someone takes the committee on in People → Board: no change here
  await board('lee-lead', 'Lee Lead', { committees: ['Advisory Board', 'Gala'] });
  await board('old-hand', 'Old Hand', { committees: ['advisory board'], status: 'alumni' });
  await board('new-face', 'New Face', { committees: ['Advisory Board'] });
  st = (await admin('GET')).settings;
  assert.deepEqual(st.committeeMembers, [{ name: 'Lee Lead', hasEmail: true }, { name: 'New Face', hasEmail: false }], 'active members only, and who has no email yet');
  await apply(GOOD);
  assert.deepEqual(sent.emails.filter((e) => /^New Advisory/.test(e.subject)).map((e) => e.to[0]).sort(), ['holly@example.org', 'lee@example.org', 'linzi@example.org']);

  assert.equal((await admin('POST', { settings: { staffEmails: '', committee: '' } })).problems.staffEmails, 'Add at least one email or pick a committee, or nobody hears about new applications.');
  assert.deepEqual((await admin('POST', { settings: { staffEmails: '', committee: 'Advisory Board' } })).settings.staffEmails, [], 'the committee alone is enough');
});

test('the emails read well without the site: plain text and the staff list default', async () => {
  const app = { id: 'adv-test-0001', answers: checkAnswers(GOOD).answers };
  assert.doesNotMatch(applicantEmail(app).html, /<img/, 'no headshot, no picture (an application from before it was asked)');
  assert.doesNotMatch(applicantEmail(app).text, /A headshot/);
  const mine = applicantEmail(app);
  assert.match(mine.text, /^Thank you, Jo\./);
  assert.match(mine.text, /YOUR INTEREST/);
  const staff = staffEmail(app);
  assert.match(staff.text, /Read the application: https:\/\/sunshineonaranneyday\.com\/admin\/#advisory-applications\/adv-test-0001/);
  assert.ok(staffSlack(app).blocks.length >= 3);
  assert.deepEqual((await getAdvisorySettings(env.DB)).staffEmails, ['info@soardcharity.com']);
  assert.deepEqual(answerSections({}), []);
  assert.deepEqual(fromJotform({}), {});
});

test('the thank-you calls them by their name, never a title ("Dr. Jordan Smith" is Jordan; "Mrs. Lee", alone, stays so)', () => {
  assert.equal(greetName({ fullName: 'Dr. Jordan Smith' }), 'Jordan');
  // (r20, greeted only on positive evidence: more than one title, a title and a family name, or a comma: no name)
  assert.equal(greetName({ fullName: 'Prof. Dr. Ana Ruiz' }), '');
  assert.equal(greetName({ fullName: 'Mrs. Lee' }), '');
  assert.equal(greetName({ fullName: 'Jordan Avery' }), 'Jordan');
  assert.equal(greetName({ fullName: 'Smith, John' }), '', 'written last name first: no name');
  assert.equal(greetName({ fullName: 'Dr. Jordan Smith', preferredName: 'Mary Beth' }), 'Mary Beth');
  assert.equal(greetName({}), '');
  const mail = applicantEmail({ id: 'x', answers: { ...GOOD, preferredName: '', fullName: 'Dr. Jordan Smith' } });
  assert.match(String(mail.text), /^Thank you, Jordan\./);
  // (written last name first: r20, a comma means no name, "Thank you.")
  assert.match(String(applicantEmail({ id: 'x', answers: { ...GOOD, preferredName: '', fullName: 'Ames, Jordan' } }).text), /^Thank you\.\n/);
});

// ─── The headshot ──────────────────────────────────────────────────────

test('the headshot is required, and the photo itself decides: never what the page says about it', async () => {
  const none = await apply(GOOD, {}, { photo: null });
  assert.equal(none.res.status, 422);
  assert.deepEqual(none.body.problems, { headshot: 'Please add a headshot.' }, 'the page said "added", but no photo came');
  // A file that isn't a photo, a PNG called a JPEG, a GIF, an empty one
  const text = await apply(GOOD, {}, { photo: new TextEncoder().encode('not a photo at all, just words'), photoName: 'me.jpg' });
  assert.equal(text.body.problems.headshot, 'That file isn’t a photo we can use. Please send a JPEG, PNG or WebP photo.');
  // A JPEG cut off partway (its header says 900 × 1200, its picture never came)
  assert.equal((await apply(GOOD, {}, { photo: HEADSHOT.subarray(0, 700) })).body.problems.headshot, 'That photo didn’t come through whole. Please choose it again, or another one.');
  // A picture of a kind not taken here, sent straight to the server (the page draws every photo as a JPEG first)
  assert.equal((await apply(GOOD, {}, { photo: await picture(900, 900, 'gif'), photoType: 'image/gif' })).body.problems.headshot, 'Please send the photo as a JPEG, PNG or WebP.');
  assert.equal((await apply(GOOD, {}, { photo: await picture(900, 900, 'avif'), photoType: 'image/avif' })).body.problems.headshot, 'Please send the photo as a JPEG, PNG or WebP.');
  assert.equal((await apply(GOOD, {}, { photo: new Uint8Array(0) })).body.problems.headshot, 'Please add a headshot.');
  // Too small: People's own least for a sharp photo, on its shorter side
  assert.equal(HEADSHOT_MIN, 440);
  const small = await apply(GOOD, {}, { photo: await picture(439, 1200) });
  assert.equal(small.res.status, 422);
  assert.equal(small.body.problems.headshot, 'This photo is too small (439 × 1200 pixels). Please choose a larger one, at least 440 pixels on each side.');
  // A PNG or WebP is taken by what it is, whatever label it came with (the page always sends a JPEG it drew)
  assert.equal((await apply({ ...GOOD, why: 'A PNG' }, {}, { photo: await picture(440, 440, 'png'), photoName: 'me.png', photoType: 'image/png' })).res.status, 200, 'exactly the least is fine');
  assert.equal((await apply({ ...GOOD, why: 'A WebP' }, {}, { photo: await picture(800, 600, 'webp'), photoName: 'me.webp', photoType: 'image/jpeg' })).res.status, 200, 'a WebP labelled a JPEG is a WebP');
  // Too large to take: said in words
  const big = new Uint8Array(10 * 1024 * 1024 + 1);
  big.set(HEADSHOT.subarray(0, 64));
  assert.equal((await apply(GOOD, {}, { photo: big })).body.problems.headshot, 'That photo is too large to send. Please choose a smaller one.');
  assert.equal((await listAdvisoryApplications(env.DB)).length, 2, 'only the two good ones stored');
  assert.equal(images.up.length, 2, 'and only theirs went to Cloudflare');
});

test('a headshot problem never spends the Turnstile check, and comes back with any other answer to fix', async () => {
  env.TURNSTILE_SECRET_KEY = 'secret';
  let verifies = 0;
  const base = globalThis.fetch;
  globalThis.fetch = async (input, init) => { if (String(input).includes('challenges.cloudflare.com')) verifies++; return base(input, init); };
  const both = await apply({ ...GOOD, email: 'jordan@' }, { turnstileToken: 'tok' }, { photo: await picture(200, 200) });
  assert.equal(both.res.status, 422);
  assert.deepEqual(Object.keys(both.body.problems).sort(), ['email', 'headshot']);
  assert.equal(both.body.error, '2 answers need a look.', 'how many, in one line');
  // Only the headshot: its own words, never "a few answers" (a screen reader hears this line)
  const one = await apply(GOOD, { turnstileToken: 'tok' }, { photo: await picture(200, 200) });
  assert.equal(one.body.error, one.body.problems.headshot);
  assert.match(one.body.error, /^This photo is too small/);
  assert.equal(verifies, 0);
  delete env.TURNSTILE_SECRET_KEY;
});

test('a page from before the headshot was asked for is asked to reload (its answers are kept on its device)', async () => {
  const old = await apply(GOOD, {}, { json: true });
  assert.equal(old.res.status, 400);
  assert.equal(old.body.code, 'reload');
  assert.match(old.body.error, /reload the page\. Your answers are saved on this device/);
  // A bot posting JSON with the honeypot filled is still answered like a person and dropped
  assert.equal((await apply(GOOD, { website: 'spam.example' }, { json: true })).body.ok, true);
  assert.equal((await listAdvisoryApplications(env.DB)).length, 0);
});

test('Cloudflare Images busy: nothing is stored or sent, and Send again works', async () => {
  images.failUp = true;
  const busy = await apply(GOOD);
  assert.equal(busy.res.status, 503);
  assert.match(busy.body.error, /couldn’t save your headshot just now\. Please press Send again in a minute\. Your answers are still here\./);
  assert.equal((await listAdvisoryApplications(env.DB)).length, 0);
  assert.equal(sent.emails.length + sent.slack.length, 0, 'nobody told about an application that isn’t there');
  images.failUp = false;
  const again = await apply(GOOD);
  assert.equal(again.res.status, 200);
  assert.equal((await listAdvisoryApplications(env.DB)).length, 1);
  // Without Cloudflare Images set up at all: the same words, nothing stored
  delete env.CF_IMAGES_TOKEN;
  assert.equal((await apply({ ...GOOD, why: 'No images' })).res.status, 503);
  assert.equal((await listAdvisoryApplications(env.DB)).length, 1);
});

test('the row failing to save takes its headshot back off Cloudflare (nothing left pointing nowhere)', async () => {
  const shot = await shotOf();
  const realPrepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql) => (/^INSERT INTO advisory_applications/.test(sql.trim()) ? { bind: () => ({ run: async () => { throw new Error('D1 down'); } }) } : realPrepare(sql));
  await assert.rejects(submitApplication(env, GOOD, { headshot: shot }), /D1 down/);
  env.DB.prepare = realPrepare;
  assert.equal(images.up.length, 1);
  assert.deepEqual(images.down, [images.up[0].id]);
});

test('deleting: the headshot goes too, unless it’s someone’s People photo now; one Cloudflare keeps holds the application', async () => {
  await env.DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, data TEXT)');
  await apply(GOOD);
  await apply({ ...GOOD, fullName: 'Casey Reed', email: 'casey@example.org', signature: 'Casey Reed' });
  const [casey, jordan] = await listAdvisoryApplications(env.DB);
  // Jordan was added: their People photo is the headshot
  await env.DB.prepare('INSERT INTO team (slug, data) VALUES (?, ?)').bind('jordan-avery', JSON.stringify({ name: 'Jordan Avery', group: 'advisory', photo: jordan.headshot.url })).run();
  assert.equal((await admin('POST', { remove: { id: jordan.id } })).removed, jordan.id);
  assert.deepEqual(images.down, [], 'their photo on People stays');
  // Cloudflare won't let go of Casey's: the application stays, and Delete again works
  images.failDown = true;
  const held = await admin('POST', { remove: { id: casey.id } });
  assert.equal(held.success, false);
  assert.match(held.error, /headshot didn’t delete just now, so the application is still here/);
  assert.ok((await admin('GET', null, `?id=${casey.id}`)).application, 'still here');
  images.failDown = false;
  assert.equal((await admin('POST', { remove: { id: casey.id } })).removed, casey.id);
  assert.deepEqual(images.down, [imageIdOf(casey.headshot.url)]);
});

// ─── Add to Advisory Board: their welcome ───────────────────────────

/** Cloudflare Access, faked: one group the site keeps, one policy, the admin's app using it. down: refuses */
function fakeAccess() {
  const st = { groups: [], policies: [], down: false, puts: 0 };
  env.CF_ACCESS_API_TOKEN = 'access-token';
  env.CF_ACCESS_AUD = 'aud-admin';
  env.access = async (url, init = {}) => {
    const method = init.method || 'GET';
    const path = url.pathname.replace('/client/v4/accounts/acct', '');
    const ok = (result) => Response.json({ success: true, result });
    if (st.down) return Response.json({ success: false, errors: [{ message: 'Access is down' }] }, { status: 500 });
    if (path === '/access/groups' && method === 'GET') return ok(st.groups);
    if (path === '/access/groups' && method === 'POST') { const g = { id: 'g1', ...JSON.parse(init.body) }; st.groups.push(g); return ok(g); }
    if (path === '/access/groups/g1' && method === 'GET') return ok(st.groups[0]);
    if (path === '/access/groups/g1' && method === 'PUT') { st.puts++; Object.assign(st.groups[0], JSON.parse(init.body)); return ok(st.groups[0]); }
    if (path === '/access/policies' && method === 'GET') return ok(st.policies);
    if (path === '/access/policies' && method === 'POST') { const p = { id: 'p1', ...JSON.parse(init.body) }; st.policies.push(p); return ok(p); }
    if (path === '/access/apps' && method === 'GET') return ok([{ aud: 'aud-admin', name: 'SOARD admin', policies: st.policies.map((p) => ({ id: p.id })) }]);
    throw new Error(`no Access route ${method} ${path}`);
  };
  return st;
}
const inGroup = (st) => (st.groups[0]?.include || []).map((r) => r.email?.email);
/** What the admin's Add does before it calls the server: their People record, hidden, and their private email */
async function addedOnPeople(slug, name, email) {
  // (People as D1 has it: linking goes through Add, which saves through the admin's own save)
  await env.DB.exec('CREATE TABLE IF NOT EXISTS team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)');
  await env.DB.exec('CREATE TABLE IF NOT EXISTS reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  await env.DB.prepare('INSERT OR REPLACE INTO team (slug, name, "group", order_num, data) VALUES (?, ?, ?, 0, ?)').bind(slug, name, 'advisory', JSON.stringify({ name, group: 'advisory', status: 'active', publishStatus: 'draft' })).run();
  await env.DB.prepare('INSERT OR REPLACE INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(slug, email).run();
}
const emailsOn = async (on) => { const { writeState, readState } = await import('../functions/api/_board-roles.js'); await writeState(env.DB, 'advisory', { ...(await readState(env.DB, 'advisory')), emails: on }); };
const welcomes = () => sent.emails.filter((e) => e.subject === 'Your Advisory Board page is ready');

test('Add to Advisory Board, emails off: Joined, and nobody is emailed (the admin says so)', async () => {
  fakeAccess();
  await apply(GOOD);
  const [app] = await listAdvisoryApplications(env.DB);
  await addedOnPeople('jordan-avery', 'Jordan Avery', 'jordan@example.org');
  assert.equal((await admin('GET')).boardEmails, false, 'the page knows, for what Add says it does');
  sent.emails.length = 0;
  const r = await admin('POST', { person: { id: app.id, slug: 'jordan-avery' } });
  assert.equal(r.application.status, 'joined');
  assert.deepEqual(r.welcome, { off: true, queued: true }, 'it waits for the Advisory Board’s emails to be turned on');
  assert.equal(sent.emails.length, 0);
});

test('Add to Advisory Board, emails on: the sign-in list takes them first, then they’re emailed how to sign in, once', async () => {
  const access = fakeAccess();
  await emailsOn(true);
  assert.equal((await admin('GET')).boardEmails, true);
  await apply(GOOD);
  const [app] = await listAdvisoryApplications(env.DB);
  await addedOnPeople('jordan-avery', 'Jordan Avery', 'jordan@example.org');
  sent.emails.length = 0;
  const r = await admin('POST', { person: { id: app.id, slug: 'jordan-avery' } });
  assert.deepEqual(r.welcome, { sent: 1 });
  assert.ok(inGroup(access).includes('jordan@example.org'), 'on the sign-in list before the email went');
  const [w] = welcomes();
  assert.deepEqual(w.to, ['jordan@example.org']);
  assert.match(w.html, /Welcome, Jo</, 'the name they asked to be called on their application, as their thank-you says');
  assert.match(w.html, /\/admin\/advisory\//, 'the button opens their page');
  // Linked again (pressed twice, or another application of theirs): not emailed twice
  const again = await admin('POST', { person: { id: app.id, slug: 'jordan-avery' } });
  assert.deepEqual(again.welcome, { already: true });
  assert.equal(welcomes().length, 1);
});

test('the sign-in list not taking them yet: the welcome waits, and the heartbeat sends it once it does', async () => {
  const access = fakeAccess();
  await emailsOn(true);
  await apply(GOOD);
  const [app] = await listAdvisoryApplications(env.DB);
  await addedOnPeople('jordan-avery', 'Jordan Avery', 'jordan@example.org');
  access.down = true;
  sent.emails.length = 0;
  const r = await admin('POST', { person: { id: app.id, slug: 'jordan-avery' } });
  assert.deepEqual(r.welcome, { waiting: true, why: 'sign-in' }, 'the sign-in list didn’t take them: the box says so');
  assert.equal(r.application.status, 'joined', 'Joined stands either way');
  assert.equal(welcomes().length, 0, 'no email whose link the sign-in would turn away');
  const { sendWaitingWelcomes } = await import('../functions/api/_advisory-mail.js');
  const { syncBoardAccess } = await import('../functions/api/_board-access.js');
  assert.deepEqual(await sendWaitingWelcomes(env), { sent: 0, waiting: 1 }, 'still down: still waiting');
  access.down = false;
  await syncBoardAccess(env); // the board's heartbeat, a few minutes on
  assert.deepEqual(await sendWaitingWelcomes(env), { sent: 1, waiting: 0 });
  assert.deepEqual(welcomes()[0].to, ['jordan@example.org']);
  assert.deepEqual(await sendWaitingWelcomes(env), { sent: 0 }, 'once');
});

test('a waiting welcome for someone who left, or whose emails were switched off, doesn’t go', async () => {
  const access = fakeAccess();
  await emailsOn(true);
  await apply(GOOD);
  const [app] = await listAdvisoryApplications(env.DB);
  await addedOnPeople('jordan-avery', 'Jordan Avery', 'jordan@example.org');
  access.down = true;
  await admin('POST', { person: { id: app.id, slug: 'jordan-avery' } });
  access.down = false;
  const { sendWaitingWelcomes } = await import('../functions/api/_advisory-mail.js');
  const { syncBoardAccess } = await import('../functions/api/_board-access.js');
  await emailsOn(false);
  await syncBoardAccess(env);
  assert.deepEqual(await sendWaitingWelcomes(env), { sent: 0, off: true }, 'switched off: it waits');
  await emailsOn(true);
  await env.DB.prepare('UPDATE team SET data = ? WHERE slug = ?').bind(JSON.stringify({ name: 'Jordan Avery', group: 'advisory', status: 'alumni' }), 'jordan-avery').run();
  await syncBoardAccess(env);
  assert.deepEqual(await sendWaitingWelcomes(env), { sent: 0, waiting: 0 }, 'they left: it’s dropped');
  assert.equal(welcomes().length, 0);
});

test('emails off when they were added: their sign-in email goes once the Advisory Board’s emails are turned on', async () => {
  fakeAccess();
  await apply(GOOD);
  const [app] = await listAdvisoryApplications(env.DB);
  await addedOnPeople('jordan-avery', 'Jordan Avery', 'jordan@example.org');
  assert.deepEqual((await admin('POST', { person: { id: app.id, slug: 'jordan-avery' } })).welcome, { off: true, queued: true });
  const { sendWaitingWelcomes } = await import('../functions/api/_advisory-mail.js');
  const { syncBoardAccess } = await import('../functions/api/_board-access.js');
  sent.emails.length = 0;
  assert.deepEqual(await sendWaitingWelcomes(env), { sent: 0, off: true });
  await emailsOn(true);
  await syncBoardAccess(env);
  assert.deepEqual(await sendWaitingWelcomes(env), { sent: 1, waiting: 0 });
  assert.deepEqual(welcomes().map((w) => w.to[0]), ['jordan@example.org']);
});

test('two sends of one application at once (a second tab, a retry while the first was on its way): one application', async () => {
  const sendId = 'b6f0c1de-2f3a-4c5b-9d8e-7f6a5b4c3d2e-0011223344556677';
  const [a, b] = await Promise.all([apply(GOOD, { sendId }), apply(GOOD, { sendId })]);
  assert.equal(a.res.status, 200);
  assert.equal(b.res.status, 200);
  assert.equal((await listAdvisoryApplications(env.DB)).length, 1);
  assert.equal(images.up.length - images.down.length, 1, 'one picture kept (a second sent up was taken back off)');
  assert.equal(sent.emails.filter((e) => /^New Advisory/.test(e.subject)).length, 1, 'staff hear once');
});

test('the same answers again with a different photo: their newest photo is shown, the first kept (the emails sent show it), nobody emailed again', async () => {
  await apply(GOOD, { photoAt: 1000 });
  const [first] = await listAdvisoryApplications(env.DB);
  const firstPicture = images.up[0].id;
  sent.emails.length = 0;
  const again = await apply(GOOD, { photoAt: 2000 }, { photo: await picture(1000, 1000) });
  assert.equal(again.res.status, 200);
  const [now] = await listAdvisoryApplications(env.DB);
  assert.equal(now.id, first.id, 'the same application');
  assert.deepEqual([now.headshot.width, now.headshot.height], [1000, 1000]);
  assert.deepEqual(images.down, [], 'the first photo stays on Cloudflare: the staff email already sent shows it');
  const stored = JSON.parse((await env.DB.prepare('SELECT headshot FROM advisory_applications WHERE id = ?').bind(first.id).first()).headshot);
  assert.deepEqual(stored.older, [firstPicture]);
  assert.equal(stored.id, images.up[1].id, 'the one shown is the newest sent');
  assert.equal(sent.emails.length, 0);
  // The same photo again: nothing changes, nothing more sent up
  const ups = images.up.length;
  await apply(GOOD, { photoAt: 3000 }, { photo: await picture(1000, 1000) });
  assert.equal(images.up.length, ups);
  // A send that arrives late with a photo picked before the one shown never replaces it
  await apply(GOOD, { photoAt: 1500 }, { photo: await picture(1200, 1200) });
  assert.equal((await listAdvisoryApplications(env.DB))[0].headshot.width, 1000, 'the newer photo stays');
  assert.equal(images.up.length, ups);
  // Once staff have added them, People has their photo: a later one changes nothing
  await env.DB.prepare("UPDATE advisory_applications SET status = 'joined', person_slug = 'jordan-avery' WHERE id = ?").bind(first.id).run();
  await apply(GOOD, { photoAt: 9000 }, { photo: await picture(1100, 1100) });
  assert.deepEqual([(await listAdvisoryApplications(env.DB))[0].headshot.width], [1000]);
  // Deleting the application takes every photo it sent up off Cloudflare
  await env.DB.prepare("UPDATE advisory_applications SET status = 'new', person_slug = NULL WHERE id = ?").bind(first.id).run();
  const del = await admin('POST', { remove: { id: first.id } });
  assert.equal(del.removed, first.id, del.error);
  assert.deepEqual([...images.down].sort(), [firstPicture, stored.id].sort());
});

test('Cloudflare turning the picture itself down is a photo to choose again; our own key refused is a wait', async () => {
  const real = globalThis.fetch;
  let status = 400;
  globalThis.fetch = async (input, init = {}) => (String(input).includes('/images/v1') && (init.method || 'GET') === 'POST'
    ? Response.json({ success: false, errors: [{ code: 5400, message: 'Bad request: decode error' }] }, { status }) : real(input, init));
  const bad = await apply(GOOD);
  assert.equal(bad.res.status, 422);
  assert.equal(bad.body.problems.headshot, 'We couldn’t use that photo. Please choose a different one.');
  status = 401;
  assert.equal((await apply(GOOD)).res.status, 503);
  globalThis.fetch = real;
  assert.equal((await listAdvisoryApplications(env.DB)).length, 0);
});

test('careless sends: no answers part, no start time', async () => {
  const form = new FormData();
  form.append('headshot', asFile(HEADSHOT));
  const c = ctx('POST', null, { form });
  const res = await publicApi.onRequestPost(c);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /didn’t come through/);
  const noStart = await apply(GOOD, { startedAt: undefined });
  assert.deepEqual([noStart.res.status, noStart.body.ok], [400, false], 'no start time: it didn’t come through (never told it arrived)');
  assert.match(noStart.body.error, /didn’t come through/);
  for (const payload of [null, [], 5, 'x', {}]) {
    const form = new FormData();
    form.append('payload', JSON.stringify(payload));
    form.append('headshot', asFile(HEADSHOT));
    const r = await publicApi.onRequestPost(ctx('POST', null, { form }));
    assert.equal(r.status, 400, JSON.stringify(payload));
    assert.match((await r.json()).error, /didn’t come through/, `${JSON.stringify(payload)}: never "slow down"`);
  }
  assert.equal((await listAdvisoryApplications(env.DB)).length, 0, 'and dropped, as a bot');
});

test('who hears can never be nobody: a committee with nobody on it who has an email is refused, and an empty list still reaches info@', async () => {
  await env.DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, data TEXT)');
  await env.DB.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  const r = await admin('POST', { settings: { staffEmails: '', committee: 'Advisory Board' } });
  assert.equal(r.success, false);
  assert.match(r.problems.staffEmails, /Nobody on the Advisory Board committee has an email on People → Board yet/);
  // Saved before this rule (or the committee's last member left since): info@ hears
  await env.DB.prepare("INSERT OR REPLACE INTO advisory_settings (key, value, updated_at) VALUES ('staffEmails', '[]', 'x')").run();
  await apply(GOOD);
  assert.deepEqual(sent.emails.filter((e) => /^New Advisory/.test(e.subject)).map((e) => e.to[0]), ['info@soardcharity.com']);
});

// ─── Round two ──────────────────────────────────────────────────────

test('five applications a day from one place: the same one again, or one that failed, never counts', async () => {
  const person = (n) => ({ ...GOOD, fullName: `Pat Person${'abcdefg'[n]}`, email: `pat${n}@example.org`, signature: `Pat Person${'abcdefg'[n]}` });
  assert.equal((await apply(person(0))).res.status, 200);
  for (let i = 0; i < 6; i++) assert.equal((await apply(person(0))).res.status, 200, 'the same answers again (a retry) is fine, and free');
  images.failUp = true;
  for (let i = 0; i < 3; i++) assert.equal((await apply(person(1))).res.status, 503, 'Cloudflare Images busy');
  images.failUp = false;
  for (let n = 1; n <= 4; n++) assert.equal((await apply(person(n))).res.status, 200, `stored ${n + 1}`);
  const sixth = await apply(person(5));
  assert.equal(sixth.res.status, 429);
  assert.match(sixth.body.error, /info@soardcharity\.com/);
  assert.equal((await apply(person(5), {}, { ip: '198.51.100.9' })).res.status, 200, 'somewhere else is its own count');
  assert.equal((await listAdvisoryApplications(env.DB)).length, 6);
});

test('a TEST application is one whose name starts with the word Test; a name like Testa is a person', async () => {
  const { isTestApplication } = await import('../functions/api/_advisory-applications.js');
  for (const [name, test2] of [['TEST Advisory Check', true], ['test run', true], ['Test-Smith', true], ['  Test', true], ['Testa Rossi', false], ['Tess Testerman', false], ['Contest Winner', false]]) {
    assert.equal(isTestApplication(name), test2, name);
  }
  await apply({ ...GOOD, fullName: 'Testa Rossi', email: 'testa@example.org', signature: 'Testa Rossi' });
  assert.equal((await admin('GET', null, '?count=1')).new, 1, 'counted as New');
  assert.ok(sent.emails.some((e) => e.subject === 'New Advisory Board application: Testa Rossi'), 'and staff hear, with no [TEST]');
});

test('settings: sending only the committee keeps the emails list; a committee that isn’t words is refused', async () => {
  await env.DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, data TEXT)');
  await env.DB.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  await env.DB.prepare('INSERT INTO team (slug, data) VALUES (?, ?)').bind('pat-chair', JSON.stringify({ name: 'Pat Chair', group: 'board', committees: ['Advisory Board'] })).run();
  await env.DB.prepare("INSERT INTO reveal_board_emails VALUES ('pat-chair', 'pat@example.org', null)").run();
  assert.deepEqual((await admin('POST', { settings: { staffEmails: 'linzi@example.org' } })).settings.staffEmails, ['linzi@example.org']);
  const r = await admin('POST', { settings: { committee: 'Advisory Board' } });
  assert.deepEqual(r.settings.staffEmails, ['linzi@example.org'], 'the list stays');
  assert.equal(r.settings.committee, 'Advisory Board');
  for (const committee of [5, ['Advisory Board'], { name: 'x' }, true]) {
    const bad = await admin('POST', { settings: { committee } });
    assert.equal(bad.success, false, JSON.stringify(committee));
    assert.equal(bad.problems.committee, 'Pick a committee from the list.');
  }
  assert.equal((await getAdvisorySettings(env.DB)).committee, 'Advisory Board', 'nothing changed');
  assert.equal((await admin('POST', { settings: { staffEmails: '', committee: 'Advisory Board' } })).settings.staffEmails.length, 0, 'the committee alone is fine when someone on it has an email');
});

test('deleting an application from the old form takes its Jotform copy and files with it, so it never comes back; if they don’t go, nothing does', async () => {
  for (const sql of (await import('../functions/api/_jotform-backfill.js')).SCHEMA) await env.DB.exec(sql.replace(/\s+/g, ' ')); // the backfill's own table, as in D1
  const answers = JSON.stringify({ formId: '261805783731058', createdAt: '2026-07-09 09:00:00', answers: {
    3: { type: 'control_fullname', text: 'Full Name', answer: { first: 'Riley', last: 'Stone' } },
    5: { type: 'control_email', text: 'Email Address', answer: 'riley@example.org' },
  } });
  await env.DB.prepare("INSERT INTO jotform_backfill (submission_id, form_id, kind, name, submitted_at, answers, saved, updated_at) VALUES ('6261000000000000002', '261805783731058', 'advisory', 'Riley Stone', '2026-07-09 09:00:00', ?, ?, 'x')")
    .bind(answers, JSON.stringify([{ kind: 'signature', key: 'jotform/advisory/6261000000000000002/signature.png' }, { kind: 'pdf', error: 'none' }])).run();
  const bucket = new Map([['jotform/advisory/6261000000000000002/signature.png', 'png']]);
  let bucketDown = true;
  env.APPLICANT_FILES = { delete: async (key) => { if (bucketDown) throw new Error('R2 busy'); bucket.delete(key); } };
  const [riley] = (await admin('GET')).applications;
  assert.equal(riley.name, 'Riley Stone');
  const held = await admin('POST', { remove: { id: riley.id } });
  assert.equal(held.success, false);
  assert.match(held.error, /copy from the old form didn’t delete just now/);
  assert.equal((await admin('GET')).applications.length, 1, 'still here');
  bucketDown = false;
  assert.equal((await admin('POST', { remove: { id: riley.id } })).removed, riley.id, 'Delete again finishes it');
  assert.equal(bucket.size, 0, 'its saved signature is gone');
  const copy = await env.DB.prepare("SELECT answers, saved FROM jotform_backfill WHERE submission_id = '6261000000000000002'").first();
  assert.deepEqual([copy.answers, copy.saved], [null, null]);
  const after = await admin('GET');
  assert.equal(after.imported, 0);
  assert.equal(after.applications.length, 0, 'it doesn’t come back');
});

test('an iPhone photo sent straight to the server, or one bigger than Cloudflare Images takes, is turned down in words', async (t) => {
  const tall = await sharp({ create: { width: 3001, height: 12_001, channels: 3, background: '#d9c8b4' } }).jpeg({ quality: 40 }).toBuffer();
  assert.equal((await readHeadshot(asFile(new Uint8Array(tall)))).problem, 'That photo is too large to use. Please choose a smaller one.', 'over 12,000 px a side');
  // A wide one is fine (the site uses the square around their face)
  const wide = await sharp({ create: { width: 12_000, height: 800, channels: 3, background: '#d9c8b4' } }).jpeg().toBuffer();
  assert.ok((await readHeadshot(asFile(new Uint8Array(wide)))).headshot, '12,000 × 800 is taken');
  const huge = await sharp({ create: { width: 10_100, height: 10_000, channels: 3, background: '#d9c8b4' } }).jpeg({ quality: 40 }).toBuffer();
  assert.ok(huge.length < 10 * 1024 * 1024);
  assert.equal((await readHeadshot(asFile(new Uint8Array(huge)))).problem, 'That photo is too large to use. Please choose a smaller one.', 'over 100 megapixels');
  const ok = await sharp({ create: { width: 12_000, height: 3000, channels: 3, background: '#d9c8b4' } }).jpeg({ quality: 40 }).toBuffer();
  assert.ok((await readHeadshot(asFile(new Uint8Array(ok)))).headshot, '12,000 px exactly is fine');
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'heic-'));
  try {
    writeFileSync(join(dir, 'a.png'), await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#d9c8b4' } }).png().toBuffer());
    try { execFileSync('sips', ['-s', 'format', 'heic', join(dir, 'a.png'), '--out', join(dir, 'a.heic')], { stdio: 'ignore' }); } catch { t.skip('no sips here (not macOS)'); return; }
    const heic = new Uint8Array(readFileSync(join(dir, 'a.heic')));
    const r = await apply(GOOD, {}, { photo: heic, photoName: 'IMG_0413.HEIC', photoType: 'image/heic' });
    assert.equal(r.res.status, 422);
    assert.equal(r.body.problems.headshot, 'Please send the photo as a JPEG, PNG or WebP.');
    assert.equal(images.up.length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the sign-in email the email service didn’t take: the box says it goes again in a few minutes, and the heartbeat sends it', async () => {
  fakeAccess();
  await emailsOn(true);
  await apply(GOOD);
  const [app] = await listAdvisoryApplications(env.DB);
  await addedOnPeople('jordan-avery', 'Jordan Avery', 'jordan@example.org');
  const withResend = globalThis.fetch;
  globalThis.fetch = async (input, init) => (new URL(typeof input === 'string' ? input : input.url).host === 'api.resend.com'
    ? Response.json({ message: 'Resend is down' }, { status: 500 }) : withResend(input, init));
  const r = await admin('POST', { person: { id: app.id, slug: 'jordan-avery' } });
  assert.deepEqual(r.welcome, { waiting: true, why: 'owed' }); /* r26: a 5xx says nothing either way, so the welcome stays owed under its key for the heartbeat (said "goes in a few minutes") */
  assert.equal(r.application.status, 'joined');
  globalThis.fetch = withResend;
  sent.emails.length = 0;
  const { sendWaitingWelcomes } = await import('../functions/api/_advisory-mail.js');
  assert.deepEqual(await sendWaitingWelcomes(env), { sent: 1, waiting: 0 });
  assert.deepEqual(welcomes().map((w) => w.to[0]), ['jordan@example.org']);
  assert.deepEqual((await admin('POST', { person: { id: app.id, slug: 'jordan-avery' } })).welcome, { already: true }, 'never twice');
});

test('a picture Cloudflare didn’t let go of is asked again by the heartbeat until it goes; never one that’s someone’s People photo', async () => {
  const { forgetImage, retryForgottenImages } = await import('../functions/api/_advisory-applications.js');
  const { ensureAdvisorySchema } = await import('../functions/api/_advisory-applications.js');
  await ensureAdvisorySchema(env.DB);
  await env.DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, data TEXT)');
  const pic = (n) => `advisory-applications/adv-test-0000000${n}/aaaaaaaaaaaaaaaaaaaaaaa${n}`;
  images.failDown = true;
  assert.equal(await forgetImage(env, pic(1)), false);
  assert.equal(await forgetImage(env, pic(2)), false);
  assert.deepEqual(await retryForgottenImages(env), { gone: 0, left: 2 }, 'still refused: both wait');
  images.failDown = false;
  // D1 failing the People check: it waits (never deleted unchecked, never dropped)
  const real = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql) => (/instr\(data/.test(sql) ? { bind: () => ({ all: async () => { throw new Error('D1_ERROR: busy'); } }) } : real(sql));
  assert.deepEqual(await retryForgottenImages(env), { gone: 0, left: 2 });
  env.DB.prepare = real;
  assert.deepEqual(images.down, []);
  // Meanwhile pic 2 became someone's People photo: it stays on Cloudflare, and comes off the list
  await env.DB.prepare('INSERT INTO team (slug, data) VALUES (?, ?)').bind('dana-kim', JSON.stringify({ name: 'Dana Kim', photo: `https://imagedelivery.net/ROYFuPmfN2vPS6mt5sCkZQ/${pic(2)}/public` })).run();
  assert.deepEqual(await retryForgottenImages(env), { gone: 2, left: 0 });
  assert.deepEqual(images.down, [pic(1)]);
  assert.deepEqual(await retryForgottenImages(env), { gone: 0, left: 0 }, 'nothing left');
});

// ─── Round three ────────────────────────────────────────────────────

test('a welcome claimed before it goes: two sends at once email once; one that fails is let go and goes next time; a claim a dead request left can go again', async () => {
  const { sendWelcome, welcomeOnJoin, welcomedSlugs } = await import('../functions/api/_advisory-mail.js');
  const { writeState } = await import('../functions/api/_board-roles.js');
  await emailsOn(true);
  await addedOnPeople('kim-two', 'Kim Two', 'kim@example.org');
  const [a, b] = await Promise.all([sendWelcome(env, { slugs: ['kim-two'] }), sendWelcome(env, { slugs: ['kim-two'] })]);
  assert.equal(a.sent + b.sent, 1);
  assert.equal(welcomes().length, 1);
  assert.ok((await welcomedSlugs(env.DB))['kim-two']);
  // The email service refusing it: not marked, so the next try sends it
  await addedOnPeople('lee-fail', 'Lee Fail', 'lee@example.org');
  const ok = globalThis.fetch;
  globalThis.fetch = async (input, init) => (new URL(typeof input === 'string' ? input : input.url).host === 'api.resend.com' ? Response.json({ message: 'down' }, { status: 500 }) : ok(input, init));
  assert.deepEqual(await sendWelcome(env, { slugs: ['lee-fail'] }), { sent: 0, failed: 0, owed: 1, refused: 0, going: 0, had: 0 }); /* r26: Resend's 500 leaves it owed (put back, and written down with its key), never counted as sent or lost */
  globalThis.fetch = ok;
  assert.equal((await welcomedSlugs(env.DB))['lee-fail'], undefined);
  assert.equal((await sendWelcome(env, { slugs: ['lee-fail'] })).sent, 1);
  // A claim left by a request that died: on its way for a few minutes (never twice), then it can go again
  await addedOnPeople('max-dead', 'Max Dead', 'max@example.org');
  const now = Date.now();
  const { readState } = await import('../functions/api/_board-roles.js');
  await writeState(env.DB, 'advisory-mail', { ...(await readState(env.DB, 'advisory-mail')), welcomed: { ...(await readState(env.DB, 'advisory-mail')).welcomed, 'max-dead': { sending: new Date(now - 60_000).toISOString() } } });
  assert.equal((await sendWelcome(env, { slugs: ['max-dead'], now })).sent, 0, 'on its way: not sent twice');
  assert.deepEqual(await welcomeOnJoin(env, 'max-dead', { now }), { already: true });
  assert.equal((await sendWelcome(env, { slugs: ['max-dead'], now: now + 15 * 60_000 })).sent, 1, 'a quarter hour on, it goes');
  assert.equal(welcomes().filter((w) => w.to[0] === 'max@example.org').length, 1);
});

test('the mail record: a note written beside a welcome never undoes it (each entry changed in place)', async () => {
  const { sendGiftNote } = await import('../functions/api/_advisory-mail.js');
  const { readState } = await import('../functions/api/_board-roles.js');
  await emailsOn(true);
  await addedOnPeople('gia-gift', 'Gia Gift', 'gia@example.org');
  await readState(env.DB, 'advisory-mail');
  // Between the gift note's read of the record and its write, a welcome starts waiting for someone (another request)
  const real = env.DB.prepare.bind(env.DB);
  let inject = true;
  env.DB.prepare = (sql) => {
    const st = real(sql);
    if (sql !== 'SELECT data FROM board_state WHERE key = ?') return st;
    return { bind: (...args) => { const b = st.bind(...args); return { ...b, first: async (...f) => {
      const row = await b.first(...f);
      if (inject && args[0] === 'advisory-mail') {
        inject = false;
        await real("INSERT OR IGNORE INTO board_state (key, data, updated_at) VALUES ('advisory-mail', '{}', 'x')").run();
        await real(`UPDATE board_state SET data = json_set(data, '$."waiting"', json('{"zed-wait":{"at":"x"}}')) WHERE key = 'advisory-mail'`).run();
      }
      return row;
    } }; } };
  };
  await sendGiftNote(env, 'gia-gift', 1);
  env.DB.prepare = real;
  const log = await readState(env.DB, 'advisory-mail');
  assert.ok(log.waiting?.['zed-wait'], 'the waiting welcome is still there');
  assert.equal(log.list?.[0]?.kind, 'advisory-update', 'and the note is logged');
});

test('greetings: a title is skipped (“Dr. Jordan Smith” is Jordan), and the name they asked to be called on their application wins', async () => {
  const { sendWelcome } = await import('../functions/api/_advisory-mail.js');
  await emailsOn(true);
  await addedOnPeople('jordan-smith', 'Dr. Jordan Smith', 'js@example.org');
  await addedOnPeople('ms-lane', 'Ms. Lane', 'lane@example.org');
  await sendWelcome(env, { slugs: ['jordan-smith', 'ms-lane'] });
  const by = Object.fromEntries(welcomes().map((w) => [w.to[0], w]));
  assert.match(by['js@example.org'].text, /^Hi Jordan,/);
  // (r20: a title and a family name is no given name, so "Hello," rather than "Hi Ms. Lane,")
  assert.match(by['lane@example.org'].text, /^Hello,/, 'a title with only a surname: no name');
});

test('a welcome waiting on the sign-in’s setup says so, not "a few minutes"', async () => {
  await emailsOn(true);
  await apply(GOOD);
  const [app] = await listAdvisoryApplications(env.DB);
  await addedOnPeople('jordan-avery', 'Jordan Avery', 'jordan@example.org');
  // (no Access key here: the sign-in isn't set up)
  const r = await admin('POST', { person: { id: app.id, slug: 'jordan-avery' } });
  assert.deepEqual(r.welcome, { waiting: true, why: 'setup' });
});

test('a device clock that’s fast or slow never drops a person: how long it took is the device’s own count', async () => {
  const now = Date.now();
  // Ten minutes fast: started "in the future" by our clock, six minutes of answering by its own
  const fast = await apply(GOOD, { startedAt: now + 10 * 60_000, elapsedMs: 6 * 60_000 });
  assert.equal(fast.res.status, 200);
  assert.equal((await listAdvisoryApplications(env.DB)).length, 1, 'stored');
  assert.equal(fast.body.first, 'Jo');
  // Five seconds by its own count (a clock set back by nearly the time it took, or a bot): said, never a "Thank you"
  const quick = await apply({ ...GOOD, email: 'quick@example.org' }, { startedAt: now - 10 * 60_000, elapsedMs: 5000 });
  assert.deepEqual([quick.body.ok, quick.body.code], [false, 'too-fast']);
  assert.equal((await listAdvisoryApplications(env.DB)).length, 1);
  // A page from before (no elapsedMs) on a fast clock: a time that runs backwards says nothing about a bot
  const old = await apply({ ...GOOD, email: 'old@example.org' }, { startedAt: now + 10 * 60_000 });
  assert.equal(old.res.status, 200);
  assert.equal((await listAdvisoryApplications(env.DB)).length, 2);
});

test('the daily limit: the same application sent again is answered as itself, and ten at once can’t slip under it', async () => {
  const person = (n) => ({ ...GOOD, fullName: `Pat Person${'abcdefghijkl'[n]}`, email: `pat${n}@example.org`, signature: `Pat Person${'abcdefghijkl'[n]}` });
  for (let n = 0; n < 5; n++) assert.equal((await apply(person(n))).res.status, 200);
  const again = await apply(person(4));
  assert.equal(again.res.status, 200, 'a re-send of one that arrived gets its thank-you, not "several from here today"');
  assert.equal(again.body.ok, true);
  assert.equal((await apply(person(5))).res.status, 429);
  // Somewhere else, ten at once
  const many = await Promise.all([...Array(10)].map((_, i) => apply({ ...person(i), email: `burst${i}@example.org` }, {}, { ip: '198.51.100.20' })));
  assert.equal(many.filter((m) => m.res.status === 200).length, 5);
  assert.equal(many.filter((m) => m.res.status === 429).length, 5);
  assert.equal((await listAdvisoryApplications(env.DB)).filter((a) => /^burst/.test(a.email)).length, 5);
});

test('two newer photos for one application at once: one is kept, the other taken back off; deleting the application leaves nothing on Cloudflare', async () => {
  await apply(GOOD, { photoAt: 1000 });
  const [app] = await listAdvisoryApplications(env.DB);
  await Promise.all([
    apply(GOOD, { photoAt: 2000 }, { photo: await picture(1000, 1000) }),
    apply(GOOD, { photoAt: 3000 }, { photo: await picture(1100, 1100) }),
  ]);
  assert.equal(images.up.length, 3);
  const stored = JSON.parse((await env.DB.prepare('SELECT headshot FROM advisory_applications WHERE id = ?').bind(app.id).first()).headshot);
  const pointed = new Set([stored.id, ...(stored.older || [])]);
  const loose = images.up.map((u) => u.id).filter((id) => !pointed.has(id));
  assert.deepEqual(loose.filter((id) => !images.down.includes(id)), [], 'nothing up there that nothing points at');
  assert.equal((await admin('POST', { remove: { id: app.id } })).removed, app.id);
  assert.deepEqual(images.up.map((u) => u.id).filter((id) => !images.down.includes(id)), [], 'all of it gone with the application');
});

test('a picture written down when it went up: the heartbeat takes it off once it’s a while old and nothing points at it', async () => {
  const { retryForgottenImages, ensureAdvisorySchema } = await import('../functions/api/_advisory-applications.js');
  await ensureAdvisorySchema(env.DB);
  await apply(GOOD);
  const stored = JSON.parse((await env.DB.prepare('SELECT headshot FROM advisory_applications').first()).headshot);
  const now = Date.now();
  const orphan = 'advisory-applications/adv-cut-00000001/bbbbbbbbbbbbbbbbbbbbbbbb';
  const fresh = 'advisory-applications/adv-cut-00000002/cccccccccccccccccccccccc';
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS advisory_image_cleanup (id TEXT PRIMARY KEY, at INTEGER NOT NULL)').run();
  for (const [id, at] of [[orphan, now - 30 * 60_000], [fresh, now - 60_000], [stored.id, now - 30 * 60_000]]) {
    await env.DB.prepare('INSERT OR REPLACE INTO advisory_image_cleanup (id, at) VALUES (?, ?)').bind(id, at).run();
  }
  assert.deepEqual(await retryForgottenImages(env, { now }), { gone: 2, left: 1 });
  assert.deepEqual(images.down, [orphan], 'the one a cut-off request left goes; an application’s own stays; one on its way waits');
  assert.equal(await env.DB.prepare('SELECT id FROM advisory_image_cleanup WHERE id = ?').bind(fresh).first('id'), fresh);
  // A stored application's picture is crossed off as soon as it's stored
  assert.equal(await env.DB.prepare('SELECT count(*) AS n FROM advisory_image_cleanup WHERE id LIKE ?').bind('advisory-applications/adv-%').first('n'), 1);
});

test('a photo a version in History points at (Recently deleted) stays on Cloudflare when the application is deleted', async () => {
  await apply(GOOD);
  const [app] = await listAdvisoryApplications(env.DB);
  const { ensureHistory } = await import('../functions/api/_content-history.js');
  await ensureHistory(env.DB);
  await env.DB.exec('CREATE TABLE IF NOT EXISTS team (slug TEXT PRIMARY KEY, data TEXT)');
  await env.DB.prepare("INSERT INTO content_versions (collection, slug, data, action, created_at) VALUES ('team', 'jordan-avery', ?, 'delete', 'x')")
    .bind(JSON.stringify({ name: 'Jordan Avery', group: 'advisory', photo: app.headshot.url })).run();
  assert.equal((await admin('POST', { remove: { id: app.id } })).removed, app.id);
  assert.deepEqual(images.down, [], 'bringing them back from Recently deleted still has their photo');
});

test('old-form applications are linked only to an active member, and only by their email on file (a name alone is asked about by Add)', async () => {
  for (const sql of (await import('../functions/api/_jotform-backfill.js')).SCHEMA) await env.DB.exec(sql.replace(/\s+/g, ' '));
  await env.DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, data TEXT)');
  await env.DB.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  const put = (slug, d, email) => Promise.all([
    env.DB.prepare('INSERT INTO team (slug, data) VALUES (?, ?)').bind(slug, JSON.stringify({ group: 'advisory', status: 'active', ...d })).run(),
    email ? env.DB.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(slug, email).run() : null,
  ]);
  await put('lee-jordan', { name: 'Lee Jordan' });
  await put('casey-reed', { name: 'Casey Reed' });
  await put('robin-alum', { name: 'Robin Alum', status: 'alumni' });
  await put('t-quinn', { name: 'Taylor Quinn-Smith' }, 'tq@example.org');
  const sub = (id, first, last, email) => env.DB.prepare("INSERT INTO jotform_backfill (submission_id, form_id, kind, name, submitted_at, answers, updated_at) VALUES (?, '261805783731058', 'advisory', ?, '2026-07-08 14:20:00', ?, 'x')")
    .bind(id, `${first} ${last}`, JSON.stringify({ formId: '261805783731058', answers: {
      3: { type: 'control_fullname', text: 'Full Name', answer: { first, last } },
      5: { type: 'control_email', text: 'Email Address', answer: email },
    } })).run();
  await sub('6261000000000000011', 'Jordan', 'Lee', 'jordan@example.org');
  await sub('6261000000000000012', 'Dr. Casey', 'Reed', 'casey@example.org');
  await sub('6261000000000000013', 'Robin', 'Alum', 'robin@example.org');
  await sub('6261000000000000014', 'Tay', 'Quinn', 'tq@example.org');
  const list = (await admin('GET')).applications;
  const by = Object.fromEntries(list.map((a) => [a.name, a]));
  assert.deepEqual([by['Jordan Lee'].status, by['Jordan Lee'].personSlug], ['new', null], '"Lee Jordan" on People isn’t "Jordan Lee"');
  assert.deepEqual([by['Dr. Casey Reed'].status, by['Dr. Casey Reed'].personSlug], ['new', null], 'the same name, no email of theirs: left for Add to ask');
  assert.deepEqual([by['Robin Alum'].status, by['Robin Alum'].personSlug], ['new', null], 'a former member isn’t Joined');
  assert.deepEqual([by['Tay Quinn'].status, by['Tay Quinn'].personSlug], ['joined', 't-quinn'], 'their email on file decides, whatever the name');
});

// ─── Round four ─────────────────────────────────────────────────────

test('a clock turned back since the application was started (less than no time taken): stored, never dropped as a bot', async () => {
  const r = await apply(GOOD, { startedAt: Date.now() + 3600_000, elapsedMs: -3600_000 + 9 * 60_000 });
  assert.equal(r.res.status, 200);
  assert.equal(r.body.first, 'Jo');
  assert.equal((await listAdvisoryApplications(env.DB)).length, 1);
});

test('which photo is newer goes by the page’s count of picks, never the device’s clock; in-between photos are taken off', async () => {
  const day = 24 * 3600_000;
  await apply(GOOD, { photoAt: Date.now() + day, photoSeq: 5 }); // picked while the clock was a day fast
  const [app] = await listAdvisoryApplications(env.DB);
  const firstPic = images.up[0].id;
  const second = await apply(GOOD, { photoAt: Date.now(), photoSeq: 6 }, { photo: await picture(1000, 1000) }); // the clock put right
  assert.equal(second.res.status, 200);
  assert.equal((await listAdvisoryApplications(env.DB))[0].headshot.width, 1000, 'the newer pick wins, whatever the clocks said');
  const late = await apply(GOOD, { photoAt: Date.now() + 2 * day, photoSeq: 4 }, { photo: await picture(1200, 1200) }); // an older pick arriving late
  assert.equal(late.res.status, 200);
  assert.equal((await listAdvisoryApplications(env.DB))[0].headshot.width, 1000, 'an older pick never replaces it');
  const secondPic = images.up[1].id;
  await apply(GOOD, { photoSeq: 7 }, { photo: await picture(1100, 1100) });
  const stored = JSON.parse((await env.DB.prepare('SELECT headshot FROM advisory_applications WHERE id = ?').bind(app.id).first()).headshot);
  assert.deepEqual(stored.older, [firstPic], 'the first (in the emails) is kept');
  assert.ok(images.down.includes(secondPic), 'one shown in between is taken off Cloudflare');
  assert.ok(!images.down.includes(firstPic));
});

test('replacement photos sent at the same moment: the newest pick wins, whichever request ends first', async () => {
  await apply(GOOD, { photoSeq: 100 });
  await Promise.all([
    apply(GOOD, { photoSeq: 200 }, { photo: await picture(1000, 1000) }),
    apply(GOOD, { photoSeq: 300 }, { photo: await picture(1100, 1100) }),
    apply(GOOD, { photoSeq: 250 }, { photo: await picture(1200, 1200) }),
  ]);
  const stored = JSON.parse((await env.DB.prepare('SELECT headshot FROM advisory_applications').first()).headshot);
  assert.equal(stored.seq, 300);
  assert.equal(stored.width, 1100);
  const pointed = new Set([stored.id, ...(stored.older || [])]);
  assert.deepEqual(images.up.map((u) => u.id).filter((id) => !pointed.has(id) && !images.down.includes(id)), [], 'nothing left up there that nothing points at');
});

test('the same answers sent at the same moment, with no page id or different ones, are one application', async () => {
  const many = await Promise.all([apply(GOOD), apply(GOOD), apply(GOOD, { sendId: 'aaaaaaaaaaaaaaaaaaaa-1' }), apply(GOOD, { sendId: 'bbbbbbbbbbbbbbbbbbbb-2' })]);
  assert.ok(many.every((m) => m.res.status === 200));
  assert.equal((await listAdvisoryApplications(env.DB)).length, 1);
  assert.equal(sent.emails.filter((e) => /^New Advisory/.test(e.subject)).length, 1, 'staff hear once');
  const pointed = JSON.parse((await env.DB.prepare('SELECT headshot FROM advisory_applications').first()).headshot).id;
  assert.deepEqual(images.up.map((u) => u.id).filter((id) => id !== pointed && !images.down.includes(id)), []);
});

test('answers that aren’t words are no answer (never "[object Object]"); a body that isn’t the form didn’t come through; a picture Cloudflare refuses says the robot check was used', async () => {
  const r = await apply({ ...GOOD, fullName: { a: 1 }, why: ['x'] });
  assert.equal(r.res.status, 422);
  assert.deepEqual(Object.keys(r.body.problems).sort(), ['fullName', 'why']);
  const c = ctx('POST', null);
  c.request = new Request('https://site.test/api/advisory-apply', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ answers: GOOD, startedAt: 1 }) });
  const plain = await publicApi.onRequestPost(c);
  assert.equal(plain.status, 400);
  assert.match((await plain.json()).error, /didn’t come through/);
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => (String(input).includes('/images/v1') && (init.method || 'GET') === 'POST'
    ? Response.json({ success: false, errors: [{ code: 5400, message: 'Bad request' }] }, { status: 400 }) : real(input, init));
  const refused = await apply(GOOD);
  globalThis.fetch = real;
  assert.equal(refused.res.status, 422);
  assert.equal(refused.body.spent, true);
});

// ─── Round five ─────────────────────────────────────────────────────

test('a newer photo that meets the first send while it’s still storing: the newer is shown', async () => {
  const realFetch2 = globalThis.fetch;
  let slowFirst = true;
  globalThis.fetch = async (input, init = {}) => {
    if (String(input).includes('/images/v1') && (init.method || 'GET') === 'POST' && slowFirst) { slowFirst = false; await new Promise((r) => setTimeout(r, 150)); }
    return realFetch2(input, init);
  };
  await Promise.all([apply(GOOD, { photoSeq: 1 }), (async () => { await new Promise((r) => setTimeout(r, 30)); return apply(GOOD, { photoSeq: 2 }, { photo: await picture(1000, 1000) }); })()]);
  globalThis.fetch = realFetch2;
  const all = await listAdvisoryApplications(env.DB);
  assert.equal(all.length, 1);
  assert.equal(all[0].headshot.width, 1000, 'the newer pick is shown');
  const stored = JSON.parse((await env.DB.prepare('SELECT headshot FROM advisory_applications').first()).headshot);
  const pointed = new Set([stored.id, ...(stored.older || [])]);
  assert.deepEqual(images.up.map((u) => u.id).filter((id) => !pointed.has(id) && !images.down.includes(id)), []);
});

// ─── Round six ──────────────────────────────────────────────────────

test('notices that didn’t go (the email service down) are sent again by the heartbeat: only what didn’t go, and only up to five tries', async () => {
  const { retryNotices } = await import('../functions/api/_advisory-applications.js');
  const realF = globalThis.fetch;
  globalThis.fetch = async (input, init) => (new URL(typeof input === 'string' ? input : input.url).host === 'api.resend.com' ? Response.json({ message: 'down' }, { status: 500 }) : realF(input, init));
  await apply(GOOD);
  globalThis.fetch = realF;
  const row = await env.DB.prepare('SELECT notified FROM advisory_applications').first();
  assert.deepEqual([JSON.parse(row.notified).applicant, JSON.parse(row.notified).slack], [false, true]);
  sent.emails.length = 0; sent.slack.length = 0;
  const r = await retryNotices(env);
  assert.deepEqual(r, { tried: 1, done: 1 });
  assert.equal(sent.emails.filter((e) => e.to[0] === 'jordan@example.org').length, 1, 'their copy now');
  assert.equal(sent.slack.length, 0, 'Slack had it: not posted twice');
  assert.deepEqual(await retryNotices(env), { tried: 0, done: 0 }, 'nothing left to send');
});

test('the same application sent twice at once from a place at its daily limit: both are thanked, one is stored', async () => {
  const person = (n) => ({ ...GOOD, fullName: `Pat Person${'abcd'[n]}`, email: `pat${n}@example.org`, signature: `Pat Person${'abcd'[n]}` });
  for (let n = 0; n < 4; n++) assert.equal((await apply(person(n), {}, { ip: '198.51.100.40' })).res.status, 200);
  const realF = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => { if (String(input).includes('/images/v1') && (init.method || 'GET') === 'POST') await new Promise((r) => setTimeout(r, 300)); return realF(input, init); };
  const fifth = { ...GOOD, email: 'fifth@example.org' };
  const both = await Promise.all([apply(fifth, {}, { ip: '198.51.100.40' }), apply(fifth, {}, { ip: '198.51.100.40' })]);
  globalThis.fetch = realF;
  assert.deepEqual(both.map((b) => b.res.status), [200, 200]);
  assert.equal((await listAdvisoryApplications(env.DB)).filter((a) => a.email === 'fifth@example.org').length, 1);
});
