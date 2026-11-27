/**
 * Photos & Videos' intake: photos and videos the team emails to photos@sunshineonaranneyday.com or texts to SOARD
 * Photos' number (functions/api/_media-inbox.js, media-inbox.js, media-text.js, media-file.js, workers/media-inbox).
 * Real MIME built byte by byte (as iPhone Mail and Gmail send it, with the receiving server's checks), photos carrying
 * real EXIF (where and when taken), Twilio's form and signature. Made-up people, numbers and places only.
 * Run: node --test tests/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';
import { createR2 } from './lib/r2-shim.mjs';
import { tiff, jpeg, heic } from './lib/exif-fixtures.mjs';
import * as IN from '../functions/api/_media-inbox.js';
import { onRequestPost as inboxPost } from '../functions/api/media-inbox.js';
import { onRequestPost as textPost } from '../functions/api/media-text.js';
import { onRequestGet as fileGet } from '../functions/api/media-file.js';
import { onRequestGet as adminGet, onRequestPost as adminPost } from '../functions/api/media-admin.js';
import { onRequestGet as dlGet } from '../functions/api/media-download.js';
import { onRequestGet as thumbGet } from '../functions/api/media-thumb.js';
import { search, itemFor } from '../functions/api/_media-search.js';
import { twilioSignature } from '../functions/api/twilio-status.js';
import worker, { keep, tell } from '../workers/media-inbox/src/index.js';

// Node has no FixedLengthStream (Workers do): a stream that passes bytes through, its length known to R2
globalThis.FixedLengthStream ||= class { constructor() { const t = new TransformStream(); this.readable = t.readable; this.writable = t.writable; } };

const SECRET = 'test-media-inbox-secret';
const ACCT = `AC${'a'.repeat(32)}`;
const COLIN_HOME = { lat: 34.05, lng: -84.3 };

// ─── Messages as phones send them ──────────────────────────────────
const b64 = (bytes) => Buffer.from(bytes).toString('base64').replace(/.{76}/g, '$&\r\n');
/** A real MIME message: multipart/mixed with base64 parts, and the line Cloudflare's mail servers add */
function eml({ from = 'jane@soardcharity.com', fromName = 'Jane Doe', to = IN.ADDRESS, subject = 'Photos', text = 'Here you go\n\nSent from my iPhone', html = null, auth = 'pass', messageId = `<${Math.random().toString(36).slice(2)}@example.com>`, files = [] } = {}) {
  const domain = from.split('@')[1];
  const authLine = auth === 'pass' ? `mx.cloudflare.net; dkim=pass header.d=${domain} header.s=google header.b=abc123; dmarc=pass header.from=${domain} policy.dmarc=quarantine; spf=pass smtp.mailfrom=${domain}`
    : auth === 'dkim-only' ? `mx.cloudflare.net; dkim=pass header.d=${domain} header.s=s1; dmarc=none header.from=${domain}; spf=softfail smtp.mailfrom=${domain}`
    : `mx.cloudflare.net; dkim=none; dmarc=fail header.from=${domain} policy.dmarc=reject; spf=fail smtp.mailfrom=bad.example`;
  const B = 'Apple-Mail=_TEST-BOUNDARY';
  const parts = [`--${B}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 7bit\r\n\r\n${text}\r\n`];
  if (html) parts.push(`--${B}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: 7bit\r\n\r\n${html}\r\n`);
  for (const f of files) {
    parts.push(`--${B}\r\nContent-Type: ${f.type}; name="${f.name}"\r\nContent-Disposition: ${f.inline ? 'inline' : 'attachment'}; filename="${f.name}"\r\n${f.inline ? `Content-Id: <${f.name}@x>\r\n` : ''}Content-Transfer-Encoding: base64\r\n\r\n${b64(f.bytes)}\r\n`);
  }
  return new TextEncoder().encode([
    `Authentication-Results: ${authLine}`, `From: ${fromName} <${from}>`, `To: ${to}`, `Subject: ${subject}`, `Message-Id: ${messageId}`,
    'Date: Tue, 25 Nov 2026 15:04:05 -0500', 'Mime-Version: 1.0', `Content-Type: multipart/mixed; boundary="${B}"`, '', ...parts, `--${B}--`, '',
  ].join('\r\n'));
}
const photo = (facts, size = 30000) => { const j = new Uint8Array(jpeg(tiff(facts))); const out = new Uint8Array(Math.max(size, j.length)); out.set(j); return out; };
const heicPhoto = (facts, size = 40000) => { const h = new Uint8Array(heic(tiff(facts))); const out = new Uint8Array(Math.max(size, h.length)); out.set(h); return out; };

// ─── The world ─────────────────────────────────────────────────────
async function world() {
  const DB = await createD1({ schemaSql: [
    'CREATE TABLE kids (slug TEXT PRIMARY KEY, name TEXT, data TEXT)', 'CREATE TABLE events (slug TEXT PRIMARY KEY, title TEXT, data TEXT)', 'CREATE TABLE community (slug TEXT PRIMARY KEY, name TEXT, data TEXT)',
    'CREATE TABLE site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)',
    'CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)',
    `CREATE TABLE broadcasts (id TEXT PRIMARY KEY, kid_slug TEXT, kid_name TEXT, title TEXT, message TEXT, image TEXT, scheduled_at TEXT, live_at TEXT, ended_at TEXT, phase TEXT, live_video_uid TEXT, replay_uid TEXT, fb_live_video_id TEXT, fb_permalink TEXT, source TEXT, data TEXT, created_at TEXT, updated_at TEXT)`,
  ] });
  for (const [slug, d] of [['colin', { name: 'Colin', year: 2026, status: 'in-progress', publishStatus: 'published', roomTypes: ['Accessible Bathroom'] }],
    ['ben', { name: 'Ben', year: 2026, status: 'in-progress', publishStatus: 'published' }], ['ava', { name: 'Ava', year: 2026, status: 'completed', publishStatus: 'published' }]]) {
    await DB.prepare('INSERT INTO kids VALUES (?, ?, ?)').bind(slug, d.name, JSON.stringify({ ...d, slug })).run();
  }
  await DB.prepare('INSERT INTO events VALUES (?, ?, ?)').bind('gala-2026', '2026 Example Gala', JSON.stringify({ slug: 'gala-2026', title: '2026 Example Gala', date: '2026-08-22', status: 'past' })).run();
  await DB.prepare("INSERT INTO site_config VALUES ('broadcast-config', ?, '')").bind(JSON.stringify({ alerts: { phones: ['+14045550100'] } })).run();
  await DB.prepare("INSERT INTO site_config VALUES ('reveals', ?, '')").bind(JSON.stringify({ upcoming: [], past: [{ slug: 'ava', name: 'Ava', date: '2026-11-20' }] })).run();
  const made = [];
  const env = {
    DB, MEDIA_FILES: createR2(), MEDIA_INBOX_SECRET: SECRET, CF_ACCOUNT_ID: 'acct', CF_STREAM_TOKEN: 'st', TWILIO_ACCOUNT_SID: ACCT, TWILIO_AUTH_TOKEN: 'tw-token', RESEND_API_KEY: 're_test',
    // Cloudflare's Images binding: reads the whole original (as it must) and hands back a JPEG of the size asked
    IMAGES: { input(stream) { let opts = {}; return { transform(o) { opts = o; return this; }, async output(o) { const n = (await new Response(stream).arrayBuffer()).byteLength; made.push({ opts, out: o, n }); return { response: () => new Response(new TextEncoder().encode(`JPEG ${opts.width} of ${n}`), { headers: { 'Content-Type': 'image/jpeg' } }) }; } }; } },
  };
  return { env, made };
}
const filing = { kids: [{ slug: 'colin', name: 'Colin', year: 2026 }, { slug: 'ben', name: 'Ben', year: 2026 }, { slug: 'ava', name: 'Ava', year: 2026 }],
  events: [{ slug: 'gala-2026', title: '2026 Example Gala', date: '2026-08-22' }], projects: [], homes: [{ slug: 'colin', ...COLIN_HOME }], reveals: [{ slug: 'ava', date: '2026-11-20' }] };

/** A fake Cloudflare Stream, Twilio, Mail Drop and Resend: what each was asked */
function fakes() {
  const asked = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    asked.push({ url, method: init.method || 'GET', body: init.body, auth: init.headers?.Authorization || init.headers?.authorization });
    if (url.endsWith('/stream/copy')) return Response.json({ success: true, result: { uid: 'f'.repeat(32) } });
    if (url.startsWith('https://api.twilio.com/') && /\/Media\/ME[a-f0-9]{32}$/.test(url)) return new Response(photo({ lat: 33.7, lng: -84.4, taken: '2026:11:24 10:00:00' }), { headers: { 'Content-Type': 'image/jpeg' } });
    if (url.startsWith('https://api.twilio.com/') && url.endsWith('.json') && init.method === 'DELETE') return new Response(null, { status: 204 });
    if (url.startsWith('https://api.twilio.com/') && url.endsWith('/Messages.json')) return Response.json({ sid: 'SMreply' });
    if (url.startsWith('https://cvws.icloud-content.com/')) return new Response(new Uint8Array(600000).fill(7), { headers: { 'Content-Type': 'video/quicktime', 'Content-Length': '600000' } });
    if (url === 'https://api.resend.com/emails') return Response.json({ id: 'em_1' });
    return new Response('offline', { status: 503 });
  };
  return { asked, restore: () => { globalThis.fetch = real; } };
}
const rows = async (DB, where = "source = 'inbox'") => (await DB.prepare(`SELECT * FROM media_items WHERE ${where} ORDER BY id`).all()).results;

// ─── Who sent it ───────────────────────────────────────────────────

test('the sender is proven by the receiving server’s checks, never by what the email says', () => {
  const pass = IN.authOf([{ key: 'authentication-results', value: 'mx.cloudflare.net; dkim=pass header.d=soardcharity.com header.s=google; dmarc=pass header.from=soardcharity.com; spf=pass smtp.mailfrom=soardcharity.com' }]);
  assert.equal(IN.provenFrom('jane@soardcharity.com', pass), true);
  const dkimOnly = IN.authOf([{ key: 'authentication-results', value: 'mx.cloudflare.net; dkim=pass header.d=gmail.com; dmarc=none' }]);
  assert.equal(IN.provenFrom('sam.social@gmail.com', dkimOnly), true);
  assert.equal(IN.provenFrom('jane@soardcharity.com', dkimOnly), false, 'signed by someone else’s domain');
  // A line the sender wrote themselves is ignored when the receiving server's own is there
  const forged = IN.authOf([{ key: 'authentication-results', value: 'evil.example; dmarc=pass' }, { key: 'authentication-results', value: 'mx.cloudflare.net; dmarc=fail; dkim=none' }]);
  assert.equal(IN.provenFrom('jane@soardcharity.com', forged), false);
});

test('the note, the stage and where it goes: the name typed, the home it was taken at, the day, else Sent in by the team', () => {
  assert.equal(IN.noteOf('Colin demo day pics\n\nSent from my iPhone\n> old reply'), 'Colin demo day pics');
  assert.equal(IN.noteOf('Here\n--\nJane Doe\nProgram Director'), 'Here');
  assert.equal(IN.stageOfWords('Colin demo day'), 'During');
  assert.equal(IN.stageOfWords('ava reveal!'), 'After');
  assert.equal(IN.stageOfWords('before photos'), 'Before');
  assert.deepEqual(IN.fileTo('Colin demo day', null, filing), { album: 'kid:colin', by: 'name' });
  assert.deepEqual(IN.fileTo('gala photos', null, filing), { album: 'event:gala-2026', by: 'name' });
  assert.deepEqual(IN.fileTo('', { ...COLIN_HOME, taken: '2026-10-01T10:00:00-05:00' }, filing), { album: 'kid:colin', by: 'home' });
  assert.deepEqual(IN.fileTo('', { lat: 0, lng: 0, taken: '2026-11-20T15:00:00-05:00' }, filing), { album: 'kid:ava', by: 'day' });
  assert.deepEqual(IN.fileTo('random pics', null, filing), { album: IN.INBOX_ALBUM, by: null });
  // The words win over the place: someone sending Ben's photos from Colin's street
  assert.deepEqual(IN.fileTo('ben', COLIN_HOME, filing), { album: 'kid:ben', by: 'name' });
});

test('an email’s files: every photo and video, inline too, never a signature’s logo; a PDF said so; a Mail Drop link found', async () => {
  const raw = eml({
    subject: 'Colin progress', html: '<p>the video is big:</p><a href="https://www.icloud.com/attachment/?u=https%3A%2F%2Fcvws.icloud-content.com%2FB%2FAbCd%2F%24%7Bf%7D%3Fo%3Dx%26v%3D1&amp;uk=k1&amp;f=IMG_0042.MOV&amp;sz=600000">IMG_0042.MOV</a>',
    files: [{ name: 'IMG_0001.HEIC', type: 'image/heic', bytes: heicPhoto({ ...COLIN_HOME, taken: '2026:11:20 10:00:00' }) }, { name: 'IMG_0002.jpeg', type: 'image/jpeg', bytes: photo({ lat: 1, lng: 1, taken: '2026:11:20 10:00:00' }), inline: true },
      { name: 'logo.png', type: 'image/png', bytes: new Uint8Array(2000), inline: true }, { name: 'estimate.pdf', type: 'application/pdf', bytes: new Uint8Array(4000) }],
  });
  const p = await IN.emailParts(raw);
  assert.deepEqual(p.files.map((f) => f.name), ['IMG_0001.HEIC', 'IMG_0002.jpeg']);
  assert.deepEqual(p.skipped, ['estimate.pdf']);
  assert.deepEqual(p.links, [{ kind: 'maildrop', url: 'https://cvws.icloud-content.com/B/AbCd/IMG_0042.MOV?o=x&v=1', name: 'IMG_0042.MOV', size: 600000 }]);
  assert.equal(p.from, 'jane@soardcharity.com');
  const facts = IN.factsOf(p.files[0].bytes, p.files[0]);
  assert.ok(Math.abs(facts.lat - COLIN_HOME.lat) < 0.001 && /^2026-11-20/.test(facts.taken), JSON.stringify(facts));
});

// ─── Taking one in ─────────────────────────────────────────────────

test('an email from staff: each original kept as sent, each photo’s copies made, the video to Stream, filed by the subject, in the index at once', async () => {
  const { env, made } = await world();
  const f = fakes();
  try {
    const key = 'raw/email/2026-11-25T20-04-05-000Z-abcd1234.eml';
    await env.MEDIA_FILES.put(key, eml({ subject: 'Colin demo day', html: '<a href="https://www.icloud.com/attachment/?u=https%3A%2F%2Fcvws.icloud-content.com%2FB%2FAbCd%2F%24%7Bf%7D%3Fo%3Dx&amp;f=IMG_0042.MOV&amp;sz=600000">video</a>',
      files: [{ name: 'IMG_0001.HEIC', type: 'image/heic', bytes: heicPhoto({ lat: 1, lng: 1, taken: '2026:11:24 10:00:00' }) }, { name: 'IMG_0002.jpeg', type: 'image/jpeg', bytes: photo({ lat: 1, lng: 1, taken: '2026:11:24 10:01:00' }) }] }));
    const row = await IN.receiveEmail(env, key, { filing });
    assert.equal(row.state, 'done');
    assert.equal(row.files, 3);
    assert.equal(row.album, 'kid:colin');
    assert.equal(row.stage, 'During');
    const items = await rows(env.DB);
    assert.deepEqual(items.map((i) => [i.kind, i.album, i.stage, i.gate]).sort(), [['photo', 'kid:colin', 'During', 'check'], ['photo', 'kid:colin', 'During', 'check'], ['video', 'kid:colin', 'During', 'open']]);
    assert.ok(items.every((i) => /Jane Doe/i.test(i.title) && /colin demo day/.test(i.words) && /jane doe/.test(i.words)), 'found by who sent it and what they wrote');
    const keys = [...env.MEDIA_FILES.objects.keys()];
    assert.equal(keys.filter((k) => k.startsWith('originals/')).length, 3, 'every original kept');
    assert.ok(keys.some((k) => /originals\/.+\/IMG_0001\.HEIC$/.test(k)) && keys.some((k) => /IMG_0042\.MOV$/.test(k)));
    assert.equal(keys.filter((k) => k.startsWith('previews/')).length, 6, 'each photo: 600, 2000 and full size');
    assert.ok(made.every((m) => m.out.format === 'image/jpeg' && m.n > 1000), 'made from the whole original, as JPEGs');
    const copy = f.asked.find((a) => a.url.endsWith('/stream/copy'));
    assert.match(JSON.parse(copy.body).url, /^https:\/\/sunshineonaranneyday\.com\/api\/media-file\?k=originals%2F/);
    assert.equal(JSON.parse(items.find((i) => i.kind === 'video').extra).uid, 'f'.repeat(32));
    // The same message again (the Worker told twice): taken in once
    const again = await IN.receiveEmail(env, key, { filing });
    assert.equal(again.id, row.id);
    assert.equal((await rows(env.DB)).length, 3);
  } finally { f.restore(); }
});

test('filed with no words: by the family’s home the photo was taken at, or the reveal that day', async () => {
  const { env } = await world();
  const f = fakes();
  try {
    await env.MEDIA_FILES.put('raw/email/a-home-0000001.eml', eml({ subject: '', text: 'Sent from my iPhone', files: [{ name: 'IMG_1.jpeg', type: 'image/jpeg', bytes: photo({ ...COLIN_HOME, taken: '2026:10:02 11:00:00' }) }] }));
    assert.equal((await IN.receiveEmail(env, 'raw/email/a-home-0000001.eml', { filing })).album, 'kid:colin');
    await env.MEDIA_FILES.put('raw/email/a-day-00000001.eml', eml({ subject: 'pics', text: '', files: [{ name: 'IMG_2.jpeg', type: 'image/jpeg', bytes: photo({ lat: 10, lng: 10, taken: '2026:11:20 15:00:00' }) }] }));
    assert.equal((await IN.receiveEmail(env, 'raw/email/a-day-00000001.eml', { filing })).album, 'kid:ava');
    await env.MEDIA_FILES.put('raw/email/a-none-0000001.eml', eml({ subject: 'random', text: 'fun', files: [{ name: 'IMG_3.jpeg', type: 'image/jpeg', bytes: photo({ lat: 10, lng: 10, taken: '2026:01:01 15:00:00' }) }] }));
    assert.equal((await IN.receiveEmail(env, 'raw/email/a-none-0000001.eml', { filing })).album, IN.INBOX_ALBUM);
  } finally { f.restore(); }
});

test('someone not on the list, or an email that can’t prove its sender: kept for staff, never filed, never answered; let through files it', async () => {
  const { env } = await world();
  const f = fakes();
  try {
    await IN.writeSettings(env.DB, { replies: true });
    await env.MEDIA_FILES.put('raw/email/a-spoof-000001.eml', eml({ from: 'jane@soardcharity.com', auth: 'fail', subject: 'Colin', files: [{ name: 'x.jpeg', type: 'image/jpeg', bytes: photo({ lat: 1, lng: 1, taken: '2026:11:24 10:00:00' }) }] }));
    const spoof = await IN.receiveEmail(env, 'raw/email/a-spoof-000001.eml', { filing });
    assert.equal(spoof.state, 'held');
    assert.match(spoof.why, /couldn’t be proven/);
    await env.MEDIA_FILES.put('raw/email/a-strng-000001.eml', eml({ from: 'stranger@gmail.com', fromName: 'Stranger', subject: 'Colin', files: [{ name: 'y.jpeg', type: 'image/jpeg', bytes: photo({ lat: 1, lng: 1, taken: '2026:11:24 10:00:00' }) }] }));
    const stranger = await IN.receiveEmail(env, 'raw/email/a-strng-000001.eml', { filing });
    assert.equal(stranger.state, 'held');
    const held = await rows(env.DB);
    assert.ok(held.every((r) => r.gate === 'staff' && r.album === IN.INBOX_ALBUM && /not on the list/.test(r.why)));
    assert.equal((await IN.sendReply(env, stranger)).sent, false, 'never answered');
    assert.ok(!f.asked.some((a) => a.url === 'https://api.resend.com/emails'));
    // Staff let it through: filed by its words, open to the address check
    assert.equal(await IN.letThrough(env, stranger.id), 'kid:colin');
    const moved = (await rows(env.DB, `json_extract(extra, '$.message') = '${stranger.id}'`))[0];
    assert.deepEqual([moved.album, moved.gate, moved.why], ['kid:colin', 'check', null]);
    // Someone added to Who can send: theirs files straight away (a personal Gmail, proven by its DKIM)
    await IN.addSender(env.DB, { name: 'Sam Social', email: 'sam.social@gmail.com' });
    await env.MEDIA_FILES.put('raw/email/a-sam00-000001.eml', eml({ from: 'sam.social@gmail.com', fromName: 'Sam', auth: 'dkim-only', subject: 'Ben', files: [{ name: 'z.jpeg', type: 'image/jpeg', bytes: photo({ lat: 1, lng: 1, taken: '2026:11:24 10:00:00' }) }] }));
    const sam = await IN.receiveEmail(env, 'raw/email/a-sam00-000001.eml', { filing });
    assert.deepEqual([sam.state, sam.album, sam.from_name], ['done', 'kid:ben', 'Sam Social']);
  } finally { f.restore(); }
});

test('a text: Twilio’s files fetched with the account’s key, kept, filed by the words, taken off Twilio; from an unknown number, held', async () => {
  const { env } = await world();
  const f = fakes();
  try {
    const media = (i) => `https://api.twilio.com/2010-04-01/Accounts/${ACCT}/Messages/MM${'b'.repeat(32)}/Media/ME${String(i).repeat(32)}`;
    const form = { MessageSid: `MM${'b'.repeat(32)}`, From: '+1 (404) 555-0100', To: '+18005550199', Body: 'Ben progress', NumMedia: '2', MediaUrl0: media(1), MediaContentType0: 'image/jpeg', MediaUrl1: media(2), MediaContentType1: 'image/jpeg' };
    const row = await IN.receiveText(env, form, { filing });
    assert.deepEqual([row.state, row.album, row.stage, row.files, row.from_name], ['done', 'kid:ben', 'During', 2, 'Staff phone']);
    const fetched = f.asked.filter((a) => /\/Media\/ME/.test(a.url) && a.method === 'GET');
    assert.equal(fetched.length, 2);
    assert.ok(fetched.every((a) => a.auth === `Basic ${btoa(`${ACCT}:tw-token`)}`));
    assert.equal(f.asked.filter((a) => a.method === 'DELETE' && /\/Media\/ME.+\.json$/.test(a.url)).length, 2, 'taken off Twilio once kept');
    const twice = await IN.receiveText(env, form, { filing });
    assert.equal(twice.id, row.id, 'Twilio sending it again: taken in once');
    const unknown = await IN.receiveText(env, { ...form, MessageSid: `MM${'c'.repeat(32)}`, From: '+17705550123' }, { filing });
    assert.equal(unknown.state, 'held');
  } finally { f.restore(); }
});

test('the reply: off until turned on; then what came in and where it went, by email and by text', async () => {
  const { env } = await world();
  const f = fakes();
  try {
    await env.MEDIA_FILES.put('raw/email/a-reply-00001.eml', eml({ subject: 'Colin demo day', files: [{ name: 'a.jpeg', type: 'image/jpeg', bytes: photo({ lat: 1, lng: 1, taken: '2026:11:24 10:00:00' }) }] }));
    const row = await IN.receiveEmail(env, 'raw/email/a-reply-00001.eml', { filing });
    assert.equal((await IN.sendReply(env, row)).sent, false);
    await IN.writeSettings(env.DB, { replies: true, serviceSid: 'MGphotos' });
    const r = await IN.sendReply(env, row);
    assert.equal(r.sent, true);
    assert.equal(r.body, 'Got 1 file for Colin. They’re in Photos & Videos.');
    const email = JSON.parse(f.asked.find((a) => a.url === 'https://api.resend.com/emails').body);
    assert.deepEqual([email.to, email.subject], [['jane@soardcharity.com'], 'Re: Colin demo day']);
    assert.equal(IN.replyText({ files: 4, album: IN.INBOX_ALBUM }), 'Got 4 files. They’re in Photos & Videos. Put the kid’s or event’s name in your message and they’ll go straight to that album.');
    const text = await IN.receiveText(env, { MessageSid: `MM${'d'.repeat(32)}`, From: '+14045550100', Body: 'gala', NumMedia: '1', MediaUrl0: `https://api.twilio.com/2010-04-01/Accounts/${ACCT}/Messages/MM${'d'.repeat(32)}/Media/ME${'1'.repeat(32)}`, MediaContentType0: 'image/jpeg' }, { filing });
    await IN.sendReply(env, text);
    const sms = f.asked.find((a) => a.url.endsWith('/Messages.json'));
    assert.deepEqual(Object.fromEntries(new URLSearchParams(sms.body)), { MessagingServiceSid: 'MGphotos', To: '+14045550100', Body: 'Got 1 file for 2026 Example Gala. They’re in Photos & Videos.' });
  } finally { f.restore(); }
});

// ─── The endpoints and the email Worker ────────────────────────────

test('the email Worker keeps the message as it came, then tells the site, signed; the site takes it in', async () => {
  const { env } = await world();
  const f = fakes();
  try {
    const raw = eml({ subject: 'Colin', files: [{ name: 'IMG_9.jpeg', type: 'image/jpeg', bytes: photo({ lat: 1, lng: 1, taken: '2026:11:24 10:00:00' }) }] });
    const message = { from: 'jane@soardcharity.com', to: IN.ADDRESS, raw: new Response(raw).body };
    const key = await keep(env, message);
    assert.match(key, /^raw\/email\/.+\.eml$/);
    assert.equal((await env.MEDIA_FILES.get(key)).customMetadata.from, 'jane@soardcharity.com');
    assert.deepEqual(new Uint8Array(await (await env.MEDIA_FILES.get(key)).arrayBuffer()), raw, 'exactly as it came');
    // The Worker's call, answered by the site's own handler (same secret, the site's filing)
    let res;
    await tell(env, key, async (url, init) => {
      res = await inboxPost({ env, request: new Request(url, init), waitUntil: () => {} });
      return res;
    });
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.files, 1);
    // A wrong signature, an old one, a key that isn't an email's: refused
    const bad = (headers, body = { key }) => inboxPost({ env, request: new Request('https://x/api/media-inbox', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }) });
    assert.equal((await bad({ 'X-Media-Time': String(Date.now()), 'X-Media-Signature': 'nope' })).status, 403);
    assert.equal((await bad({ 'X-Media-Time': String(Date.now() - 10 * 60e3), 'X-Media-Signature': 'x' })).status, 403);
    assert.equal((await bad({ 'X-Media-Time': String(Date.now()), 'X-Media-Signature': 'x' }, { key: 'originals/2026/11/x/a.jpg' })).status, 403);
    // The Worker's own entry point: keeps, then tells (the site down: still kept for the heartbeat)
    globalThis.fetch = async () => new Response('down', { status: 503 });
    const before = env.MEDIA_FILES.objects.size;
    await worker.email({ from: 'jane@soardcharity.com', to: IN.ADDRESS, raw: new Response(raw).body }, { ...env, SITE: 'https://example.test' });
    assert.equal(env.MEDIA_FILES.objects.size, before + 1);
    const out = await IN.maybeRunInbox(env, { fetchImpl: async () => new Response('offline', { status: 503 }) });
    assert.equal(out.picked, 1, 'the heartbeat picks up the one the site didn’t hear about');
  } finally { f.restore(); }
});

test('a text to the photos number: only signed by Twilio, answered with an empty Response at once', async () => {
  const { env } = await world();
  const f = fakes();
  try {
    const url = 'https://sunshineonaranneyday.com/api/media-text';
    const form = { MessageSid: `MM${'e'.repeat(32)}`, From: '+14045550100', To: '+18005550199', Body: 'Colin', NumMedia: '1', MediaUrl0: `https://api.twilio.com/2010-04-01/Accounts/${ACCT}/Messages/MM${'e'.repeat(32)}/Media/ME${'2'.repeat(32)}`, MediaContentType0: 'image/jpeg' };
    const post = async (sig) => textPost({ env, request: new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': sig }, body: new URLSearchParams(form) }) });
    assert.equal((await post('forged')).status, 403);
    const res = await post(await twilioSignature('tw-token', url, form));
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<Response\/>/);
    assert.equal((await rows(env.DB)).length, 1);
  } finally { f.restore(); }
});

test('the link Stream copies a sent-in video by: signed, one original, six hours', async () => {
  const { env } = await world();
  await env.MEDIA_FILES.put('originals/2026/11/abc/IMG.MOV', new Uint8Array([1, 2, 3]), { httpMetadata: { contentType: 'video/quicktime' } });
  const link = await IN.signFileLink(env, 'originals/2026/11/abc/IMG.MOV');
  const get = (q) => fileGet({ env, request: new Request(`https://x/api/media-file?${new URLSearchParams(q)}`) });
  const ok = await get(link);
  assert.equal(ok.status, 200);
  assert.deepEqual(new Uint8Array(await ok.arrayBuffer()), new Uint8Array([1, 2, 3]));
  assert.equal((await get({ ...link, k: 'raw/email/x.eml' })).status, 404, 'never anything but an original');
  assert.equal((await get({ ...link, s: link.s.replace(/.$/, '0') })).status, 404);
  assert.equal((await get(await IN.signFileLink(env, 'originals/2026/11/abc/IMG.MOV', Date.now() - 7 * 3600e3))).status, 404, 'run out');
});

// ─── In Photos & Videos ────────────────────────────────────────────

const ctxOf = (env, qs, { media = null, method = 'GET', body = null } = {}) => ({
  env, waitUntil: () => {}, data: { userEmail: media ? media.email : 'pat@soardcharity.com', ...(media ? { mediaOnly: media } : {}) },
  request: new Request(`https://admin.test/api/x?${qs}`, { method, body: body ? JSON.stringify(body) : undefined, headers: body ? { 'Content-Type': 'application/json' } : {} }),
});
const SOCIAL = { email: 'sam.social@example.com', name: 'Sam Social' };

test('in Photos & Videos: found by who sent it, a photo after the address check, a video at once; its copies and downloads; staff move and delete', async () => {
  const { env } = await world();
  const f = fakes();
  try {
    await env.MEDIA_FILES.put('raw/email/a-pv000-000001.eml', eml({ subject: 'Colin demo day', html: '<a href="https://www.icloud.com/attachment/?u=https%3A%2F%2Fcvws.icloud-content.com%2FB%2FAbCd%2F%24%7Bf%7D%3Fo%3Dx&amp;f=IMG_0042.MOV&amp;sz=600000">v</a>',
      files: [{ name: 'IMG_7.jpeg', type: 'image/jpeg', bytes: photo({ lat: 1, lng: 1, taken: '2026:11:24 10:00:00' }) }] }));
    const row = await IN.receiveEmail(env, 'raw/email/a-pv000-000001.eml', { filing });
    const found = await search(env.DB, 'jane colin', { staff: true });
    assert.equal(found.total, 2);
    const p = found.items.find((i) => i.kind === 'photo');
    assert.match(p.thumb, /^\/api\/media-thumb\?id=inb%3A/);
    assert.equal(p.sender, 'Jane Doe');
    // The social sign-in: the video now, the photo once the address check passed it
    const social = async () => (await search(env.DB, 'colin', { staff: false })).items.map((i) => i.kind).sort();
    assert.deepEqual(await social(), ['video']);
    await env.DB.prepare("UPDATE media_items SET check_state = 'ok' WHERE source = 'inbox' AND kind = 'photo'").run();
    assert.deepEqual(await social(), ['photo', 'video']);
    // Its pictures and its download: the copies made as it came in (a JPEG, nothing of where it was taken)
    const thumb = await thumbGet(ctxOf(env, `id=${encodeURIComponent(p.id)}&s=600`, { media: SOCIAL }));
    assert.equal(await thumb.text(), `JPEG 600 of ${(await env.MEDIA_FILES.get((await itemFor(env.DB, p.id, { staff: true })).ref)).size}`);
    const dl = await dlGet(ctxOf(env, `item=${encodeURIComponent(p.id)}`, { media: SOCIAL }));
    assert.equal(dl.headers.get('Content-Type'), 'image/jpeg');
    assert.match(dl.headers.get('Content-Disposition'), /SOARD-Colin-IMG_7\.jpg/);
    assert.match(await dl.text(), /^JPEG 12000 of /);
    // Staff: Send photos
    const inbox = await (await adminGet(ctxOf(env, 'inbox=1'))).json();
    assert.equal(inbox.address, IN.ADDRESS);
    assert.equal(inbox.replies, false);
    assert.equal(inbox.messages[0].files, 2);
    assert.equal(inbox.wording.filed, 'Got 3 files for Colin. They’re in Photos & Videos.');
    assert.equal((await adminGet(ctxOf(env, 'inbox=1', { media: SOCIAL }))).status, 403);
    // Move to another album, then delete the message: the originals, the copies, the Stream copy, the rows
    const moved = await (await adminPost(ctxOf(env, '', { method: 'POST', body: { act: 'move', ids: [p.id], album: 'kid:ben' } }))).json();
    assert.equal(moved.moved, 1);
    assert.equal((await itemFor(env.DB, p.id, { staff: true })).album, 'kid:ben');
    assert.equal((await adminPost(ctxOf(env, '', { method: 'POST', body: { act: 'move', ids: [p.id], album: 'kid:nobody' } }))).status, 400);
    const del = await (await adminPost(ctxOf(env, '', { method: 'POST', body: { act: 'delete-message', id: row.id } }))).json();
    assert.equal(del.messages.length, 0);
    assert.equal((await rows(env.DB)).length, 0);
    assert.ok(![...env.MEDIA_FILES.objects.keys()].some((k) => k.startsWith('originals/') || k.startsWith('previews/') || k === row.raw_key));
    assert.ok(f.asked.some((a) => a.method === 'DELETE' && a.url.endsWith(`/stream/${'f'.repeat(32)}`)));
    // Who can send: staff add and take off; the social sign-in can't
    const added = await (await adminPost(ctxOf(env, '', { method: 'POST', body: { act: 'add-sender', name: 'Pat Volunteer', phone: '(770) 555-0123' } }))).json();
    assert.deepEqual(added.senders.map((s) => [s.name, s.phone]), [['Pat Volunteer', '+17705550123']]);
    assert.equal((await adminPost(ctxOf(env, '', { method: 'POST', body: { act: 'add-sender', name: 'No contact' } }))).status, 400);
    assert.equal((await adminPost(ctxOf(env, '', { media: SOCIAL, method: 'POST', body: { act: 'add-sender', name: 'X', email: 'x@example.com' } }))).status, 403);
  } finally { f.restore(); }
});

test('the text number: a toll-free number that takes photos, on a Messaging Service of its own pointed at /api/media-text', async () => {
  const { env } = await world();
  const asked = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    asked.push([init.method || 'GET', String(url).replace(/AC[a-f0-9]{32}/, 'AC…'), init.body ? Object.fromEntries(new URLSearchParams(init.body)) : null]);
    if (/AvailablePhoneNumbers\/US\/TollFree/.test(url)) return Response.json({ available_phone_numbers: [{ phone_number: '+18885550199' }] });
    if (/IncomingPhoneNumbers\.json$/.test(url)) return Response.json({ sid: 'PNphotos', phone_number: '+18885550199' });
    if (/\/v1\/Services$/.test(url)) return Response.json({ sid: 'MGphotos' });
    if (/\/v1\/Services\/MGphotos\/PhoneNumbers$/.test(url)) return Response.json({ sid: 'PNphotos' });
    if (/\/v1\/Services\/MGphotos$/.test(url)) return Response.json({ inbound_request_url: IN.TEXT_WEBHOOK, inbound_method: 'POST' });
    return new Response('?', { status: 404 });
  };
  try {
    const s = await IN.setupTextNumber(env);
    assert.deepEqual([s.number, s.serviceSid], ['+18885550199', 'MGphotos']);
    assert.ok(/MmsEnabled=true/.test(asked[0][1]));
    assert.deepEqual(asked.find((a) => /\/v1\/Services$/.test(a[1]))[2], { FriendlyName: 'SOARD Photos', InboundRequestUrl: 'https://sunshineonaranneyday.com/api/media-text', InboundMethod: 'POST', UseInboundWebhookOnNumber: 'false' });
    const n = asked.length;
    assert.equal((await IN.setupTextNumber(env)).number, '+18885550199');
    assert.equal(asked.length, n, 'set up once: never a second number');
    assert.deepEqual(await IN.textNumberStatus(env), { set: true, number: '+18885550199', connected: true });
  } finally { globalThis.fetch = real; }
});
