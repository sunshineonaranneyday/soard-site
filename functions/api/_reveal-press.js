/**
 * The press release: when JobTread confirms a reveal (Reveal Date Confirmed =
 * Yes, with a time), the site drafts the press release in Linzi's own Gmail,
 * addressed to the press list, for her to read over and send herself (Peter,
 * Nov 24 2026: "when a reveal is comfirmed i need a press release drafted ...
 * there should be a place to add the emails for the press release and it should
 * come from linzi in her gmail").
 *
 * - It follows the one Linzi sent for Max on Nov 19 2026: the circle logo, what
 *   it's called (Press Release), FOR IMMEDIATE RELEASE, the headline, then WHAT, WHEN, WHERE,
 *   WHY, MEDIA AVAILABILITY, ABOUT and the media contact, two of the kid's
 *   photos, and her own Gmail signature.
 * - Filled in from JobTread (the day, the time, the family's address and the
 *   "Reveal Invite Details" notes) and the kid's page (name, age, rooms, story,
 *   photos, and the room's sponsors). The few sentences about the kid are put in
 *   press words by Workers AI from the page's story, and kept only when every
 *   name and number in them is in that story; otherwise the page's own summary.
 * - A draft, never sent by the site: it goes in the sender's Gmail (domain-wide
 *   delegation, gmail.modify, the scope the inbox sweep already archives with).
 *   The press list is in Bcc, so no outlet sees the others' addresses.
 * - The draft is the sender's. One nobody has touched follows JobTread and the
 *   press list; once she changes it in Gmail it's left as she made it, and a new
 *   day, time or address reaches her as an email instead. Sent from Gmail, or
 *   deleted there: the site never makes another unless someone asks (Draft now).
 * - She's told by email (never Slack: Peter, Nov 4 2026) when it's drafted, when
 *   JobTread changes what it says, and when JobTread says the reveal may be off.
 * - Rehearsals (TEST jobs, the office sandbox) and community projects are left out.
 * - Settings in site_config 'reveal-press' (runtime only: never written into the
 *   public repo): on/off, who it's from, the press list and the standing words.
 *   Reveals → Invites → Press release in the admin.
 */

import { accessToken, GMAIL_MODIFY_SCOPE } from './_google-calendar.js';
import { resolveMailbox, mailboxes } from './_mailbox.js';
import { word } from './_board-asks.js';
import { sendEmails, emailConfigured } from './_broadcast-notify.js';
import { emailShell, facts as factRows, button, esc as escMail } from './_email-shell.js';
import { cfImg, cleanAddress, roomCounts, roomNames, listJoin, shortStory, stripHtml, galleryPicks, SITE_URL } from './_reveal-invite-email.js';
import { inviteFacts, kidPageReady } from './_reveal-invite-kit.js';
import { viaGateway, aiCapped } from './_ai.js';
import { fieldValues } from './_jt-fields.js';
// Addresses as people paste them, read the same way by the admin
import { parseList, isEmail } from '../../public/admin/press-list-shared.js';

export { parseList };

export const PRESS_KEY = 'reveal-press';
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const CF = 'https://imagedelivery.net/ROYFuPmfN2vPS6mt5sCkZQ';
/** The official circle logo with the tagline (src/data/brand.js), as Linzi's for Max opens */
export const PRESS_LOGO = `${CF}/brand-logo-circle-tagline-display/w=360,q=90`;
const PHOTO_SHOWN = 'w=640,q=82';
const PHOTO_FULL = 'w=2400,q=85';
const AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const ADMIN_URL = `${SITE_URL}/admin/#broadcast/invites`;
const norm =(e) => String(e || '').trim().toLowerCase();

// ─── Settings ───────────────────────────────────────────────────────

/** The words every press release carries, as Linzi wrote them for Max's (Nov 19 2026). {name}: the kid's name. */
export const PRESS_DEFAULTS = Object.freeze({
  enabled: true,
  from: 'linzi@soardcharity.com',
  list: [],
  // What it's called, at the top and in the subject (Peter, Nov 24 2026: "it should be called a press release")
  called: 'Press Release',
  contactName: '',
  contactTitle: 'Director of Operations & Development',
  contactPhone: '',
  arrival: 'Please arrive at least 15 minutes before the reveal.',
  why: 'Sunshine on a Ranney Day creates custom dream bedrooms, wheelchair-accessible bathrooms, and in-home therapy rooms for children with special needs and long-term illnesses at no cost to their families.',
  interviews: '{name}’s parents\nA member of the Sunshine on a Ranney Day team',
  photosOffer: 'If you are unable to attend, please let us know if you would like us to provide you with professional photos and/or videos after the reveal.',
  about: 'Founded in 2012, Sunshine on a Ranney Day (SOARD) is a 501(c)(3) nonprofit organization based in Roswell, Georgia, that renovates homes for children with special needs. SOARD specializes in wheelchair-accessible bathrooms, dream bedrooms, in-home therapy rooms, and ramps. SOARD helps families overcome daily challenges and experience the joy of a safe and functional home. All projects are completed at no cost to families through the support of donors and local partners. Learn more at www.sunshineonaranneyday.com.',
});
/** How long each word setting may be */
export const PRESS_LIMITS = Object.freeze({ called: 40, contactName: 80, contactTitle: 120, contactPhone: 40, arrival: 300, why: 800, interviews: 600, photosOffer: 400, about: 1500 });
export const LIST_MAX = 300;

/** What staff saved, cut to what fits; defaults for what they left out → the settings */
export function cleanSettings(input = {}, base = PRESS_DEFAULTS) {
  const out = { ...PRESS_DEFAULTS, ...base };
  if (typeof input.enabled === 'boolean') out.enabled = input.enabled;
  if (input.from !== undefined) out.from = norm(input.from);
  if (input.list !== undefined) out.list = parseList(input.list).slice(0, LIST_MAX);
  for (const [k, max] of Object.entries(PRESS_LIMITS)) {
    if (input[k] === undefined) continue;
    const raw = String(input[k] ?? '').replace(/\r\n?/g, '\n');
    const v = (k === 'interviews' ? raw.split('\n').map((l) => l.replace(/^[\s\-–•*]+/, '').trim()).filter(Boolean).join('\n') : raw.replace(/[ \t]+/g, ' ').trim()).slice(0, max);
    // An empty box goes back to the site's words, except the media contact's, which come from elsewhere when empty
    out[k] = v || (['contactName', 'contactPhone'].includes(k) ? '' : PRESS_DEFAULTS[k]);
  }
  return out;
}

export async function readPressSettings(DB) {
  let saved = {};
  try {
    const row = await DB.prepare('SELECT data FROM site_config WHERE key = ?').bind(PRESS_KEY).first();
    saved = row ? JSON.parse(row.data) : {};
  } catch { /* defaults */ }
  return { ...PRESS_DEFAULTS, ...saved, list: parseList(saved.list || []) };
}

export async function writePressSettings(DB, patch) {
  const next = cleanSettings(patch, await readPressSettings(DB));
  await DB.prepare('INSERT OR REPLACE INTO site_config (key, data, updated_at) VALUES (?, ?, ?)')
    .bind(PRESS_KEY, JSON.stringify(next), new Date().toISOString()).run();
  return next;
}

/** Who it can come from: an active Google account of SOARD's, or an alias on one → { email, account, name } */
export async function senderOf(env, from) {
  const box = await resolveMailbox(env, from);
  return { email: norm(from), account: box.email, name: box.name || '' };
}
export const senderChoices = (env) => mailboxes(env);

// ─── The press release ───────────────────────────────────────────────────

const ROOM_WORDS = [
  [/accessible bath/i, 'wheelchair-accessible bathroom'],
  [/bath/i, 'accessible bathroom'],
  [/therapy/i, 'in-home therapy room'],
  [/bed/i, 'dream bedroom'],
  [/ramp/i, 'wheelchair ramp'],
];
const NUMBER_WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six'];
/** The rooms as the WHAT sentence says them: "a custom wheelchair-accessible bathroom", "two dream bedrooms and an in-home therapy room" */
export function roomPhrase(kid, room) {
  const rooms = roomCounts(kid, room);
  if (!rooms.length) return 'a custom room makeover';
  const parts = rooms.map(({ name, count }, i) => {
    const hit = ROOM_WORDS.find(([re]) => re.test(name));
    const one = hit ? hit[1] : String(name).toLowerCase().replace(/s$/, '');
    if (count > 1) return `${NUMBER_WORDS[count] || count} ${i === 0 ? 'custom ' : ''}${one}s`;
    const lead = i === 0 ? `custom ${one}` : one;
    return `${/^[aeiou]/i.test(lead) ? 'an' : 'a'} ${lead}`;
  });
  return listJoin(parts);
}

/** "Friday, November 20" */
const dayWords = (date) => (/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))
  ? new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }) : '');
/** "4:00 p.m.", the way a press release says it */
export function pressTime(time) {
  const m = String(time || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  const h = Number(m[1]);
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? 'a.m.' : 'p.m.'}`;
}
/** The city from the family's address: "2060 Grand Prix Dr, Atlanta, GA 30345" → "Atlanta" */
export function cityOf(address) {
  const m = cleanAddress(address).match(/,\s*([^,\d][^,]*?),\s*(?:GA|Georgia)\b/i);
  return m ? m[1].trim() : '';
}
const one = (age) => (Array.isArray(age) ? (age.length === 1 ? age[0] : null) : age);

// The child's JobTread account fields, as the application saved them (_applications.js JT_FIELDS)
const FIELD_BIRTHDAY = '22P46syd4j6E';
const FIELD_GENDER = '22P4VnkCXPSY';
/** The child's facts JobTread holds on the job's account → { birthday: 'YYYY-MM-DD' | null, gender: 'Male' | 'Female' | null } */
export function childOf(job) {
  const v = fieldValues(job?.location?.account?.customFieldValues?.nodes);
  const birthday = /^\d{4}-\d{2}-\d{2}/.test(String(v[FIELD_BIRTHDAY] || '')) ? String(v[FIELD_BIRTHDAY]).slice(0, 10) : null;
  const gender = /^(male|female)$/i.test(String(v[FIELD_GENDER] || '').trim()) ? String(v[FIELD_GENDER]).trim() : null;
  return { birthday, gender };
}
/** How old they'll be on the reveal day, from their birthday (null without both) */
export function ageOn(birthday, date) {
  const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(birthday || ''));
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date || ''));
  if (!b || !d) return null;
  const age = Number(d[1]) - Number(b[1]) - (`${d[2]}${d[3]}` < `${b[2]}${b[3]}` ? 1 : 0);
  return age >= 0 && age < 40 ? age : null;
}
/** his / her / their: JobTread's Gender first, else the story's own words (a tie, or two kids, is "the family") */
export function familyWord(kid, child = {}) {
  if (/(&| and )/.test(String(kid?.name || ''))) return 'their family';
  if (/^male$/i.test(child?.gender || '')) return 'his family';
  if (/^female$/i.test(child?.gender || '')) return 'her family';
  const text = ` ${stripHtml(kid?.bio || '')} ${kid?.heroSummary || ''} `.toLowerCase();
  const he = (text.match(/\b(he|his|him)\b/g) || []).length;
  const she = (text.match(/\b(she|her|hers)\b/g) || []).length;
  return he > she * 2 ? 'his family' : she > he * 2 ? 'her family' : 'the family';
}
const possessive = (name) => `${name}’s`;

/**
 * The first sentence of WHAT: who, what, when and where, from the facts alone. The age is the one they'll be on the
 * reveal day, from JobTread's Birthday; the page's own age (as it was when the page was written) without one.
 */
export function whatOpening({ kid, room, date, time, address, base = 'Roswell', child = {} }) {
  const age = ageOn(child?.birthday, date) ?? one(kid?.age);
  const who = Number(age) > 0 ? `${age}-year-old ${kid.name}` : kid.name;
  const day = dayWords(date);
  const at = pressTime(time);
  const city = cityOf(address);
  const when = day ? ` on ${day}${at ? `, at ${at}` : ' (time to be confirmed)'}` : '';
  // (a time ends "p.m.", so a sentence ending there takes no second period)
  return `Sunshine on a Ranney Day, a charity based in ${base}, will unveil ${roomPhrase(kid, room)} for ${who} and ${familyWord(kid, child)}${when}${city ? ` in ${city}` : ''}.`.replace(/\.\.$/, '.');
}

/** The last sentence of WHAT: who paid for the room (its sponsors on the kid's page) */
export function whatClosing(sponsors = []) {
  const names = [...new Set(sponsors.map((s) => String(s || '').trim()).filter(Boolean))];
  return names.length
    ? `The project, at no cost to the family, was made possible by generous support from ${listJoin(names)}.`
    : 'The project comes at no cost to the family, made possible by Sunshine on a Ranney Day’s donors and partners.';
}

const STORY_SYSTEM = `You write the middle of the WHAT section of a press release for Sunshine on a Ranney Day, a charity that builds custom rooms for children with special needs.
Write 2 to 4 plain sentences, in the third person, about the child: their condition and what daily life is like, and why the new room matters to the child and the family.
Use only facts that are in the story you are given. Never add a fact, a name, a number or a quote that isn't there.
Don't give the child's age, or name the charity, the sponsors or the date (other sentences say those). No appeals for donations, no "we", "our", "you" or "please". No em dashes.
Answer as JSON: {"story": "..."}`;
const STORY_SCHEMA = { type: 'object', properties: { story: { type: 'string' } }, required: ['story'] };
/**
 * The AI's sentences, if they keep to the story: every number in them, and every capitalized word that doesn't
 * start a sentence (a name, a place, a diagnosis), is in it; the kid's name is there; and no fundraising words
 * → the sentences, or '' to use the page's own summary
 */
export function keepStory(out, { name, source }) {
  const s = String(out || '').replace(/\s*[—–]\s*/g, ', ').replace(/\s+/g, ' ').trim();
  if (s.length < 80 || s.length > 900) return '';
  const src = String(source || '').toLowerCase();
  if (!s.toLowerCase().includes(String(name || '').split(/\s+/)[0].toLowerCase())) return '';
  if (/\b(donat\w*|please|contribut\w*|your|you|we|our|us|act now|fundrais\w*)\b/i.test(s)) return '';
  for (const n of s.match(/\d+/g) || []) if (!src.includes(n)) return '';
  for (const sentence of s.split(/(?<=[.!?])\s+/)) {
    for (const w of (sentence.match(/\b[A-Z][A-Za-z0-9’'-]*/g) || []).slice(/^[A-Z]/.test(sentence) ? 1 : 0)) {
      if (!src.includes(w.toLowerCase().replace(/[’']s$/, ''))) return '';
    }
  }
  return s;
}

/** The kid's story in a few press sentences → { story, by: 'ai' | 'page' } */
export async function storySentences(env, kid, { timeoutMs = 25000 } = {}) {
  const bio = stripHtml(kid?.bio || '').trim();
  const page = shortStory(kid);
  const source = [kid?.name, one(kid?.age), kid?.diagnosis, bio, kid?.heroSummary].filter(Boolean).join('\n');
  if (env?.AI?.run && bio.length > 80) {
    try {
      const res = await Promise.race([
        env.AI.run(AI_MODEL, {
          messages: [
            { role: 'system', content: STORY_SYSTEM },
            { role: 'user', content: `Child: ${kid.name}${kid.diagnosis ? `. Diagnosis: ${kid.diagnosis}` : ''}.\n\nThe story from the child's page:\n${bio.slice(0, 3500)}${kid.heroSummary ? `\n\nIts short summary:\n${kid.heroSummary}` : ''}` },
          ],
          max_tokens: 400, temperature: 0.2, response_format: { type: 'json_schema', json_schema: STORY_SCHEMA },
        }, viaGateway('reveal-press')),
        new Promise((_, no) => setTimeout(() => no(new Error('timeout')), timeoutMs)),
      ]);
      const a = typeof res?.response === 'string' ? JSON.parse(res.response) : res?.response;
      const kept = keepStory(a?.story, { name: kid.name, source });
      if (kept) return { story: kept, by: 'ai' };
    } catch (e) {
      if (!aiCapped(e)) console.error('[reveal-press] story', e?.message || e);
    }
  }
  return { story: page, by: 'page' };
}

const fill = (s, name) => String(s || '').replace(/\{name\}/g, name);
const P = 'margin:0 0 12px;';
const FONT = 'font-family:Arial,Helvetica,sans-serif;font-size:11pt;line-height:1.45;color:#000000;';
const H = 'margin:18px 0 6px;font-weight:700;font-size:12pt;';
const lines = (s) => String(s || '').split('\n').map((l) => l.trim()).filter(Boolean);

/**
 * The press release → { subject, html, text }.
 * story: the kid's sentences (storySentences); sponsors: their names; contact: { name, title, email, phone };
 * signature: the sender's Gmail signature (HTML), added as Gmail would
 */
export function pressRelease({ kid, room = '', date, time, address = '', details = '', story = '', sponsors = [], settings = PRESS_DEFAULTS, contact = {}, signature = '', base = 'Roswell', child = {} }) {
  const s = { ...PRESS_DEFAULTS, ...settings };
  const called = String(s.called || '').trim() || PRESS_DEFAULTS.called;
  const name = kid.name;
  const rooms = listJoin(roomNames(kid, room)) || 'Room Makeover';
  const headline = `Sunshine on a Ranney Day Unveiling for ${possessive(name)} ${rooms}`;
  const what = [whatOpening({ kid, room, date, time, address, base, child }), story, whatClosing(sponsors)].filter(Boolean).join(' ');
  const day = dayWords(date);
  const at = pressTime(time);
  const when = day ? `Reveal: ${day}, ${at ? `at ${at}` : 'time to be confirmed'}` : 'Reveal: date to be confirmed';
  const where = cleanAddress(address);
  const notes = lines(details);
  const interviews = lines(fill(s.interviews, name));
  const photos = [kid.heroImage, ...galleryPicks(kid).map((p) => p.url)].filter(Boolean)
    .filter((u, i, all) => all.findIndex((x) => cfImg(x, PHOTO_SHOWN) === cfImg(u, PHOTO_SHOWN)) === i).slice(0, 2);
  const who = [contact.name, contact.title].filter(Boolean).join(', ');
  const e = escMail;

  const sec = (title, body) => `<p style="${H}">${e(title)}</p>${body}`;
  const para = (t) => `<p style="${P}">${e(t)}</p>`;
  const html = `<div style="${FONT}">`
    + `<p style="margin:0 0 14px;text-align:center;"><img src="${e(PRESS_LOGO)}" width="180" height="180" alt="Sunshine on a Ranney Day" style="display:inline-block;width:180px;height:180px;border:0;"></p>`
    + `<p style="margin:0;text-align:center;font-weight:700;">${e(called.toUpperCase())}</p>`
    + `<p style="margin:0 0 14px;text-align:center;">FOR IMMEDIATE RELEASE</p>`
    + `<p style="margin:0 0 18px;text-align:center;font-weight:700;font-size:15pt;line-height:1.3;">${e(headline)}</p>`
    + sec('WHAT:', para(what))
    + sec('WHEN:', para(when) + (s.arrival ? para(s.arrival) : ''))
    + sec('WHERE:', (where ? para(where) : para('Address to come')) + notes.map(para).join(''))
    + (s.why ? sec('WHY:', para(s.why)) : '')
    + sec('MEDIA AVAILABILITY:', (interviews.length ? `<p style="margin:0 0 4px;">Interviews available with:</p>${interviews.map((l) => `<p style="margin:0 0 4px;">– ${e(l)}</p>`).join('')}<p style="margin:0 0 12px;"></p>` : '') + (s.photosOffer ? para(s.photosOffer) : ''))
    + (s.about ? sec('ABOUT SUNSHINE ON A RANNEY DAY:', para(s.about)) : '')
    + sec('Media Contact:', `<p style="margin:0 0 2px;">${e(who)}</p>`
      + (contact.email ? `<p style="margin:0 0 2px;"><a href="mailto:${e(contact.email)}" style="color:#1155CC;">${e(contact.email)}</a></p>` : '')
      + (contact.phone ? `<p style="margin:0 0 12px;">${e(contact.phone)}</p>` : '<p style="margin:0 0 12px;"></p>'))
    + (photos.length ? `<p style="margin:18px 0 12px;">${photos.map((u) => `<a href="${e(cfImg(u, PHOTO_FULL))}" style="text-decoration:none;"><img src="${e(cfImg(u, PHOTO_SHOWN))}" alt="${e(name)}" width="300" style="display:inline-block;width:300px;max-width:100%;height:auto;border:0;margin:0 8px 8px 0;vertical-align:top;"></a>`).join('')}</p>` : '')
    + '</div>'
    + (signature ? `<br><div class="gmail_signature">${signature}</div>` : '');

  const text = [
    called.toUpperCase(), 'FOR IMMEDIATE RELEASE', '', headline, '',
    'WHAT:', what, '',
    'WHEN:', when, ...(s.arrival ? [s.arrival] : []), '',
    'WHERE:', where || 'Address to come', ...notes, '',
    ...(s.why ? ['WHY:', s.why, ''] : []),
    'MEDIA AVAILABILITY:', ...(interviews.length ? ['Interviews available with:', ...interviews.map((l) => `– ${l}`)] : []), ...(s.photosOffer ? [s.photosOffer] : []), '',
    ...(s.about ? ['ABOUT SUNSHINE ON A RANNEY DAY:', s.about, ''] : []),
    'Media Contact:', who, contact.email, contact.phone,
    ...(photos.length ? ['', 'Photos:', ...photos.map((u) => cfImg(u, PHOTO_FULL))] : []),
  ].filter((l) => l !== undefined && l !== null).join('\n');

  return { subject: `${called}: ${headline}`, html, text };
}

// ─── Gmail ──────────────────────────────────────────────────────────

const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const utf8 = (s) => new TextEncoder().encode(s);
const wrap76 = (s) => s.replace(/.{1,76}/g, '$&\r\n');
const addr = (p) => (p.name ? `${word(/[",.<>@;:()]/.test(p.name) ? `"${p.name.replace(/"/g, '')}"` : p.name)} <${p.email}>` : p.email);

/** The draft as Gmail's API takes it: from the sender, to herself, the press list in Bcc (base64url, RFC 2822) */
export function pressMime({ from, bcc = [], subject, text, html }) {
  const boundary = `b_${crypto.randomUUID().replace(/-/g, '')}`;
  const out = [
    `From: ${addr(from)}`,
    `To: ${addr(from)}`,
    ...(bcc.length ? [`Bcc: ${bcc.map(addr).join(', ')}`] : []),
    `Subject: ${word(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap76(b64(utf8(text))),
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap76(b64(utf8(html))),
    `--${boundary}--`, '',
  ];
  return b64(utf8(out.join('\r\n'))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function gmail(token, path, { method = 'GET', body = null, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${GMAIL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 404) return null;
  const out = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Gmail answered ${res.status}${out?.error?.message ? `: ${out.error.message}` : ''}`);
  return out;
}

/** The sender's name and signature as her Gmail sends them for that address → { name, signature } */
async function sendAsOf(token, email, fetchImpl) {
  const got = await gmail(token, '/settings/sendAs', { fetchImpl }).catch(() => null);
  const list = got?.sendAs || [];
  const hit = list.find((x) => norm(x.sendAsEmail) === norm(email)) || list.find((x) => x.isDefault) || null;
  return { name: hit?.displayName || '', signature: hit?.signature || '' };
}

/** A link that opens the draft (or the sent email) in that person's Gmail */
export function gmailLink(email, { messageId = '', sent = false } = {}) {
  const base = `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(email)}`;
  if (!messageId) return `${base}#drafts`;
  return sent ? `${base}#sent/${encodeURIComponent(messageId)}` : `${base}#drafts?compose=${encodeURIComponent(messageId)}`;
}

// ─── Where each reveal's press release stands ────────────────────────────

// hash: the day, time, address and notes the site last wrote into the draft. content: the whole draft as it wrote
// it, so a new press list or new words reach an untouched one. told: the last note that really reached the sender
// ("drafted:<hash>", "held:<reason>" …). alarmed: the problem staff last heard about.
const SCHEMA = `CREATE TABLE IF NOT EXISTS reveal_press (
  job_id TEXT PRIMARY KEY, slug TEXT, mailbox TEXT, sender TEXT, draft_id TEXT, message_id TEXT, state TEXT,
  hash TEXT, content TEXT, story_by TEXT, told TEXT, error TEXT, alarmed TEXT, count INTEGER,
  created_at TEXT, sent_at TEXT, updated_at TEXT)`;
// The kid's sentences, written once for a story and kept, so a preview and its draft say the same and a new date never rewords them
const STORY_SCHEMA_SQL = 'CREATE TABLE IF NOT EXISTS reveal_press_story (story_key TEXT PRIMARY KEY, story TEXT, story_by TEXT, at TEXT)';
const _ready = new WeakSet();
async function ensurePressSchema(DB) {
  if (_ready.has(DB)) return;
  await DB.prepare(SCHEMA).run();
  await DB.prepare(STORY_SCHEMA_SQL).run();
  _ready.add(DB);
}
export async function readPressRow(DB, jobId) {
  await ensurePressSchema(DB);
  return DB.prepare('SELECT * FROM reveal_press WHERE job_id = ?').bind(jobId).first();
}
const COLS = ['job_id', 'slug', 'mailbox', 'sender', 'draft_id', 'message_id', 'state', 'hash', 'content', 'story_by', 'told', 'error', 'alarmed', 'count', 'created_at', 'sent_at', 'updated_at'];
async function writePressRow(DB, row) {
  const r = { ...row, updated_at: new Date().toISOString() };
  await DB.prepare(`INSERT OR REPLACE INTO reveal_press (${COLS.join(', ')}) VALUES (${COLS.map(() => '?').join(', ')})`)
    .bind(...COLS.map((c) => r[c] ?? null)).run();
  return r;
}

async function sha(value) {
  const d = await crypto.subtle.digest('SHA-256', utf8(JSON.stringify(value)));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}
/** What the press release says that the sender must hear about when it changes: the day, the time, the address, the notes */
const factsHash = (f) => sha([f.date, f.start, cleanAddress(f.address), String(f.details || '').trim()]);

/** The kid's page record, its sponsors' names, and whether it can fill a press release */
async function kidFor(DB, slug) {
  const row = await DB.prepare('SELECT data FROM kids WHERE slug = ?').bind(slug).first();
  let kid = null;
  try { kid = row ? JSON.parse(row.data) : null; } catch { /* unreadable */ }
  if (!kidPageReady(kid)) return null;
  const slugs = (kid.sponsors || []).filter(Boolean);
  let sponsors = [];
  if (slugs.length) {
    const got = await DB.prepare(`SELECT slug, name FROM partners WHERE slug IN (${slugs.map(() => '?').join(', ')})`).bind(...slugs).all().catch(() => ({ results: [] }));
    const byslug = Object.fromEntries((got.results || []).map((p) => [p.slug, p.name]));
    sponsors = slugs.map((s) => byslug[s]).filter(Boolean);
  }
  return { kid: { ...kid, slug }, sponsors };
}

/** SOARD's own facts for the press release: its city and phone (Site Config) */
async function orgBits(DB) {
  try {
    const row = await DB.prepare("SELECT data FROM site_config WHERE key = 'settings'").first();
    const st = row ? JSON.parse(row.data) : {};
    return { city: String(st?.address?.city || '').trim() || 'Roswell', phone: String(st?.phone || '').trim() };
  } catch { return { city: 'Roswell', phone: '' }; }
}

/** The kid's sentences for this story: kept from the first time, else written now and kept */
async function storyFor(env, kid) {
  const { DB } = env;
  await ensurePressSchema(DB);
  const key = await sha([kid.name, one(kid.age), kid.diagnosis, kid.bio, kid.heroSummary]);
  const kept = await DB.prepare('SELECT story, story_by FROM reveal_press_story WHERE story_key = ?').bind(key).first().catch(() => null);
  if (kept?.story) return { story: kept.story, by: kept.story_by || 'ai' };
  const made = await storySentences(env, kid);
  // Kept either way, so a preview and its draft say the same, and a look at an untouched draft never rewords it
  await DB.prepare('INSERT OR REPLACE INTO reveal_press_story (story_key, story, story_by, at) VALUES (?, ?, ?, ?)').bind(key, made.story, made.by, new Date().toISOString()).run().catch(() => {});
  return made;
}

/** Everything the press release needs for one reveal → { mail, bcc, sender, contact, story, storyBy, count } or { error } */
export async function buildRelease(env, { who, f, room = '', settings, child = {}, token = null, fetchImpl = fetch }) {
  const { DB } = env;
  const name = who?.name || 'A kid';
  if (!who?.slug) return { error: `No published kid page matches ${name}’s job, so the press release can’t be filled in.` };
  const page = await kidFor(DB, who.slug);
  if (!page) return { error: `${name}’s kid page isn’t published, so the press release can’t be filled in.` };
  const { kid, sponsors } = page;
  const story = await storyFor(env, kid);
  const sender = await senderOf(env, settings.from);
  const gmailSays = token ? await sendAsOf(token, sender.email, fetchImpl) : { name: '', signature: '' };
  const org = await orgBits(DB);
  const senderName = gmailSays.name || sender.name || sender.email;
  const contact = { name: settings.contactName || senderName, title: settings.contactTitle, email: sender.email, phone: settings.contactPhone || org.phone };
  const mail = pressRelease({ kid, room, date: f.date, time: f.start, address: f.address, details: f.details, story: story.story, sponsors, settings, contact, signature: gmailSays.signature, base: org.city, child });
  return { mail, bcc: settings.list, sender: { email: sender.email, account: sender.account, name: senderName }, contact, story: story.story, storyBy: story.by, count: settings.list.length };
}

/**
 * The draft as Gmail has it now → 'same' (as the site left it), 'edited' (she changed it), 'sent' (with when and
 * how many it went to) or 'gone' (deleted). An edit in Gmail makes a new message under the same draft.
 */
export async function lookAtDraft(token, row, { fetchImpl = fetch, name = '' } = {}) {
  const draft = row.draft_id ? await gmail(token, `/drafts/${encodeURIComponent(row.draft_id)}?format=minimal`, { fetchImpl }) : null;
  if (draft?.message?.id) return { look: draft.message.id === row.message_id ? 'same' : 'edited', messageId: draft.message.id };
  // Not a draft any more: sent as the site left it, sent after changes, or deleted
  const own = row.message_id ? await gmail(token, `/messages/${encodeURIComponent(row.message_id)}?format=metadata&metadataHeaders=To&metadataHeaders=Bcc&metadataHeaders=Cc`, { fetchImpl }) : null;
  const sentOne = async (msg) => {
    const heads = msg.payload?.headers || [];
    const count = heads.filter((x) => /^(to|cc|bcc)$/i.test(x.name)).flatMap((x) => parseList(x.value)).filter((p) => norm(p.email) !== norm(row.sender)).length;
    return { look: 'sent', messageId: msg.id, sentAt: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : new Date().toISOString(), count };
  };
  if (own?.labelIds?.includes('SENT')) return sentOne(own);
  const since = Math.floor(Date.parse(row.created_at || 0) / 1000) || 0;
  const first = String(name || '').split(/\s+/)[0].replace(/"/g, '');
  if (first) {
    // Its subject (as the site writes it, or close): the kid's name and one of the words such an email is called by
    const q = `in:sent after:${since} subject:"${first}" (subject:unveiling OR subject:"press release" OR subject:advisory)`;
    const found = await gmail(token, `/messages?maxResults=1&q=${encodeURIComponent(q)}`, { fetchImpl });
    const id = found?.messages?.[0]?.id;
    if (id) {
      const msg = await gmail(token, `/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=To&metadataHeaders=Bcc&metadataHeaders=Cc`, { fetchImpl });
      if (msg) return sentOne(msg);
    }
  }
  return { look: 'gone' };
}

// ─── Telling the sender ─────────────────────────────────────────────

const when = (f) => {
  const day = dayWords(f.date);
  return day ? `${day}${f.start ? `, at ${pressTime(f.start)}` : ', time to be confirmed'}` : 'No date yet';
};

/** The email to the sender → { subject, html, text } */
export function pressNote(kind, { name, f = {}, count = 0, reason = '', link = '', sent = false }) {
  const t = {
    drafted: { subject: `${name}’s press release is in your Gmail drafts`, intro: `JobTread confirmed ${name}’s reveal, so the site drafted the press release in your Gmail${count ? `, with the ${count} people on the press list in Bcc` : ''}. Read it over, make any changes right in the draft, and send it from Gmail when you’re ready.` },
    early: { subject: `${name}’s press release is in your Gmail drafts`, intro: `Someone drafted ${name}’s press release from the admin before JobTread confirmed the reveal, so the time says “to be confirmed”. Hold it until JobTread confirms: the draft fills in the time by itself, as long as it hasn’t been changed in Gmail.` },
    updated: { subject: `${name}’s press release has the new details`, intro: `JobTread changed ${name}’s reveal. The draft in your Gmail had no changes of yours, so the site brought it up to date. It now says:` },
    edited: { subject: `${name}’s reveal changed: please update your press release`, intro: `JobTread changed ${name}’s reveal. You’ve edited the draft in Gmail, so the site left it as you made it. Please change it to match this before you send it:` },
    'after-send': { subject: `${name}’s reveal changed after the press release went out`, intro: `JobTread changed ${name}’s reveal after the press release was sent. Please send the press a short update with the new details:` },
    held: { subject: `Please hold ${name}’s press release`, intro: sent ? `JobTread says ${name}’s reveal may be off (${reason}), and the press release already went out. If the reveal is off, please let the press know.` : `JobTread says ${name}’s reveal may be off (${reason}). Please don’t send the draft in your Gmail until that’s sorted out.` },
    'back-on': { subject: `${name}’s reveal is back on`, intro: sent ? `JobTread says ${name}’s reveal is back on, and the press release already went out. If you told the press it was off, send them the details below.` : `JobTread says ${name}’s reveal is back on. The press release in your Gmail drafts is ready to look over and send. It says:` },
  }[kind];
  const rows = kind === 'held' ? [['JobTread says', reason]] : [['When', when(f)], ['Where', cleanAddress(f.address) || 'No address in JobTread yet'], ['Notes', f.details || null]];
  const bodyHtml = factRows(rows.map(([k, v]) => [k, v ? escMail(v).replace(/\n/g, '<br>') : null]))
    + (link ? `<div style="margin:18px 0 6px;">${button(sent ? 'Open it in Gmail' : 'Open the draft in Gmail', link)}</div>` : '')
    + `<p class="muted" style="margin:14px 0 0;font-size:13px;line-height:1.55;">The press list and the words every press release carries are in the admin, under Reveals → Invites → Press release.</p>`;
  const html = emailShell({ preheader: t.intro, eyebrow: 'Press release', heading: t.subject, intro: escMail(t.intro), bodyHtml, footerHtml: `Sent by the website when JobTread changes a reveal. <a href="${escMail(ADMIN_URL)}" style="color:inherit;">Reveals in the admin</a>` });
  const text = [t.subject, '', t.intro, '', ...rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`), ...(link ? ['', `Gmail: ${link}`] : [])].join('\n');
  return { subject: t.subject, html, text };
}

async function tell(env, to, kind, ctx) {
  if (!emailConfigured(env) || !isEmail(to)) return false;
  const note = pressNote(kind, ctx);
  const out = await sendEmails(env, { to: [to], subject: note.subject, html: note.html, text: note.text, tags: [{ name: 'category', value: 'press-release' }] }).catch(() => null);
  return (out?.sent || 0) > 0;
}

// ─── Keeping a reveal's press release in step ────────────────────────────

/**
 * One look at a reveal's press release, from JobTread's latest (./_reveal-invites.js runs it beside the Kit
 * drafts, under the job's lock) → { press: 'off'|'skip'|'drafted'|'updated'|'unchanged'|'edited'|'sent'|'gone'|'held'|'error', … }
 * plan: planInvite's upsert; hold: why JobTread says the reveal may be off; early: drafted from the admin before JobTread
 * confirms, or again after it was deleted in Gmail. alertTo: staff told of a problem that's still there on the next look.
 */
export async function syncPressRelease(env, { jobId, plan = null, hold = null, who, room = '', child = {}, sandbox = false, early = false, alertTo = [], fetchImpl = fetch } = {}) {
  const { DB } = env;
  const settings = await readPressSettings(DB);
  if (!settings.enabled) return { press: 'off' };
  if (sandbox) return { press: 'skip', reason: 'a rehearsal never drafts a press release' };
  if (who?.project || (who && !who.slug && who.url)) return { press: 'skip', reason: 'only for kids’ reveals' };
  if (!hold && plan?.action !== 'upsert') return { press: 'skip', reason: plan?.reason || 'no reveal to announce' };
  if (!env.GOOGLE_CALENDAR_KEY) return { press: 'skip', reason: 'the Google key isn’t set in Cloudflare' };
  const name = who?.name || 'A kid';
  let row = await readPressRow(DB, jobId);
  if (hold && (!row?.draft_id || row.state === 'gone')) return { press: 'skip', reason: 'no draft waiting' };
  const f = hold ? {} : inviteFacts(plan, who, room);
  const firm = !hold && !!(plan.confirmed && f.start);
  if (!row?.draft_id && !early && !firm) return { press: 'skip', reason: 'not confirmed with a time' };
  if (row?.state === 'gone' && !early) return { press: 'skip', reason: 'the draft was deleted in Gmail' };

  // A problem shows in the admin at once, and is emailed to staff when it's still there on the next look (a blip isn't an alarm)
  const fail = async (error) => {
    const again = row?.error === error;
    const base = row || { job_id: jobId, slug: who?.slug || null, state: 'error', created_at: new Date().toISOString() };
    let alarmed = base.alarmed ?? null;
    if (again && alarmed !== error && alertTo.length && emailConfigured(env)) {
      const heading = `${name}’s press release couldn’t be drafted`;
      const intro = `${error} The site tries again each time JobTread changes the reveal, and every six hours.`;
      const html = emailShell({ preheader: intro, eyebrow: 'Press release', heading, intro: escMail(intro), bodyHtml: `<div style="margin:18px 0 6px;">${button('Reveals in the admin', `${SITE_URL}/admin/#broadcast`)}</div>`, footerHtml: 'Sent by the website once per problem.' });
      const out = await sendEmails(env, { to: alertTo, subject: `[SOARD] ${heading}`, html, text: `${heading}\n\n${intro}\n\n${SITE_URL}/admin/#broadcast`, tags: [{ name: 'category', value: 'press-release' }] }).catch(() => null);
      if ((out?.sent || 0) > 0) alarmed = error;
    }
    row = await writePressRow(DB, { ...base, error, alarmed });
    return { press: 'error', error };
  };
  const reuse = !!(row?.draft_id && row.state !== 'gone' && !early);
  let sender;
  let token;
  try {
    sender = await senderOf(env, reuse && row.sender ? row.sender : settings.from);
    token = await accessToken(env, reuse && row.mailbox ? row.mailbox : sender.account, { fetchImpl, scope: GMAIL_MODIFY_SCOPE });
  } catch (e) {
    return fail(`The site couldn’t open ${sender?.email || settings.from}’s Gmail (${e.message}).`);
  }
  const hash = hold ? row.hash : await factsHash(f);
  const toldAbout = String(row?.told || '');
  const toldHash = toldAbout.split(':').slice(1).join(':');
  const linkFor = (r, sent = false) => gmailLink(r.sender || sender.email, { messageId: r.message_id, sent });
  const told = async (kind, ctx) => {
    if (await tell(env, row.sender, kind, { name, f, ...ctx })) row = await writePressRow(DB, { ...row, told: `${kind}:${kind === 'held' ? hold : hash}` });
  };
  const ok = async (patch) => { row = await writePressRow(DB, { ...row, ...patch, error: null, alarmed: null }); };

  try {
    // A draft is out there: see what's become of it first
    if (row?.draft_id && row.state !== 'gone' && !(early && row.state === 'sent')) {
      const seen = row.state === 'sent' ? { look: 'sent', messageId: row.message_id, sentAt: row.sent_at, count: row.count } : await lookAtDraft(token, row, { fetchImpl, name });
      if (seen.look === 'gone') {
        await ok({ state: 'gone' });
        if (!early) return { press: 'gone', reason: 'deleted in Gmail' };
      } else if (seen.look === 'sent') {
        await ok({ state: 'sent', message_id: seen.messageId, sent_at: seen.sentAt, count: seen.count ?? row.count });
        const link = linkFor(row, true);
        if (hold) {
          if (toldAbout !== `held:${hold}`) await told('held', { reason: hold, sent: true, link });
          return { press: 'held', state: 'sent' };
        }
        // JobTread changed it after it went out: she's told once, to send the press an update. Facts she'd already been
        // told of (an edited draft's note) went out with it, so they're no news.
        if (toldAbout.startsWith('held:')) await told('back-on', { sent: true, link });
        else if (hash !== row.hash && toldHash !== hash) await told('after-send', { sent: true, link });
        return { press: 'sent', sentAt: row.sent_at, count: row.count };
      } else if (seen.look === 'edited') {
        await ok({ state: 'edited' });
        const link = linkFor({ ...row, message_id: seen.messageId });
        if (hold) {
          if (toldAbout !== `held:${hold}`) await told('held', { reason: hold, link });
          return { press: 'held', state: 'edited' };
        }
        // Her draft, her words: a new day, time or address reaches her as an email
        if (toldAbout.startsWith('held:')) await told('back-on', { link });
        else if (hash !== row.hash && toldHash !== hash) await told('edited', { link });
        return { press: 'edited', draftId: row.draft_id };
      } else {
        // As the site left it
        if (hold) {
          if (toldAbout !== `held:${hold}`) await told('held', { reason: hold, link: linkFor(row) });
          return { press: 'held', state: 'draft' };
        }
        const built = await buildRelease(env, { who, f, room, child, settings: { ...settings, from: row.sender || settings.from }, token, fetchImpl });
        if (built.error) return fail(built.error);
        const content = await sha([built.mail.subject, built.mail.html, built.bcc.map((p) => p.email)]);
        let result = 'unchanged';
        if (content !== row.content) {
          const raw = pressMime({ from: { email: built.sender.email, name: built.sender.name }, bcc: built.bcc, ...built.mail });
          const put = await gmail(token, `/drafts/${encodeURIComponent(row.draft_id)}`, { method: 'PUT', body: { id: row.draft_id, message: { raw } }, fetchImpl });
          if (!put?.message?.id) return fail('Gmail didn’t take the updated draft.');
          await ok({ state: 'draft', message_id: put.message.id, content, hash, story_by: built.storyBy, count: built.count });
          result = 'updated';
        } else if (row.error) await ok({});
        // She hears when what it says changed (never for a press list or wording change), or that it's back on
        const kind = !toldAbout ? (firm ? 'drafted' : 'early') : toldAbout.startsWith('held:') ? 'back-on' : toldHash !== hash ? 'updated' : null;
        if (kind) await told(kind, { count: built.count, link: linkFor(row) });
        return { press: result, draftId: row.draft_id };
      }
    }
    if (hold) return { press: 'skip', reason: 'no draft waiting' };

    // A new draft
    const built = await buildRelease(env, { who, f, room, child, settings, token, fetchImpl });
    if (built.error) return fail(built.error);
    const content = await sha([built.mail.subject, built.mail.html, built.bcc.map((p) => p.email)]);
    const base = { job_id: jobId, slug: who.slug, mailbox: built.sender.account, sender: built.sender.email, hash, content, story_by: built.storyBy, told: null, error: null, alarmed: null, count: built.count, created_at: new Date().toISOString(), sent_at: null };
    // One already in her drafts with this subject (Gmail took one whose answer never came back, or she started one
    // herself): never a second. It's taken as hers, so the site never rewrites it, and she hears of any change.
    if (!early) {
      const q = `in:drafts subject:"${built.mail.subject.replace(/"/g, '')}"`;
      const there = await gmail(token, `/drafts?maxResults=1&q=${encodeURIComponent(q)}`, { fetchImpl });
      const d = there?.drafts?.[0];
      if (d?.id && d.message?.id) {
        row = await writePressRow(DB, { ...base, draft_id: d.id, message_id: d.message.id, state: 'edited' });
        await told(firm ? 'drafted' : 'early', { count: built.count, link: linkFor(row) });
        return { press: 'edited', draftId: d.id, found: true };
      }
    }
    const raw = pressMime({ from: { email: built.sender.email, name: built.sender.name }, bcc: built.bcc, ...built.mail });
    const made = await gmail(token, '/drafts', { method: 'POST', body: { message: { raw } }, fetchImpl });
    if (!made?.id || !made?.message?.id) return fail('Gmail didn’t take the draft.');
    row = await writePressRow(DB, { ...base, draft_id: made.id, message_id: made.message.id, state: 'draft' });
    await told(firm ? 'drafted' : 'early', { count: built.count, link: linkFor(row) });
    return { press: 'drafted', draftId: made.id, told: !!row.told };
  } catch (e) {
    return fail(/[.!?]$/.test(e.message) ? e.message : `${e.message}.`);
  }
}

/**
 * Where each reveal's press release stands, for Reveals → Now: { [jobId]: { state, at, sentAt, count, error, sender, link, storyBy } }.
 * look: ask Gmail about drafts still waiting, so a send shows straight away (a few jobs at most). names: each job's
 * kid, so one sent after she changed it is found in her Sent mail too.
 */
export async function pressStatus(env, jobIds, { look = false, names = {}, fetchImpl = fetch } = {}) {
  const { DB } = env;
  if (!jobIds.length) return {};
  await ensurePressSchema(DB);
  const got = await DB.prepare(`SELECT * FROM reveal_press WHERE job_id IN (${jobIds.map(() => '?').join(', ')})`).bind(...jobIds).all();
  const out = {};
  for (let row of got.results || []) {
    if (look && env.GOOGLE_CALENDAR_KEY && row.draft_id && ['draft', 'edited'].includes(row.state)) {
      try {
        const token = await accessToken(env, row.mailbox, { fetchImpl, scope: GMAIL_MODIFY_SCOPE });
        const name = names[row.job_id] || '';
        const seen = await lookAtDraft(token, row, { fetchImpl, name });
        if (seen.look === 'sent') row = await writePressRow(DB, { ...row, state: 'sent', message_id: seen.messageId, sent_at: seen.sentAt, count: seen.count ?? row.count });
        else if (seen.look === 'edited' && row.state !== 'edited') row = await writePressRow(DB, { ...row, state: 'edited' });
        // (gone is only said once her Sent mail was searched by the kid's name too)
        else if (seen.look === 'gone' && name) row = await writePressRow(DB, { ...row, state: 'gone' });
      } catch { /* the stored state stands */ }
    }
    out[row.job_id] = {
      state: row.state, at: row.created_at, sentAt: row.sent_at, count: row.count ?? null, error: row.error || null,
      sender: row.sender || null, storyBy: row.story_by || null,
      // (her own edit of the draft has an id the site doesn't keep, so that one opens her drafts)
      link: row.sender ? gmailLink(row.sender, row.state === 'edited' ? {} : { messageId: row.message_id, sent: row.state === 'sent' }) : null,
    };
  }
  return out;
}
