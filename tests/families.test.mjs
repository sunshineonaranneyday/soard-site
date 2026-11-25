/**
 * Families (Admin → Families) and a family's update link (/family-update/): functions/api/_families.js,
 * family-update.js, families-admin.js. JobTread is a small in-memory fake that records every write.
 * Run: node --test tests/families.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1 } from './lib/d1-shim.mjs';
import {
  planUpdate, cleanContact, cleanAddress, homeOf, familyAccounts, syncFamilies, createFamilyLink, findFamilyLink, familyEmail,
  recipientsOf, childOf, phoneText, linkState, listFamilies, familyDetail, decideRemoval, sendFamilyLink, LINK_DAYS,
} from '../functions/api/_families.js';
import * as publicApi from '../functions/api/family-update.js';
import * as adminApi from '../functions/api/families-admin.js';
import { barSkips } from '../functions/_apply-bar.js';

const ORG = '22NJw42j5GLg';
const EMAIL = '22NJw43QvHeJ';
const PHONE = '22NJw43UauSc';
const STATUS = '22P46wDp3NLd';

// ── A small JobTread ──

function fakeJT({ accounts = [], jobs = [] } = {}) {
  const state = { accounts: Object.fromEntries(accounts.map((a) => [a.id, a])), jobs, calls: [], n: 0, fail: null };
  const contactNode = (c) => ({ id: c.id, name: c.name, title: c.title ?? null, customFieldValues: { nodes: [[EMAIL, c.email], [PHONE, c.phone]].filter(([, v]) => v).map(([id, value]) => ({ value, customField: { id } })) } });
  const accountNode = (a) => ({
    id: a.id, name: a.name, type: a.type || 'customer', archivedAt: a.archivedAt || null, organization: { id: a.org || ORG },
    primaryContact: a.primary ? { id: a.primary } : null,
    contacts: { nodes: (a.contacts || []).map(contactNode) },
    primaryLocation: a.home === undefined ? { id: `loc-${a.id}`, address: null, street: null, city: null, state: 'AK', postalCode: null } : a.home,
    customFieldValues: { nodes: Object.entries(a.fields || {}).map(([id, value]) => ({ value, customField: { id } })) },
  });
  const find = (id) => Object.values(state.accounts).flatMap((a) => a.contacts || []).find((c) => c.id === id);
  const fetchImpl = async (url, init) => {
    const { query } = JSON.parse(init.body);
    const { $, ...rest } = query;
    const out = {};
    for (const [key, v] of Object.entries(rest)) {
      if (state.fail && state.fail(key, v)) return new Response('JobTread is down', { status: 503 });
      if (key === 'account') { const a = state.accounts[v.$.id]; out.account = a ? accountNode(a) : null; }
      else if (key === 'organization') {
        if (v.jobs) out.organization = { jobs: { nextPage: null, nodes: state.jobs.map((j) => ({ id: j.id, name: j.name, closedOn: j.closedOn || null, location: { account: { id: j.account, type: 'customer' } } })) } };
        else if (v.accounts) {
          const ids = v.accounts.$.where[2];
          out.organization = { accounts: { nodes: ids.map((id) => state.accounts[id]).filter(Boolean).map(accountNode) } };
        } else throw new Error('fake JobTread: which organization list?');
      } else if (key === 'updateContact') {
        state.calls.push({ updateContact: v.$ });
        const c = find(v.$.id);
        if (v.$.name) c.name = v.$.name;
        if ('title' in v.$) c.title = v.$.title;
        const cf = v.$.customFieldValues || {};
        if (EMAIL in cf) c.email = cf[EMAIL];
        if (PHONE in cf) c.phone = cf[PHONE];
        out.updateContact = {};
      } else if (key === 'createContact') {
        state.calls.push({ createContact: v.$ });
        const cf = v.$.customFieldValues || {};
        const c = { id: `C${++state.n}xxxxxx`, name: v.$.name, title: v.$.title || null, email: cf[EMAIL] || null, phone: cf[PHONE] || null };
        state.accounts[v.$.accountId].contacts.push(c);
        out.createContact = { createdContact: { id: c.id } };
      } else if (key === 'deleteContact') {
        state.calls.push({ deleteContact: v.$ });
        for (const a of Object.values(state.accounts)) a.contacts = (a.contacts || []).filter((c) => c.id !== v.$.id);
        out.deleteContact = {};
      } else throw new Error(`fake JobTread doesn't know ${key}`);
    }
    return new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { state, fetchImpl, writes: () => state.calls };
}

const HOME = { id: 'locStone1', address: '12 Oak St, Roswell, GA 30075', street: '12 Oak St', city: 'Roswell', state: 'GA', postalCode: '30075' };
const stones = () => ({
  id: 'AcctStone01', name: 'Avery Stone', primary: 'CJordan01', home: HOME, fields: { [STATUS]: 'Approved' },
  contacts: [
    { id: 'CJordan01', name: 'Jordan Stone', title: 'Mother', email: 'jordan@example.com', phone: '+14045550100' },
    { id: 'CRiley001', name: 'Riley Stone', title: 'Father', email: 'riley@example.com', phone: '770.555.0199 ext 4' },
  ],
});
const past = () => ({ id: 'AcctMath01', name: 'Mathew (2012)', contacts: [] });

async function world({ accounts = [stones(), past()], jobs } = {}) {
  const DB = await createD1({ schemaFiles: ['scripts/schema.sql'] });
  for (const k of [{ slug: 'avery', name: 'Avery', year: 2026 }, { slug: 'mathew', name: 'Mathew', year: 2012 }, { slug: 'nobody', name: 'Quinn', year: 2014 }]) {
    await DB.prepare('INSERT INTO kids (slug, name, year, data) VALUES (?, ?, ?, ?)').bind(k.slug, k.name, k.year, JSON.stringify(k)).run();
  }
  const jt = fakeJT({ accounts, jobs: jobs || [{ id: 'JobAvery1', name: 'Avery (2026)', account: 'AcctStone01' }, { id: 'JobMath01', name: 'Mathew (2012)', account: 'AcctMath01', closedOn: '2012-12-01' }] });
  const env = { DB, JOBTREAD_GRANT_KEY: 'test-key' };
  // The site's modules call pave with the global fetch unless given one: route JobTread to the fake, Resend to a recorder
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('api.jobtread.com')) return jt.fetchImpl(url, init);
    if (String(url).includes('api.resend.com')) {
      const list = JSON.parse(init.body);
      sent.push(...(Array.isArray(list) ? list : [list]));
      return new Response(JSON.stringify({ data: (Array.isArray(list) ? list : [list]).map((_, i) => ({ id: `re_${sent.length}_${i}` })) }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  return { DB, env, jt, sent, done: () => { globalThis.fetch = realFetch; } };
}
const ctx = (env, request) => ({ env, request, data: { userEmail: 'linzi@soardcharity.com' }, waitUntil: (p) => p });
const get = (env, token) => publicApi.onRequestGet(ctx(env, new Request(`https://sunshineonaranneyday.com/api/family-update?token=${encodeURIComponent(token)}`)));
const post = (env, body) => publicApi.onRequestPost(ctx(env, new Request('https://sunshineonaranneyday.com/api/family-update', { method: 'POST', body: JSON.stringify(body) })));
const admin = (env, body) => adminApi.onRequestPost(ctx(env, new Request('https://sunshineonaranneyday.com/api/families-admin', { method: 'POST', body: JSON.stringify(body) })));
const adminGet = (env, q) => adminApi.onRequestGet(ctx(env, new Request(`https://sunshineonaranneyday.com/api/families-admin?${q}`)));

// ── The pure parts ──

test('planUpdate: only what changed, nobody added twice, removals and strangers named', () => {
  const current = stones().contacts;
  const same = planUpdate(current, current.map((c) => cleanContact(c, 0, c)));
  assert.deepEqual(same, { edits: [], adds: [], removes: [], unknown: [] }, 'sending it back as it is changes nothing');

  const plan = planUpdate(current, [
    cleanContact({ id: 'CJordan01', name: 'Jordan Stone', title: 'Mother', email: 'JORDAN@example.com', phone: '(404) 555-0111' }, 0, current[0]),
    cleanContact({ id: 'CRiley001', remove: true }, 1),
    cleanContact({ name: 'Pat Stone', title: 'Grandmother', email: 'pat@example.com' }, 2),
    cleanContact({ name: 'Pat Stone', title: 'Grandmother', email: 'pat@example.com' }, 3),
    cleanContact({ id: 'CGoneAway1', name: 'Someone', email: 'x@example.com' }, 4),
  ]);
  assert.deepEqual(plan.edits, [{ id: 'CJordan01', name: 'Jordan Stone', fields: { phone: ['+14045550100', '+14045550111'] } }], 'an email in capitals is the same email');
  assert.deepEqual(plan.adds, [{ name: 'Pat Stone', title: 'Grandmother', email: 'pat@example.com', phone: '' }], 'the same new person twice is added once');
  assert.deepEqual(plan.removes, [{ id: 'CRiley001', name: 'Riley Stone' }]);
  assert.deepEqual(plan.unknown, ['CGoneAway1']);

  // A "new" person who is already there (the same email) fills them in instead of adding a second
  const twin = planUpdate(current, [cleanContact({ name: 'Jordan Stone', title: '', email: 'jordan@example.com', phone: '' }, 0)]);
  assert.deepEqual(twin, { edits: [], adds: [], removes: [], unknown: [] }, 'a twin with less never blanks what JobTread has');
});

test('cleanContact: each problem names its box; what JobTread already had is never questioned', () => {
  const err = (c, i, before) => { try { cleanContact(c, i, before); return null; } catch (e) { return [e.message, e.field]; } };
  assert.deepEqual(err({ name: '', email: 'a@b.co' }, 2), ['Add a name for each person.', 'contacts.2.name']);
  assert.match(err({ name: 'Pat', email: 'pat@' }, 1)[0], /email for Pat/);
  assert.equal(err({ name: 'Pat', email: 'pat@' }, 1)[1], 'contacts.1.email');
  assert.equal(err({ name: 'Pat', phone: '555-01' }, 0)[1], 'contacts.0.phone');
  assert.match(err({ name: 'Pat' }, 3)[0], /email or a phone number for Pat/, 'someone new needs a way to reach them');
  assert.equal(err({ id: 'CRiley001', name: 'Riley Stone' }, 0), null, 'someone already on file may have neither');
  const riley = stones().contacts[1];
  assert.equal(cleanContact({ id: riley.id, name: 'Riley Stone', phone: '770.555.0199 ext 4' }, 0, riley).phone, riley.phone, 'an odd phone from JobTread, unchanged, stays as it was');
  assert.equal(cleanContact({ name: 'Pat', phone: '404 555 0123' }).phone, '+14045550123');
});

test('cleanAddress: the address on file sent back is never questioned; a new one needs every part', () => {
  const onFile = { line1: '12 Oak St', line2: '', city: 'Roswell', state: 'GA', zip: '' };
  assert.equal(cleanAddress({ ...onFile }, onFile), null, 'no ZIP in JobTread does not stop a phone change');
  assert.equal(cleanAddress({ same: true }), null);
  assert.equal(cleanAddress({ line1: '', city: '', zip: '' }), null, 'left empty: nothing to say');
  assert.throws(() => cleanAddress({ line1: '9 Elm', city: 'Marietta', state: 'ga', zip: '300' }, onFile), (e) => e.field === 'address.zip');
  assert.deepEqual(cleanAddress({ line1: '9 Elm', city: 'Marietta', state: 'ga', zip: '30060' }, onFile), { line1: '9 Elm', line2: '', city: 'Marietta', state: 'GA', zip: '30060' });
});

test('homeOf: a past makeover\u2019s empty location is no address (JobTread\u2019s map reads "null" as Alaska)', () => {
  assert.equal(homeOf({ id: 'L1', address: null, street: null, city: null, state: 'AK', formattedAddress: 'Nullaq Lake, Alaska, USA' }), null);
  assert.deepEqual(homeOf(HOME), { line1: '12 Oak St', line2: '', city: 'Roswell', state: 'GA', zip: '30075', text: '12 Oak St, Roswell, GA 30075' });
});

test('familyAccounts: each kid page\u2019s job\u2019s customer, and approved applicants', () => {
  const kids = [{ slug: 'avery', name: 'Avery', year: 2026, data: {} }, { slug: 'mathew', name: 'Mathew', year: 2012, data: {} }];
  const jobs = [
    { id: 'J1', name: 'Avery (2026)', location: { account: { id: 'AcctStone01', type: 'customer' } } },
    { id: 'J2', name: 'Mathew (2012)', closedOn: '2012-12-01', location: { account: { id: 'AcctMath01', type: 'customer' } } },
    { id: 'J3', name: 'TEST Avery (2026)', location: { account: { id: 'AcctTest001', type: 'customer' } } },
  ];
  const map = familyAccounts(jobs, kids, [{ account_id: 'AcctNew0001' }]);
  assert.deepEqual([...map.keys()].sort(), ['AcctMath01', 'AcctNew0001', 'AcctStone01']);
  assert.deepEqual(map.get('AcctStone01'), [{ slug: 'avery', name: 'Avery', year: '2026' }]);
  assert.deepEqual(map.get('AcctNew0001'), []);
});

test('the email: who it goes to, what it says, and no em dashes', () => {
  const m = familyEmail({ greeting: 'Jordan and Riley Stone', child: 'Avery', url: 'https://sunshineonaranneyday.com/family-update/#t=abc', expiresAt: '2027-01-24T12:00:00Z' });
  assert.equal(m.subject, 'Is this still the best way to reach you?');
  assert.match(m.html, /family-update\/#t=abc/);
  assert.match(m.text, /Hi Jordan and Riley Stone,/);
  assert.match(m.text, /works until January 24, 2027/);
  for (const s of [m.subject, m.html, m.text]) assert.doesNotMatch(s, /\u2014/, 'no em dashes');
  assert.deepEqual(recipientsOf([{ email: 'A@x.com' }, { email: 'a@x.com' }, { email: '' }, { email: 'b@x.com' }]).map((r) => r.email), ['a@x.com', 'b@x.com']);
  assert.equal(childOf([], 'Mathew (2012)'), 'Mathew');
  assert.equal(childOf([{ name: 'Ta' }, { name: 'Alissa' }], 'x'), 'Ta and Alissa');
  assert.equal(phoneText('+14045550100'), '(404) 555-0100');
  assert.equal(phoneText('770.555.0199 ext 4'), '770.555.0199 ext 4');
});

// ── The whole way through ──

test('sync: every family with a makeover, the kid pages without one, and a past family with no address', async () => {
  const w = await world();
  try {
    const out = await syncFamilies(w.env);
    assert.deepEqual(out, { families: 2, kidsWithoutFamily: 1 });
    const list = await listFamilies(w.DB);
    const stone = list.families.find((f) => f.id === 'AcctStone01');
    assert.deepEqual(stone.kids, [{ slug: 'avery', name: 'Avery', year: '2026' }]);
    assert.equal(stone.contacts.length, 2);
    assert.equal(stone.contacts.find((c) => c.main).name, 'Jordan Stone');
    assert.equal(stone.home.city, 'Roswell');
    assert.equal(list.families.find((f) => f.id === 'AcctMath01').home, null);
    assert.deepEqual(list.kidsWithoutFamily.map((k) => k.slug), ['nobody']);
    assert.equal(w.jt.writes().length, 0, 'reading writes nothing to JobTread');
  } finally { w.done(); }
});

test('a family opens their link, confirms, then changes things: JobTread gets the changes, removals wait for staff', async () => {
  const w = await world();
  try {
    await syncFamilies(w.env);
    const link = await createFamilyLink(w.DB, 'AcctStone01', { by: 'linzi@soardcharity.com' });
    assert.match(link.url, /^https:\/\/sunshineonaranneyday\.com\/family-update\/#t=[A-Za-z0-9_-]{32}$/);

    const opened = await (await get(w.env, link.token)).json();
    assert.equal(opened.ok, true);
    assert.equal(opened.family.child, 'Avery');
    assert.equal(opened.family.greeting, 'Jordan and Riley Stone');
    assert.deepEqual(opened.family.contacts.map((c) => [c.name, c.title, c.phone, !!c.main]), [['Jordan Stone', 'Mother', '(404) 555-0100', true], ['Riley Stone', 'Father', '770.555.0199 ext 4', false]]);
    assert.deepEqual(opened.family.address, { line1: '12 Oak St', line2: '', city: 'Roswell', state: 'GA', zip: '30075' });
    assert.ok((await w.DB.prepare('SELECT opened_at FROM family_links WHERE id = ?').bind(link.id).first()).opened_at, 'opening is noted');

    // "Yes, this is all correct": what the page showed, sent back
    const confirm = await (await post(w.env, { token: link.token, contacts: opened.family.contacts, address: { same: true } })).json();
    assert.deepEqual([confirm.ok, confirm.kind, confirm.added, confirm.changed], [true, 'confirmed', 0, 0]);
    assert.equal(w.jt.writes().length, 0, 'confirming writes nothing to JobTread');

    // A new phone for Jordan, Riley taken off, Pat added, and they moved
    const body = {
      token: link.token,
      contacts: [
        { ...opened.family.contacts[0], phone: '404-555-0111' },
        { id: 'CRiley001', remove: true, name: 'Riley Stone' },
        { name: 'Pat Stone', title: 'Grandmother', email: 'pat@example.com', phone: '' },
      ],
      address: { line1: '9 Elm St', line2: 'Apt 2', city: 'Marietta', state: 'GA', zip: '30060' },
      note: 'Pat helps with pickups.',
    };
    const changed = await (await post(w.env, body)).json();
    assert.deepEqual([changed.ok, changed.kind, changed.added, changed.changed, changed.removeAsked, changed.moved], [true, 'updated', 1, 1, 1, true]);
    assert.deepEqual(w.jt.writes(), [
      { updateContact: { id: 'CJordan01', customFieldValues: { [PHONE]: '+14045550111' } } },
      { createContact: { accountId: 'AcctStone01', name: 'Pat Stone', title: 'Grandmother', customFieldValues: { [EMAIL]: 'pat@example.com' } } },
    ], 'Riley stays in JobTread until staff say so');

    // Pressed twice: nobody added twice, nothing written again
    const again = await (await post(w.env, body)).json();
    assert.equal(again.added, 0);
    assert.equal(w.jt.writes().length, 2);

    const d = await familyDetail(w.DB, 'AcctStone01');
    assert.deepEqual(d.contacts.map((c) => c.name).sort(), ['Jordan Stone', 'Pat Stone', 'Riley Stone']);
    assert.deepEqual(d.mailing && [d.mailing.line1, d.mailing.city, d.mailing.zip], ['9 Elm St', 'Marietta', '30060']);
    assert.equal(d.removals.length, 1, 'one removal waiting, asked once');
    assert.equal(d.updates[2].kind, 'confirmed');
    assert.deepEqual(d.updates[1].changes.map((c) => c.type), ['edit', 'add', 'remove-ask']);
    assert.equal(d.updates[1].note, 'Pat helps with pickups.');
    assert.equal(d.updates[1].address.before, '12 Oak St, Roswell, GA 30075');
    assert.equal(linkState((await w.DB.prepare('SELECT * FROM family_links WHERE id = ?').bind(link.id).first())), 'answered');

    // Opened again later: the new address and Pat are there
    const later = await (await get(w.env, link.token)).json();
    assert.equal(later.family.answered, true);
    assert.equal(later.family.address.line1, '9 Elm St');
    assert.ok(later.family.contacts.some((c) => c.name === 'Pat Stone'));

    // Staff: Jordan is the main contact and can't be taken off; Riley can
    const keep = await (await admin(w.env, { removal: { id: d.removals[0].id, decision: 'remove' } })).json();
    assert.equal(keep.ok, true);
    assert.deepEqual(w.jt.writes().at(-1), { deleteContact: { id: 'CRiley001' } });
    const main = await admin(w.env, { save: { id: 'AcctStone01', contacts: [{ id: 'CJordan01', remove: true }] } });
    assert.equal(main.status, 400);
    assert.match((await main.json()).error, /Jordan Stone is the main contact in JobTread/);
    assert.ok(!w.jt.writes().some((c) => c.deleteContact?.id === 'CJordan01'));
  } finally { w.done(); }
});

test('a bad box comes back named; a bot is answered and ignored; JobTread down saves nothing', async () => {
  const w = await world();
  try {
    await syncFamilies(w.env);
    const { token } = await createFamilyLink(w.DB, 'AcctStone01');
    const res = await post(w.env, { token, contacts: [{ name: 'Pat', email: 'pat@nowhere' }], address: { same: true } });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { ok: false, error: 'That email for Pat doesn’t look right.', field: 'contacts.0.email' });

    const bot = await (await post(w.env, { token, contacts: [{ name: 'Spam', email: 'spam@spam.com' }], 'leave-this-empty': 'http://spam' })).json();
    assert.deepEqual(bot, { ok: true, kind: 'confirmed' });
    assert.equal(w.jt.writes().length, 0);

    w.jt.state.fail = (key) => key === 'createContact';
    const down = await post(w.env, { token, contacts: [{ name: 'Pat Stone', email: 'pat@example.com' }], address: { same: true } });
    assert.equal(down.status, 503);
    assert.equal((await w.DB.prepare('SELECT count(*) AS n FROM family_updates').first()).n, 0, 'nothing logged as saved');
  } finally { w.done(); }
});

test('links: one live link per family, expired and replaced links say so', async () => {
  const w = await world();
  try {
    const first = await createFamilyLink(w.DB, 'AcctStone01', { now: Date.now() - (LINK_DAYS + 1) * 864e5 });
    assert.equal((await findFamilyLink(w.DB, first.token)).problem, 'expired');
    const second = await createFamilyLink(w.DB, 'AcctStone01');
    assert.equal((await findFamilyLink(w.DB, first.token)).problem, 'closed');
    assert.equal((await findFamilyLink(w.DB, second.token)).problem, null);
    assert.equal((await get(w.env, first.token)).status, 410);
    assert.equal((await get(w.env, 'not-a-real-token-at-all-xx')).status, 404);
    assert.equal((await get(w.env, '')).status, 404);
  } finally { w.done(); }
});

test('Send update link: emailed to everyone with an address, logged; a family with no email is told', async () => {
  const w = await world();
  try {
    await syncFamilies(w.env);
    const env = { ...w.env, RESEND_API_KEY: 're_test' };
    const out = await (await admin(env, { send: { ids: ['AcctStone01', 'AcctMath01'] } })).json();
    assert.equal(out.sent, 1);
    assert.deepEqual(out.results[0], { id: 'AcctStone01', ok: true, to: ['jordan@example.com', 'riley@example.com'] });
    assert.deepEqual(out.results[1], { id: 'AcctMath01', ok: false, error: 'Nobody in this family has an email address yet. Add one first.' });
    assert.deepEqual(w.sent.map((m) => m.to[0]), ['jordan@example.com', 'riley@example.com']);
    assert.match(w.sent[0].html, /family-update\/#t=/);
    const l = (await listFamilies(w.DB)).families.find((f) => f.id === 'AcctStone01').link;
    assert.equal(l.state, 'sent');
    assert.deepEqual(l.sentTo, ['jordan@example.com', 'riley@example.com']);
    assert.equal(l.sentBy, 'linzi@soardcharity.com');

    // Staff add a parent's email to the past family, then it can go
    const saved = await (await admin(env, { save: { id: 'AcctMath01', contacts: [{ name: 'Maria Lopez', title: 'Mother', email: 'maria@example.com' }] } })).json();
    assert.equal(saved.ok, true);
    assert.equal(saved.family.contacts[0].email, 'maria@example.com');
    const out2 = await (await admin(env, { send: { ids: ['AcctMath01'] } })).json();
    assert.equal(out2.sent, 1);
    assert.match(w.sent.at(-1).html, /Mathew/);

    const preview = await (await adminGet(env, 'preview=sample')).json();
    assert.equal(preview.subject, 'Is this still the best way to reach you?');
    assert.match(preview.html, /Avery/);
    assert.equal((await adminGet(env, 'id=AcctStone01').then((r) => r.json())).family.links[0].state, 'sent');
  } finally { w.done(); }
});

test('the page is private: public API, rate limited, no application bar, not in the sitemap, not indexed', () => {
  const mw = readFileSync('functions/api/_middleware.js', 'utf8');
  assert.match(mw, /PUBLIC_ROUTES\.push\('\/api\/family-update'\)/);
  assert.match(mw.match(/const RATE_LIMITED_POST_ROUTES = new Set\(\[(.*?)\]\)/s)[1], /'\/api\/family-update'/);
  assert.ok(!/families-admin/.test(mw), 'the admin side stays behind Access');
  assert.equal(barSkips('/family-update/'), true);
  assert.match(readFileSync('astro.config.mjs', 'utf8'), /!page\.includes\('\/family-update'\)/);
  const page = readFileSync('src/pages/family-update.astro', 'utf8');
  assert.match(page, /<BaseLayout[^>]*\bnoindex>/);
  assert.match(page, /location\.hash/, 'the token is read from the fragment');
  assert.match(page, /<BotTrap \/>/);
});

test('Emails & invites knows it: the map entry, its preview, and what went out', async () => {
  const { buildPreview } = await import('../functions/api/messages-admin.js');
  const { entryFor, audienceOf } = await import('../functions/api/_email-log.js');
  const DB = await createD1({ schemaFiles: ['scripts/schema.sql'] });
  const p = await buildPreview({ DB }, 'family-update');
  assert.equal(p.subject, 'Is this still the best way to reach you?');
  assert.match(p.text, /Hi Jordan and Sam Stone,/);
  assert.equal(entryFor('family-update', p.subject), 'family-update');
  assert.equal(audienceOf('family-update'), 'family');
  assert.match(readFileSync('public/admin/messages.js', 'utf8'), /preview: 'family-update'/);
});
