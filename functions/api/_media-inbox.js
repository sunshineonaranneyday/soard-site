/**
 * Photos and videos the team sends in, by email or by text (Admin → Photos & Videos)
 * ===========================================================================
 * Peter, Nov 26 2026: "my team also is using icloud to share random photos
 * with social media, can we setup an email or text number for them to send to
 * so that they also go to the photos and vidoes pages in admin??", then "i
 * want my team to either email or text", "no patches,no shortcuts!!!!".
 *
 *   Email  photos@sunshineonaranneyday.com. Cloudflare Email Routing hands
 *          each message to SOARD's own email Worker (workers/media-inbox),
 *          which keeps the message exactly as it came (MEDIA_FILES
 *          raw/email/…) and tells the site at once (/api/media-inbox, signed).
 *          The heartbeat picks up any the site didn't hear about.
 *   Text   SOARD Photos' own number (Twilio, its own Messaging Service:
 *          setupTextNumber), whose texts come to /api/media-text, signed by
 *          Twilio.
 *
 * Each message, one path for both (receive):
 *   1. Who sent it. An email counts only when its sender is proven (DMARC, or
 *      DKIM signed by the sender's own domain, as Cloudflare's mail servers
 *      checked it): anyone at soardcharity.com, or someone on Photos & Videos →
 *      Send photos → Who can send. A text counts from a number on that list or
 *      on Reveals → Settings → Alerts (staff's phones). Anything else is kept
 *      for staff to look at (let through or delete), never filed, never
 *      answered.
 *   2. The files: every photo and video attached (or inline in the email, but
 *      not a signature's little logo), and the big ones phones send as links:
 *      an iPhone's Mail Drop link, a Google Drive link from a soardcharity.com
 *      sender (read through the site's delegation). Anything else (a PDF, a
 *      document) is left out and said so.
 *   3. Each one kept exactly as sent: the original in SOARD's own private
 *      bucket (MEDIA_FILES originals/…). Photos also get their copies made by
 *      Cloudflare's Images binding (IMAGES): a small one and a large one to
 *      look at, and a full-size JPEG to download, all with nothing of where it
 *      was taken in them. Videos also go to Stream, for playing and an MP4
 *      download that carries no location.
 *   4. Where it goes: the kid, event or project named in the subject or the
 *      text (the way Kids → Upload reads a folder's name); else the family's
 *      home it was taken at (the photo's own GPS against each job's location,
 *      read here and never kept); else the reveal or event that was on the day
 *      it was taken; else Sent in by the team. Before, During or After when
 *      the words say so ("Colin before"). Staff can move any of it.
 *   5. In the index (./_media-index.js) at once, as source 'inbox': searchable
 *      by who sent it and what they wrote. A photo still has the address check
 *      before the people who sign in for Photos & Videos only see it
 *      (./_media-describe.js); a video goes straight through (sent for this).
 *   6. A reply to the sender saying what came in and where it went, once Peter
 *      has approved its words (settings.replies; never on by itself).
 *
 * Nothing is ever lost: the raw email is kept before anything else, each
 * message is one row (media_inbox) with what happened to it, a message seen
 * twice (Message-ID, MessageSid) is done once, and a failed one is tried again
 * on the heartbeat, three times in all.
 */

import PostalMime from 'postal-mime';
import { normalizePhone, alertPhones, isEmail } from './_broadcast-notify.js';
import { readConfig } from './_broadcast.js';
import { STAFF_DOMAIN } from './_board-roles.js';
import { accessToken } from './_google-calendar.js';
import { DRIVE_READ_SCOPE } from './_drive-search.js';
import { guessFromName, jpegFacts, heicExifPlace, heicExifFacts, movieSpot, homesAt } from '../../public/admin/kid-guess.js';
import { ensureMediaIndex, writeItems, finish, loadContext, kindOf, norm, libName } from './_media-index.js';
import { STREAM_CODE } from '../../public/admin/media-shared.js';

export const ADDRESS = 'photos@sunshineonaranneyday.com';
export const INBOX_ALBUM = 'lib:inbox';
const SITE = 'https://sunshineonaranneyday.com';
const SETTINGS_KEY = 'media-inbox';
const MAX_TRIES = 3;
/** A picture this small inline in an email is a signature's logo or an icon, not a photo someone sent */
const TINY_INLINE = 20 * 1024;
/** The largest file a link may bring in (a Mail Drop video can be several GB; Stream takes up to 30 GB) */
const MAX_LINKED = 5 * 1024 ** 3;

const iso = (t = Date.now()) => new Date(t).toISOString();
const parse = (s) => { try { return JSON.parse(s || '{}') || {}; } catch { return {}; } };
const enc = new TextEncoder();

// ─── Schema and settings ───────────────────────────────────────────

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS media_inbox (
    id TEXT PRIMARY KEY, channel TEXT NOT NULL, dedupe TEXT UNIQUE, from_addr TEXT, from_name TEXT, sender_ok INTEGER NOT NULL DEFAULT 0,
    why TEXT, subject TEXT, note TEXT, raw_key TEXT, received_at TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'new', album TEXT, stage TEXT,
    files INTEGER NOT NULL DEFAULT 0, skipped TEXT, error TEXT, tries INTEGER NOT NULL DEFAULT 0, done_at TEXT, reply TEXT, replied_at TEXT)`,
  'CREATE INDEX IF NOT EXISTS media_inbox_state ON media_inbox (state, received_at)',
  `CREATE TABLE IF NOT EXISTS media_senders (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT, phone TEXT, added_by TEXT, added_at TEXT NOT NULL)`,
];
const _ready = new WeakSet();
export async function ensureInbox(DB) {
  if (_ready.has(DB)) return;
  await ensureMediaIndex(DB);
  await DB.batch(SCHEMA.map((s) => DB.prepare(s)));
  _ready.add(DB);
}
export async function readSettings(DB) {
  const row = await DB.prepare('SELECT data FROM site_config WHERE key = ?').bind(SETTINGS_KEY).first().catch(() => null);
  return { replies: false, ...parse(row?.data) };
}
export async function writeSettings(DB, patch) {
  const next = { ...(await readSettings(DB)), ...patch };
  await DB.prepare('INSERT OR REPLACE INTO site_config (key, data, updated_at) VALUES (?, ?, ?)').bind(SETTINGS_KEY, JSON.stringify(next), iso()).run();
  return next;
}

// ─── Who may send ──────────────────────────────────────────────────

export async function listSenders(DB) {
  await ensureInbox(DB);
  return ((await DB.prepare('SELECT id, name, email, phone, added_by, added_at FROM media_senders ORDER BY name').all()).results || [])
    .map((r) => ({ id: r.id, name: r.name, email: r.email || null, phone: r.phone || null, addedBy: r.added_by || null, addedAt: r.added_at }));
}
export async function addSender(DB, { name, email = '', phone = '', by = null }) {
  await ensureInbox(DB);
  const e = String(email || '').trim().toLowerCase();
  const p = phone ? normalizePhone(phone) : null;
  if (!String(name || '').trim()) throw Object.assign(new Error('Say who they are'), { status: 400 });
  if (e && !isEmail(e)) throw Object.assign(new Error('That isn’t a whole email address'), { status: 400 });
  if (phone && !p) throw Object.assign(new Error('That isn’t a phone number a text can come from'), { status: 400 });
  if (!e && !p) throw Object.assign(new Error('Give an email address, a phone number, or both'), { status: 400 });
  const id = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await DB.prepare('INSERT INTO media_senders (id, name, email, phone, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, String(name).trim().slice(0, 80), e || null, p, by, iso()).run();
  return id;
}
export async function removeSender(DB, id) {
  await ensureInbox(DB);
  return !!(await DB.prepare('DELETE FROM media_senders WHERE id = ?').bind(String(id)).run())?.meta?.changes;
}

/**
 * What the receiving mail server (Cloudflare's) found about the sender: { dmarc, dkim: [domains passed], spf }.
 * Read from its Authentication-Results (or ARC-Authentication-Results) line, never from anything the sender wrote
 */
export function authOf(headers = []) {
  const lines = headers.filter((h) => /^(arc-)?authentication-results$/i.test(h.key)).map((h) => String(h.value));
  const mine = lines.filter((l) => /mx\.cloudflare\.net/i.test(l));
  const text = (mine.length ? mine : lines).join(' ; ');
  const dkim = [...text.matchAll(/\bdkim=pass\b[^;]*?header\.(?:d|i)=@?([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase());
  return { dmarc: /\bdmarc=pass\b/i.test(text), dkim, spf: /\bspf=pass\b/i.test(text) };
}
/** Is the From address proven? DMARC passed, or a DKIM signature by the From address's own domain (or one above it) */
export function provenFrom(addr, auth) {
  const domain = String(addr || '').split('@')[1]?.toLowerCase() || '';
  if (!domain) return false;
  return auth.dmarc || auth.dkim.some((d) => d === domain || domain.endsWith(`.${d}`));
}

/** Who a message is from: { ok, name, why } (ok: theirs to file; else kept for staff) */
export async function whoSent(env, { channel, from, fromName = '', auth = null }) {
  const senders = await listSenders(env.DB);
  if (channel === 'email') {
    const addr = String(from || '').trim().toLowerCase();
    if (!provenFrom(addr, auth || { dmarc: false, dkim: [] })) return { ok: false, name: fromName || addr, why: 'Its sender couldn’t be proven (the email failed DMARC and DKIM)' };
    const listed = senders.find((s) => s.email === addr);
    if (listed) return { ok: true, name: listed.name };
    if (addr.endsWith(`@${STAFF_DOMAIN}`)) return { ok: true, name: fromName || addr.split('@')[0] };
    return { ok: false, name: fromName || addr, why: 'Not on the team or on Who can send' };
  }
  const phone = normalizePhone(from);
  const listed = senders.find((s) => s.phone && s.phone === phone);
  if (listed) return { ok: true, name: listed.name };
  let staff = [];
  try { staff = alertPhones(await readConfig(env.DB)); } catch { /* no alert list: none */ }
  if (phone && staff.includes(phone)) return { ok: true, name: 'Staff phone' };
  return { ok: false, name: phone || String(from || ''), why: 'A number not on Who can send' };
}

// ─── Words: the note, and where it goes ────────────────────────────

/** What someone wrote, without the quoted reply, the signature or the phone's own sign-off */
export function noteOf(text = '') {
  const lines = String(text).replace(/\r/g, '').split('\n');
  const out = [];
  for (const line of lines) {
    const l = line.trim();
    if (/^(--|__|sent from my |get outlook for |on .+wrote:$|-+ ?original message|from: )/i.test(l) || /^>/.test(l)) break;
    out.push(l);
  }
  return out.join(' ').replace(/\s+/g, ' ').trim().slice(0, 500);
}
/** Before, During or After when the words say so */
export function stageOfWords(words) {
  const w = ` ${norm(words)} `;
  if (/ (before|existing|home visit) /.test(w)) return 'Before';
  if (/ (during|progress|demo|demolition|construction|build|building|install|framing|drywall|tile|tiling) /.test(w)) return 'During';
  if (/ (after|reveal|revealed|finished|done|final) /.test(w)) return 'After';
  return null;
}

/** The facts a photo or video carries: { lat, lng, taken (ISO) } (where is read to file it and never kept) */
export function factsOf(bytes, file = {}) {
  const f = rawFacts(bytes, file);
  const t = f.taken instanceof Date ? f.taken : f.taken ? new Date(f.taken) : null;
  return { ...f, taken: t && !Number.isNaN(t.getTime()) ? t.toISOString() : null };
}
function rawFacts(bytes, { type = '', name = '' } = {}) {
  try {
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + Math.min(bytes.byteLength, 4 * 1024 * 1024));
    if (/jpe?g/i.test(type) || /\.jpe?g$/i.test(name)) return jpegFacts(buf) || {};
    if (/hei[cf]/i.test(type) || /\.hei[cf]$/i.test(name)) {
      const place = heicExifPlace(buf);
      if (!place?.length) return {};
      return heicExifFacts(bytes.buffer.slice(bytes.byteOffset + place.offset, bytes.byteOffset + place.offset + place.length)) || {};
    }
    if (/^video\//.test(type) || /\.(mov|mp4|m4v)$/i.test(name)) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      let o = 0;
      for (let i = 0; i < 64 && o + 8 <= bytes.byteLength; i++) {
        let size = view.getUint32(o);
        const box = String.fromCharCode(...bytes.subarray(o + 4, o + 8));
        if (size === 1 && o + 16 <= bytes.byteLength) size = Number(view.getBigUint64(o + 8));
        else if (size === 0) size = bytes.byteLength - o;
        if (box === 'moov') return movieSpot(bytes.buffer.slice(bytes.byteOffset + o, bytes.byteOffset + Math.min(o + size, bytes.byteLength)));
        if (size < 8) break;
        o += size;
      }
    }
  } catch { /* unreadable: no facts */ }
  return {};
}

const dayOf = (t) => (t ? new Date(t).toISOString().slice(0, 10) : null);
/**
 * Where one message's files go: { album, by } by the words (a kid, event or project named), the home a file was taken
 * at, the reveal or event on its day, else Sent in by the team. ctx: { kids, events, projects, homes, reveals }
 */
export function fileTo(words, facts, ctx) {
  const kids = ctx.kids || [];
  const named = guessFromName(String(words || ''), kids, facts?.taken || null);
  if (named?.slug) return { album: `kid:${named.slug}`, by: 'name' };
  const w = ` ${norm(words)} `;
  const titled = (list, kind, nameOf) => list.filter((r) => { const n = norm(nameOf(r)).replace(/\b(19|20)\d\d\b/g, '').trim(); return n.length >= 3 && w.includes(` ${n} `); })
    .sort((a, b) => norm(nameOf(b)).length - norm(nameOf(a)).length)[0];
  const ev = titled(ctx.events || [], 'event', (e) => e.title) || (/\bgala\b/.test(w) ? (ctx.events || []).filter((e) => /gala|evening of sunshine/i.test(e.title || '')).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] : null)
    || (/\bgolf\b/.test(w) ? (ctx.events || []).filter((e) => /golf|fairway/i.test(e.title || '')).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] : null);
  if (ev) return { album: `event:${ev.slug}`, by: 'name' };
  const pr = titled(ctx.projects || [], 'community', (p) => p.name);
  if (pr) return { album: `community:${pr.slug}`, by: 'name' };
  const near = facts && Number.isFinite(facts.lat) ? homesAt(facts, ctx.homes || [])[0] : null;
  if (near) return { album: near.slug.startsWith('community/') ? `community:${near.slug.slice(10)}` : `kid:${near.slug}`, by: 'home' };
  // (the day as SOARD has it, Eastern: a photo at an 8 PM reveal is that day's, not the next day's in UTC)
  const day = facts?.taken && !Number.isNaN(Date.parse(facts.taken)) ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(facts.taken)) : null;
  if (day) {
    const rv = (ctx.reveals || []).find((r) => r.date === day);
    if (rv) return { album: `kid:${rv.slug}`, by: 'day' };
    const e = (ctx.events || []).find((x) => x.date && x.date <= day && day <= (x.endDate || x.date));
    if (e) return { album: `event:${e.slug}`, by: 'day' };
  }
  return { album: INBOX_ALBUM, by: null };
}

/** What filing needs, read once a message: the records, each job's map point, the reveal days (live and past) */
export async function filingContext(env, { fetchImpl = fetch } = {}) {
  const rows = async (sql) => { try { return (await env.DB.prepare(sql).all()).results || []; } catch { return []; } };
  const [kidRows, eventRows, projectRows, bcRows, revealsRow] = await Promise.all([
    rows('SELECT slug, data FROM kids'), rows('SELECT slug, data FROM events'), rows('SELECT slug, data FROM community'),
    rows('SELECT kid_slug, live_at FROM broadcasts WHERE live_at IS NOT NULL'),
    env.DB.prepare("SELECT data FROM site_config WHERE key = 'reveals'").first().catch(() => null),
  ]);
  const kids = kidRows.map((r) => { const d = parse(r.data); return { slug: r.slug, name: d.name || r.slug, year: d.year ?? null, status: d.status || 'completed' }; });
  const events = eventRows.map((r) => { const d = parse(r.data); return { slug: r.slug, title: d.title || r.slug, date: d.date || null, endDate: d.endDate || null }; });
  const projects = projectRows.map((r) => { const d = parse(r.data); return { slug: r.slug, name: d.name || r.slug }; });
  const cached = parse(revealsRow?.data);
  const reveals = [...(cached.past || []), ...(cached.upcoming || []), ...bcRows.map((b) => ({ slug: b.kid_slug, date: String(b.live_at).slice(0, 10) }))].filter((r) => r?.slug && r.date);
  let homes = [];
  if (env.JOBTREAD_GRANT_KEY) {
    try {
      const { fetchAllJobs } = await import('./reveals-admin.js');
      const { kidHomes } = await import('./kid-homes.js');
      const { loadAllKids, loadAllProjects } = await import('./_kid-status.js');
      const [jobs, allKids, allProjects] = await Promise.all([fetchAllJobs(env.JOBTREAD_GRANT_KEY, fetchImpl), loadAllKids(env.DB), loadAllProjects(env.DB)]);
      homes = kidHomes(jobs, allKids, allProjects);
    } catch { /* no homes: filing by name and day only */ }
  }
  return { kids, events, projects, homes, reveals };
}

// ─── The files ─────────────────────────────────────────────────────

const PHOTO_TYPE = /^image\/(jpe?g|png|heic|heif|webp|gif|tiff|x-adobe-dng|dng)$/i;
const clean = (name) => String(name || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'file';

/** The big files a phone sends as a link instead: iPhone Mail Drop, Google Drive (a soardcharity.com sender's own) */
export function linksIn(html = '', text = '') {
  const out = [];
  const all = `${html} ${text}`.replace(/&amp;/g, '&');
  for (const m of all.matchAll(/https:\/\/www\.icloud\.com\/attachment\/\?[^\s"'<>]+/g)) {
    const u = new URL(m[0]);
    const name = u.searchParams.get('f');
    const raw = u.searchParams.get('u');
    if (!raw || !name) continue;
    // The download address is in the link, the file's name in place of ${f}
    const url = raw.replace('${f}', encodeURIComponent(name));
    if (!/^https:\/\/[a-z0-9.-]+\.icloud-content\.com\//.test(url)) continue;
    if (!out.some((x) => x.url === url)) out.push({ kind: 'maildrop', url, name, size: Number(u.searchParams.get('sz')) || null });
  }
  for (const m of all.matchAll(/https:\/\/drive\.google\.com\/(?:file\/d\/|open\?id=)([A-Za-z0-9_-]{20,})/g)) {
    if (!out.some((x) => x.id === m[1])) out.push({ kind: 'drive', id: m[1] });
  }
  return out;
}

/** An email's files: [{ name, type, bytes }] attached or inline, and the links to fetch; with what was left out */
export async function emailParts(raw) {
  const mail = await PostalMime.parse(raw);
  const files = [];
  const skipped = [];
  for (const a of mail.attachments || []) {
    const bytes = new Uint8Array(a.content instanceof ArrayBuffer ? a.content : enc.encode(String(a.content || '')));
    const name = clean(a.filename || `${a.disposition === 'inline' ? 'inline' : 'attachment'}.${String(a.mimeType || '').split('/')[1] || 'bin'}`);
    const kind = kindOf(a.mimeType, name);
    if (!kind) { skipped.push(name); continue; }
    if (a.disposition === 'inline' && kind === 'photo' && bytes.length < TINY_INLINE) continue;
    files.push({ name, type: a.mimeType || '', bytes, kind });
  }
  return {
    from: mail.from?.address || '', fromName: mail.from?.name || '', subject: String(mail.subject || '').slice(0, 300),
    text: mail.text || '', html: mail.html || '', messageId: mail.messageId || null, headers: mail.headers || [], date: mail.date || null,
    files, skipped, links: linksIn(mail.html || '', mail.text || ''),
  };
}

/** One file brought in from a link: { name, type, bytes } or throws with why */
async function fetchLinked(env, link, { from, fetchImpl = fetch }) {
  if (link.kind === 'maildrop') {
    const res = await fetchImpl(link.url, { signal: AbortSignal.timeout(120000) });
    if (!res.ok) throw new Error(`Mail Drop answered ${res.status} (the link may have run out)`);
    const size = Number(res.headers.get('content-length')) || link.size || 0;
    if (size > MAX_LINKED) throw new Error('over 5 GB');
    const type = (res.headers.get('content-type') || '').split(';')[0];
    return { name: clean(link.name), type: /octet-stream|^$/.test(type) ? '' : type, stream: res.body, size };
  }
  if (link.kind === 'drive') {
    if (!String(from).toLowerCase().endsWith(`@${STAFF_DOMAIN}`)) throw new Error('a Drive link from outside SOARD');
    const token = await accessToken(env, String(from).toLowerCase(), { fetchImpl, scope: DRIVE_READ_SCOPE });
    const auth = { headers: { Authorization: `Bearer ${token}` } };
    const meta = await fetchImpl(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(link.id)}?supportsAllDrives=true&fields=name,mimeType,size`, auth);
    const m = meta.ok ? await meta.json() : null;
    if (!m) throw new Error(`Drive answered ${meta.status}`);
    if (!kindOf(m.mimeType, m.name)) throw Object.assign(new Error('not a photo or video'), { skip: m.name });
    if (Number(m.size) > MAX_LINKED) throw new Error('over 5 GB');
    const res = await fetchImpl(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(link.id)}?alt=media&supportsAllDrives=true`, auth);
    if (!res.ok) throw new Error(`Drive answered ${res.status}`);
    return { name: clean(m.name), type: m.mimeType, stream: res.body, size: Number(m.size) || 0 };
  }
  throw new Error('a link of a kind not read');
}

/** A text's photos and videos, from Twilio (fetched with the account's key), and where each is on Twilio (to delete) */
export function textMedia(form) {
  const n = Math.min(10, Number(form.NumMedia) || 0);
  const out = [];
  for (let i = 0; i < n; i++) {
    const url = String(form[`MediaUrl${i}`] || '');
    if (!/^https:\/\/api\.twilio\.com\/2010-04-01\/Accounts\/AC[a-f0-9]{32}\/Messages\/MM[a-f0-9]{32}\/Media\/ME[a-f0-9]{32}$/.test(url)) continue;
    out.push({ url, type: String(form[`MediaContentType${i}`] || '') });
  }
  return out;
}
const twilioAuth = (env) => `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`;

// ─── Keeping one file ──────────────────────────────────────────────

const extOf = (type, name) => (String(name).match(/\.([a-z0-9]{2,5})$/i)?.[1] || ({ 'image/jpeg': 'jpg', 'image/heic': 'heic', 'image/png': 'png', 'video/quicktime': 'mov', 'video/mp4': 'mp4', 'video/3gpp': '3gp' })[String(type).toLowerCase()] || 'bin').toLowerCase();
export const previewKey = (id, size) => `previews/${id}/${size}.jpg`;

/**
 * One file kept: the original in MEDIA_FILES, a photo's copies made (600, 2000, full size: JPEG, no location), a
 * video copied to Stream. → { id, key, size, previews, uid, facts }
 */
export async function keepFile(env, file, { messageId, fetchImpl = fetch, now = Date.now() }) {
  const id = `${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const d = new Date(now);
  const key = `originals/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${id}/${clean(file.name)}`;
  const meta = { httpMetadata: { contentType: file.type || 'application/octet-stream' }, customMetadata: { message: messageId, name: file.name } };
  let bytes = file.bytes || null;
  if (!bytes && file.stream) {
    // A big linked file (a Mail Drop video) goes straight through to the bucket, never held whole: R2 takes a stream of
    // a known length. The first 4 MB are kept back on the way to read where and when it was taken
    if (!file.size) throw new Error('its size wasn’t given, so it couldn’t be kept');
    const [toBucket, toHead] = file.stream.tee();
    const head = (async () => {
      const r = toHead.getReader();
      const chunks = [];
      let n = 0;
      for (;;) {
        const { value, done } = await r.read();
        if (done) break;
        chunks.push(value);
        n += value.length;
        if (n >= 4 * 1024 * 1024) { await r.cancel().catch(() => {}); break; }
      }
      const out = new Uint8Array(n);
      let o = 0;
      for (const c of chunks) { out.set(c, o); o += c.length; }
      return out;
    })();
    const fixed = new FixedLengthStream(file.size);
    const piping = toBucket.pipeTo(fixed.writable);
    await Promise.all([env.MEDIA_FILES.put(key, fixed.readable, meta), piping]);
    bytes = await head;
  } else {
    await env.MEDIA_FILES.put(key, bytes, meta);
  }
  const kind = file.kind || kindOf(file.type, file.name);
  const facts = factsOf(bytes, file);
  const out = { id, key, kind, size: file.size || bytes.length, facts, previews: false, uid: null, error: null };
  if (kind === 'photo') {
    try {
      for (const [size, opts] of [['600', { width: 600, height: 600, fit: 'scale-down' }], ['2000', { width: 2000, height: 2000, fit: 'scale-down' }], ['full', { width: 12000, height: 12000, fit: 'scale-down' }]]) {
        const src = (await env.MEDIA_FILES.get(key)).body;
        const img = await env.IMAGES.input(src).transform(opts).output({ format: 'image/jpeg', quality: size === 'full' ? 95 : 82 });
        await env.MEDIA_FILES.put(previewKey(id, size), img.response().body, { httpMetadata: { contentType: 'image/jpeg' } });
      }
      out.previews = true;
    } catch (e) {
      out.error = `Its copies couldn’t be made: ${String(e.message || e).slice(0, 120)}`;
    }
  } else if (kind === 'video') {
    try {
      const link = await signFileLink(env, key, now);
      const res = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/stream/copy`, {
        method: 'POST', headers: { Authorization: `Bearer ${env.CF_STREAM_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: `${SITE}/api/media-file?${new URLSearchParams(link)}`, meta: { name: file.name, inbox: messageId } }),
        signal: AbortSignal.timeout(20000),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.success === false) throw new Error(j.errors?.[0]?.message || `Stream answered ${res.status}`);
      out.uid = j.result?.uid || null;
    } catch (e) {
      out.error = `Stream couldn’t take it: ${String(e.message || e).slice(0, 120)}`;
    }
  }
  return out;
}

// ─── The short link Stream fetches a video by (/api/media-file) ────

async function hmacHex(key, message) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(message)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const linkKey = (env) => (env.MEDIA_INBOX_SECRET ? hmacHex(env.MEDIA_INBOX_SECRET, 'soard media file link v1') : null);
const LINK_MS = 6 * 3600e3;
export async function signFileLink(env, key, now = Date.now()) {
  const k = await linkKey(env);
  if (!k) throw new Error('MEDIA_INBOX_SECRET isn’t set');
  const q = { k: key, e: String(now + LINK_MS) };
  return { ...q, s: await hmacHex(k, `${q.k}.${q.e}`) };
}
export async function checkFileLink(env, { k, e, s } = {}, now = Date.now()) {
  if (![k, e, s].every((x) => typeof x === 'string' && x) || !/^originals\//.test(k) || !/^\d+$/.test(e) || Number(e) < now) return false;
  const key = await linkKey(env);
  if (!key) return false;
  return safeEqual(await hmacHex(key, `${k}.${e}`), s);
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** The email Worker's word that a message is in: HMAC of "<time>.<key>", within five minutes */
export async function checkWorkerSignature(env, { key, ts, sig }, now = Date.now()) {
  if (!env.MEDIA_INBOX_SECRET || !key || !ts || !sig || Math.abs(now - Number(ts)) > 5 * 60e3) return false;
  return safeEqual(await hmacHex(env.MEDIA_INBOX_SECRET, `${ts}.${key}`), String(sig));
}

// ─── One message ───────────────────────────────────────────────────

/** The row a message's file becomes in the index */
function itemRow(file, msg, filed, ctx, { sender, now }) {
  const stage = msg.stage || null;
  const albumKey = msg.sender_ok ? filed.album : INBOX_ALBUM;
  return finish({
    id: `inb:${file.id}`, source: 'inbox', kind: file.kind, album: albumKey, name: file.name, path: msg.channel === 'email' ? 'Emailed in' : 'Texted in', stage,
    taken_at: file.facts?.taken || null, added_at: iso(now), size: file.size, width: null, height: null, seconds: null,
    mime: file.type || null, ref: file.key, title: `From ${sender}`, alt: [msg.subject, msg.note].filter(Boolean).join(' · ') || null,
    gate: !msg.sender_ok ? 'staff' : file.kind === 'video' ? 'open' : 'check',
    why: !msg.sender_ok ? `Sent by someone not on the list: ${msg.why}` : null,
    prio: 1, extra: JSON.stringify({ uid: file.uid, message: msg.id, from: sender, channel: msg.channel, previews: file.previews }),
  }, ctx);
}

/**
 * Take in one message: who, its files, where they go, the index, the reply → the message's row.
 * input: { channel, dedupe, from, fromName, auth, subject, text, html, rawKey, files: [{ name, type, bytes|stream, size }],
 *          links, skipped, twilio: [{ url, type }] }
 */
export async function receive(env, input, { fetchImpl = fetch, now = Date.now(), filing = null } = {}) {
  const { DB } = env;
  await ensureInbox(DB);
  if (input.dedupe) {
    const seen = await DB.prepare('SELECT * FROM media_inbox WHERE dedupe = ?').bind(input.dedupe).first();
    if (seen && seen.state !== 'failed') return seen;
  }
  const id = `m${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const who = await whoSent(env, { channel: input.channel, from: input.from, fromName: input.fromName, auth: input.auth });
  const note = input.channel === 'email' ? noteOf(input.text) : String(input.text || '').trim().slice(0, 500);
  const words = [input.subject, note].filter(Boolean).join(' ');
  const msg = { id, channel: input.channel, sender_ok: who.ok ? 1 : 0, why: who.why || null, subject: input.subject || null, note: note || null, stage: stageOfWords(words) };
  await DB.prepare(`INSERT INTO media_inbox (id, channel, dedupe, from_addr, from_name, sender_ok, why, subject, note, raw_key, received_at, state, stage, tries)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, 1)
    ON CONFLICT(dedupe) DO UPDATE SET tries = media_inbox.tries + 1, state = 'new', error = NULL`)
    .bind(id, input.channel, input.dedupe || null, input.from || null, who.name || input.fromName || null, msg.sender_ok, msg.why, msg.subject, msg.note, input.rawKey || null, iso(now), msg.stage).run();
  const row = input.dedupe ? await DB.prepare('SELECT id FROM media_inbox WHERE dedupe = ?').bind(input.dedupe).first() : { id };
  msg.id = row.id;
  try {
    const ctx = filing || await filingContext(env, { fetchImpl });
    // The files: attached, then linked, then a text's from Twilio
    const files = [...(input.files || [])];
    const skipped = [...(input.skipped || [])];
    const problems = [];
    for (const link of input.links || []) {
      try { files.push(await fetchLinked(env, link, { from: input.from, fetchImpl })); } catch (e) { if (e.skip) skipped.push(e.skip); else problems.push(`${link.name || 'a linked file'}: ${e.message}`); }
    }
    for (const m of input.twilio || []) {
      const res = await fetchImpl(m.url, { headers: { Authorization: twilioAuth(env) }, signal: AbortSignal.timeout(60000) });
      if (!res.ok) { problems.push(`a texted file: Twilio answered ${res.status}`); continue; }
      const type = (res.headers.get('content-type') || m.type).split(';')[0];
      const kind = kindOf(type, '');
      if (!kind) { skipped.push(type); continue; }
      files.push({ name: `text-${files.length + 1}.${extOf(type, '')}`, type, bytes: new Uint8Array(await res.arrayBuffer()), kind, twilio: m.url });
    }
    // Where they go: the words first; else the first file that says where or when it was taken
    const kept = [];
    for (const f of files) {
      f.kind ||= kindOf(f.type, f.name);
      if (!f.kind) { skipped.push(f.name); continue; }
      const k = await keepFile(env, f, { messageId: msg.id, fetchImpl, now });
      kept.push({ ...k, name: f.name, type: f.type, kind: f.kind });
      if (k.error) problems.push(`${f.name}: ${k.error}`);
    }
    let filed = fileTo(words, null, ctx);
    if (filed.album === INBOX_ALBUM) for (const k of kept) { const g = fileTo('', k.facts, ctx); if (g.album !== INBOX_ALBUM) { filed = g; break; } }
    // The index: each file a row at once (the describer and the address check pick the photos up)
    const indexCtx = await loadContext(DB);
    if (!indexCtx.albums.has(INBOX_ALBUM)) indexCtx.albums.set(INBOX_ALBUM, { key: INBOX_ALBUM, name: libName(INBOX_ALBUM), public: true, kindWord: 'sent in by the team' });
    await writeItems(DB, kept.map((k) => itemRow(k, msg, filed, indexCtx, { sender: who.name, now })), { now });
    // A text's files on Twilio: gone once they're kept here
    for (const f of files.filter((x) => x.twilio)) await fetchImpl(`${f.twilio}.json`, { method: 'DELETE', headers: { Authorization: twilioAuth(env) } }).catch(() => {});
    const state = !msg.sender_ok ? 'held' : kept.length ? (problems.length ? 'partly' : 'done') : 'empty';
    await DB.prepare('UPDATE media_inbox SET state = ?, album = ?, files = ?, skipped = ?, error = ?, done_at = ? WHERE id = ?')
      .bind(state, msg.sender_ok ? filed.album : INBOX_ALBUM, kept.length, skipped.length ? JSON.stringify(skipped.slice(0, 20)) : null, problems.length ? problems.join('; ').slice(0, 800) : null, iso(now), msg.id).run();
    const out = await DB.prepare('SELECT * FROM media_inbox WHERE id = ?').bind(msg.id).first();
    return { ...out, kept, filedBy: filed.by };
  } catch (e) {
    await DB.prepare("UPDATE media_inbox SET state = 'failed', error = ? WHERE id = ?").bind(String(e.message || e).slice(0, 500), msg.id).run();
    throw e;
  }
}

/** An email the Worker kept (MEDIA_FILES raw/email/…): read and taken in */
export async function receiveEmail(env, rawKey, opts = {}) {
  const obj = await env.MEDIA_FILES.get(rawKey);
  if (!obj) throw Object.assign(new Error('No such email'), { status: 404 });
  const raw = await obj.arrayBuffer();
  const p = await emailParts(raw);
  const meta = obj.customMetadata || {};
  // (who it's from: the envelope's sender as the Worker had it when the From line agrees, else the From line itself;
  // either way proven only by the receiving server's checks)
  return receive(env, {
    channel: 'email', dedupe: p.messageId ? `email:${p.messageId}` : `email:${rawKey}`, from: p.from || meta.from, fromName: p.fromName,
    auth: authOf(p.headers), subject: p.subject, text: p.text, html: p.html, rawKey, files: p.files, links: p.links, skipped: p.skipped,
  }, opts);
}

/** A text Twilio sent (its form fields, signature already checked) */
export function receiveText(env, form, opts = {}) {
  return receive(env, {
    channel: 'text', dedupe: `text:${form.MessageSid}`, from: form.From, subject: null, text: form.Body || '', twilio: textMedia(form),
  }, opts);
}

/** The reply to a sender: what came in and where it went. Sent only once Peter has approved these words (settings) */
export function replyText(row, { albumName = null } = {}) {
  const n = row.files || 0;
  if (!n) return 'Nothing came through: send photos or videos as attachments and they’ll go into Photos & Videos.';
  const what = `${n} ${n === 1 ? 'file' : 'files'}`;
  const where = row.album && row.album !== INBOX_ALBUM ? ` for ${albumName || row.album.split(':')[1]}` : '';
  const hint = row.album === INBOX_ALBUM ? ' Put the kid’s or event’s name in your message and they’ll go straight to that album.' : '';
  return `Got ${what}${where}. They’re in Photos & Videos.${hint}`;
}

// ─── Staff ─────────────────────────────────────────────────────────

/** The messages for staff: the newest first, with those kept for a look (from someone not on the list) marked */
export async function listMessages(DB, { limit = 50 } = {}) {
  await ensureInbox(DB);
  return ((await DB.prepare('SELECT * FROM media_inbox ORDER BY received_at DESC LIMIT ?').bind(limit).all()).results || []).map((r) => ({
    id: r.id, channel: r.channel, from: r.from_addr, fromName: r.from_name, ok: !!r.sender_ok, why: r.why, subject: r.subject, note: r.note,
    receivedAt: r.received_at, state: r.state, album: r.album, files: r.files, skipped: parse(r.skipped || '[]'), error: r.error,
  }));
}

/** A message kept for a look, let through: its files filed as if its sender were on the list */
export async function letThrough(env, messageId, { now = Date.now() } = {}) {
  const { DB } = env;
  await ensureInbox(DB);
  const m = await DB.prepare('SELECT * FROM media_inbox WHERE id = ?').bind(messageId).first();
  if (!m) throw Object.assign(new Error('No such message'), { status: 404 });
  const ctx = await filingContext(env);
  const words = [m.subject, m.note].filter(Boolean).join(' ');
  let filed = fileTo(words, null, ctx);
  const rows = (await DB.prepare("SELECT id, kind, taken_at FROM media_items WHERE source = 'inbox' AND json_extract(extra, '$.message') = ?").bind(messageId).all()).results || [];
  if (filed.album === INBOX_ALBUM) for (const r of rows) { const g = fileTo('', r.taken_at ? { taken: r.taken_at } : null, ctx); if (g.album !== INBOX_ALBUM) { filed = g; break; } }
  await moveItems(DB, rows.map((r) => r.id), filed.album, { open: true });
  await DB.prepare("UPDATE media_inbox SET sender_ok = 1, state = 'done', album = ?, why = NULL, done_at = ? WHERE id = ?").bind(filed.album, iso(now), messageId).run();
  return filed.album;
}

/** Files moved to another album (staff's pick); open: their gate as a known sender's (photos still checked) */
export async function moveItems(DB, ids, album, { open = false } = {}) {
  const ctx = await loadContext(DB);
  if (!ctx.albums.has(INBOX_ALBUM)) ctx.albums.set(INBOX_ALBUM, { key: INBOX_ALBUM, name: libName(INBOX_ALBUM), public: true });
  if (!ctx.albums.has(album) && album !== INBOX_ALBUM) throw Object.assign(new Error('No such album'), { status: 400 });
  const a = ctx.albums.get(album);
  let n = 0;
  for (const id of ids.filter((x) => /^inb:/.test(x)).slice(0, 500)) {
    const r = await DB.prepare('SELECT * FROM media_items WHERE id = ?').bind(id).first();
    if (!r) continue;
    const gate = open ? (r.kind === 'video' ? 'open' : 'check') : r.gate;
    const base = finish({ ...r, album, gate, why: open ? null : r.why }, ctx).base;
    const words = [base, norm(r.description || ''), r.tags || ''].filter(Boolean).join(' ');
    await DB.prepare('UPDATE media_items SET album = ?, album_name = ?, gate = ?, why = ?, base = ?, words = ?, hash = NULL, updated_at = ? WHERE id = ?')
      .bind(album, a?.name || libName(album), gate, open ? null : r.why, base, words, iso(), id).run();
    n++;
  }
  return n;
}

/** A message and every file of it, gone: the originals, their copies, the Stream copy, the index rows */
export async function deleteMessage(env, messageId) {
  const { DB } = env;
  await ensureInbox(DB);
  const rows = (await DB.prepare("SELECT id, ref, extra FROM media_items WHERE source = 'inbox' AND json_extract(extra, '$.message') = ?").bind(messageId).all()).results || [];
  for (const r of rows) {
    const fid = r.id.slice(4);
    await env.MEDIA_FILES.delete([r.ref, previewKey(fid, '600'), previewKey(fid, '2000'), previewKey(fid, 'full')].filter(Boolean)).catch(() => {});
    const uid = parse(r.extra).uid;
    if (uid && env.CF_STREAM_TOKEN) await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/stream/${encodeURIComponent(uid)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${env.CF_STREAM_TOKEN}` } }).catch(() => {});
    await DB.prepare('DELETE FROM media_items WHERE id = ?').bind(r.id).run();
  }
  const m = await DB.prepare('SELECT raw_key FROM media_inbox WHERE id = ?').bind(messageId).first();
  if (m?.raw_key) await env.MEDIA_FILES.delete(m.raw_key).catch(() => {});
  await DB.prepare('DELETE FROM media_inbox WHERE id = ?').bind(messageId).run();
  return rows.length;
}

// ─── The heartbeat: emails the site didn't hear about, and ones that failed ────

export async function maybeRunInbox(env, { fetchImpl = fetch, now = Date.now(), deadline = now + 20000 } = {}) {
  const { DB } = env;
  if (!DB || !env.MEDIA_FILES) return null;
  try {
    await ensureInbox(DB);
    const out = { picked: 0, retried: 0, errors: [] };
    const listed = await env.MEDIA_FILES.list({ prefix: 'raw/email/', limit: 100 });
    for (const o of listed.objects || []) {
      if (Date.now() > deadline - 5000) break;
      const known = await DB.prepare('SELECT id, state, tries FROM media_inbox WHERE raw_key = ?').bind(o.key).first();
      if (known && (known.state !== 'failed' || known.tries >= MAX_TRIES)) continue;
      try { await receiveEmail(env, o.key, { fetchImpl, now }); if (known) out.retried++; else out.picked++; } catch (e) { out.errors.push(e.message); }
    }
    return out;
  } catch (e) {
    return { error: e.message };
  }
}

// ─── The text number (Twilio) ──────────────────────────────────────

export const TEXT_WEBHOOK = `${SITE}/api/media-text`;
const TW = 'https://api.twilio.com/2010-04-01';
const TW_MSG = 'https://messaging.twilio.com/v1';
async function tw(env, url, { method = 'GET', form = null } = {}) {
  const res = await fetch(url, { method, headers: { Authorization: twilioAuth(env), ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, body: form ? new URLSearchParams(form) : undefined, signal: AbortSignal.timeout(15000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`Twilio said ${j.message || `HTTP ${res.status}`}`), { status: 502 });
  return j;
}

/**
 * SOARD Photos' own text number: a toll-free number that takes photos and videos (MMS), on a Messaging Service of its
 * own that sends every text to /api/media-text. Done once, when staff press Set up the text number (it costs what a
 * Twilio number costs a month). Toll-free: Twilio's toll-free verification lets it answer the sender; until then it
 * takes texts in and doesn't answer.
 */
export async function setupTextNumber(env, { by = null } = {}) {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) throw Object.assign(new Error('Twilio’s Account SID and Auth Token aren’t both set in Cloudflare'), { status: 503 });
  const settings = await readSettings(env.DB);
  if (settings.number) return settings;
  const acct = encodeURIComponent(env.TWILIO_ACCOUNT_SID);
  const avail = await tw(env, `${TW}/Accounts/${acct}/AvailablePhoneNumbers/US/TollFree.json?MmsEnabled=true&SmsEnabled=true&PageSize=5`);
  const pick = (avail.available_phone_numbers || [])[0];
  if (!pick) throw Object.assign(new Error('Twilio had no toll-free number that takes photos just now: try again in a minute'), { status: 502 });
  const bought = await tw(env, `${TW}/Accounts/${acct}/IncomingPhoneNumbers.json`, { method: 'POST', form: { PhoneNumber: pick.phone_number, FriendlyName: 'SOARD Photos' } });
  const svc = await tw(env, `${TW_MSG}/Services`, { method: 'POST', form: { FriendlyName: 'SOARD Photos', InboundRequestUrl: TEXT_WEBHOOK, InboundMethod: 'POST', UseInboundWebhookOnNumber: 'false' } });
  await tw(env, `${TW_MSG}/Services/${encodeURIComponent(svc.sid)}/PhoneNumbers`, { method: 'POST', form: { PhoneNumberSid: bought.sid } });
  return writeSettings(env.DB, { number: bought.phone_number, numberSid: bought.sid, serviceSid: svc.sid, numberAt: iso(), numberBy: by });
}

/** Is the text number still pointed here? (read when staff open Send photos) */
export async function textNumberStatus(env) {
  const s = await readSettings(env.DB);
  if (!s.serviceSid) return { set: false };
  try {
    const svc = await tw(env, `${TW_MSG}/Services/${encodeURIComponent(s.serviceSid)}`);
    return { set: true, number: s.number, connected: svc.inbound_request_url === TEXT_WEBHOOK && String(svc.inbound_method).toUpperCase() === 'POST' };
  } catch (e) {
    return { set: true, number: s.number, connected: null, error: e.message };
  }
}

/** For the item rows: where a sent-in file's pictures are */
export const inboxThumb = (row, size = 600) => {
  const extra = parse(row.extra);
  if (row.kind === 'video' && extra.uid) return `https://customer-${STREAM_CODE}.cloudflarestream.com/${extra.uid}/thumbnails/thumbnail.jpg?width=480&height=270&fit=crop`;
  return extra.previews === false ? null : `/api/media-thumb?id=${encodeURIComponent(row.id)}&s=${size}`;
};

// ─── The reply ─────────────────────────────────────────────────────

/**
 * Tell the sender what came in and where it went: only when replies are on (Peter approves the words first) and the
 * sender is on the list. An email by the site's email (Resend), a text from the photos number. → what was sent, or why not
 */
export async function sendReply(env, row, { fetchImpl = fetch } = {}) {
  const settings = await readSettings(env.DB);
  if (!settings.replies) return { sent: false, why: 'Replies are off' };
  if (!row?.sender_ok) return { sent: false, why: 'Not on the list: no reply' };
  let albumName = null;
  if (row.album && row.album !== INBOX_ALBUM) albumName = (await env.DB.prepare('SELECT album_name FROM media_items WHERE album = ? LIMIT 1').bind(row.album).first().catch(() => null))?.album_name || null;
  const body = replyText(row, { albumName });
  let sent = false;
  if (row.channel === 'email') {
    const { sendEmailOne } = await import('./_broadcast-notify.js');
    const r = await sendEmailOne(env, { to: row.from_addr, subject: row.subject ? `Re: ${row.subject}` : 'Your photos are in', text: body, html: `<p>${body.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`, tags: [{ name: 'kind', value: 'media-inbox-reply' }], idempotencyKey: `media-inbox:${row.id}` });
    sent = !!(r.sent || r.already);
  } else if (settings.serviceSid) {
    const res = await fetchImpl(`${TW}/Accounts/${encodeURIComponent(env.TWILIO_ACCOUNT_SID)}/Messages.json`, {
      method: 'POST', headers: { Authorization: twilioAuth(env), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ MessagingServiceSid: settings.serviceSid, To: row.from_addr, Body: body }),
    });
    sent = res.ok;
  }
  if (sent) await env.DB.prepare('UPDATE media_inbox SET reply = ?, replied_at = ? WHERE id = ?').bind(body, iso(), row.id).run();
  return { sent, body };
}
