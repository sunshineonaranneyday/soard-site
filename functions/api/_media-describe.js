/**
 * Every photo described for search, and every Before photo checked for an address
 * ===========================================================================
 * Peter, Nov 26 2026: "the search has to be top tier, epic, amazing", and of
 * the social media sign-in, before photos only after the website's address
 * check (option 1).
 *
 * Each photo in the index (./_media-index.js) without words of its own (a
 * website photo with alt text has them already) is looked at once by Workers
 * AI's vision model, the one that screens the website's before photos
 * (./_photo-screen.js), through the site's AI Gateway as 'media-describe'
 * (./_ai.js): a plain sentence of what's in it and a few one-word tags, so
 * "girl in a unicorn bedroom" or "dad hugging" finds it. Names are never asked
 * for or written.
 *
 * A photo whose gate is 'check' (a Before or unsorted photo from the Drive
 * archive or JobTread) also gets the address check, the same questions, the
 * same rules (judgePhoto): it opens to the Photos & Videos sign-in only when
 * it passes, and staff see why when it doesn't.
 *
 * The picture the model sees is small: Cloudflare Images' own resize for a
 * website image, Drive's thumbnail, JobTread's sized copy. Nothing is kept but
 * the words. A turn does what fits in its time, the photos most likely to be
 * wanted first (website photos without alt text, then the archive's Before
 * photos waiting on the check, then After); a photo the model can't read is
 * tried three times in all. A spending cap reached stops the turn.
 */

import { SCREEN_MODEL, screenPhoto, AiDown, Refused } from './_photo-screen.js';
import { viaGateway, aiCapped } from './_ai.js';
import { answerOf } from './_vendor-read.js';
import { driveToken } from './_past-photos.js';
import { norm, ensureMediaIndex } from './_media-index.js';
import { CF_HASH } from '../../public/admin/media-shared.js';

const iso = (t = Date.now()) => new Date(t).toISOString();
const MAX_TRIES = 3;
const AT_ONCE = 4;
const AI_TIMEOUT_MS = 15_000;

export const DESCRIBE_PROMPT = `You describe photos for a children's charity's photo library search. The charity makes over bedrooms, bathrooms and therapy rooms for children with serious illness or disabilities.
Write one plain sentence of at most 30 words saying what is in the photo: who (a child, a girl, a boy, a family, a mom, a crew, volunteers; never a name), the room or place, and what stands out (colors, a theme, furniture, a wheelchair, a ramp, a swing, a mural, smiles, a hug, a ribbon cutting).
Then up to 8 single lowercase words as tags. Say only what you can see.`;
const SCHEMA = {
  name: 'photo_description',
  schema: {
    type: 'object',
    properties: {
      description: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
    },
    required: ['description', 'tags'],
  },
};

const toBase64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
function withTimeout(p, ms) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new AiDown('Workers AI took too long')), ms); })]).finally(() => clearTimeout(t));
}

/** The small picture the model sees: { bytes, type } */
export async function pictureOf(env, row, { fetchImpl = fetch, now = Date.now() } = {}) {
  const [, ...rest] = String(row.id).split(':');
  const ref = rest.join(':');
  let res;
  if (row.source === 'inbox') {
    const pic = await env.MEDIA_FILES?.get(`previews/${ref}/2000.jpg`);
    if (!pic) throw new Error('its copy isn’t made yet');
    return { bytes: new Uint8Array(await pic.arrayBuffer()), type: 'image/jpeg' };
  }
  if (row.source === 'site') {
    res = await fetchImpl(`https://imagedelivery.net/${CF_HASH}/${ref}/w=768,h=768,fit=scale-down,quality=80,format=jpeg`, { signal: AbortSignal.timeout(15000) });
  } else if (row.source === 'jobtread') {
    res = await fetchImpl(`${row.ref}?size=1024`, { signal: AbortSignal.timeout(15000) });
  } else if (row.source === 'drive') {
    const token = await driveToken(env, { fetchImpl, now });
    const meta = await fetchImpl(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(ref)}?supportsAllDrives=true&fields=thumbnailLink`, { headers: { Authorization: `Bearer ${token}` } });
    const link = meta.ok ? (await meta.json()).thumbnailLink : null;
    if (!link) throw new Error('Drive has no picture of it yet');
    res = await fetchImpl(link.replace(/=s\d+(-c)?$/, '=s768'), { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
  } else {
    throw new Error(`no picture for ${row.source}`);
  }
  if (!res.ok) throw new Error(`the picture answered ${res.status}`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), type: (res.headers.get('content-type') || 'image/jpeg').split(';')[0] };
}

/** One photo described → { description, tags } or null (the model said nothing that reads) */
export async function describePicture(env, pic) {
  if (!env.AI) throw new AiDown('Workers AI isn’t bound (AI)', { wide: true });
  const messages = [
    { role: 'system', content: DESCRIBE_PROMPT },
    { role: 'user', content: [
      { type: 'text', text: 'Describe this photo.' },
      { type: 'image_url', image_url: { url: `data:${pic.type};base64,${toBase64(pic.bytes)}` } },
    ] },
  ];
  for (const json of [true, false]) {
    try {
      const out = await withTimeout(env.AI.run(SCREEN_MODEL, { messages, max_tokens: 160, temperature: 0, ...(json ? { response_format: { type: 'json_schema', json_schema: SCHEMA } } : {}) }, viaGateway('media-describe')), AI_TIMEOUT_MS);
      const a = answerOf(out);
      const description = String(a?.description || '').replace(/\s+/g, ' ').trim().slice(0, 300);
      if (description) return { description, tags: (Array.isArray(a.tags) ? a.tags : []).map((t) => norm(t)).filter((t) => t && t.length < 24).slice(0, 8) };
    } catch (e) {
      if (aiCapped(e) || e instanceof AiDown) throw e;
      if (!json) throw new Refused(String(e.message || e).slice(0, 160));
    }
  }
  return null;
}

/** The photos that still need words or the check, most wanted first */
export async function todo(DB, limit) {
  const r = await DB.prepare(`SELECT id, source, kind, gate, ref, base, description, tags, described_at, check_state, tries FROM media_items
    WHERE kind = 'photo' AND tries < ? AND (described_at IS NULL OR (gate = 'check' AND check_state IS NULL))
    ORDER BY prio, added_at DESC LIMIT ?`).bind(MAX_TRIES, limit).all();
  return r.results || [];
}

/** One photo: described (and checked when its gate asks) → what was written */
export async function describeOne(env, row, { fetchImpl = fetch, now = Date.now() } = {}) {
  const { DB } = env;
  let pic;
  try { pic = await pictureOf(env, row, { fetchImpl, now }); } catch (e) {
    await DB.prepare('UPDATE media_items SET tries = tries + 1, check_why = COALESCE(check_why, ?) WHERE id = ?').bind(`Couldn’t get the picture: ${String(e.message).slice(0, 120)}`, row.id).run();
    return { id: row.id, error: e.message };
  }
  const set = {};
  if (!row.described_at) {
    const d = await describePicture(env, pic);
    // (the sentence is what people see and copy; the tags only help find it)
    if (d) { set.description = d.description; set.tags = d.tags.join(' '); set.described_at = iso(now); }
  }
  if (row.gate === 'check' && !row.check_state) {
    const j = await screenPhoto(env, pic);
    if (j) { set.check_state = j.show ? 'ok' : 'held'; set.check_why = j.show ? null : j.why; set.checked_at = iso(now); }
  }
  if (!Object.keys(set).length) {
    await DB.prepare('UPDATE media_items SET tries = tries + 1 WHERE id = ?').bind(row.id).run();
    return { id: row.id, error: 'nothing read' };
  }
  const description = set.description ?? row.description;
  const words = [row.base, norm(description || ''), set.tags ?? row.tags ?? ''].filter(Boolean).join(' ');
  const cols = Object.keys(set);
  await DB.prepare(`UPDATE media_items SET ${cols.map((c) => `${c} = ?`).join(', ')}, words = ? WHERE id = ?`).bind(...cols.map((c) => set[c]), words, row.id).run();
  return { id: row.id, ...set };
}

/** The heartbeat's describing, inside the turn's time → { described, checked, held, errors, stopped } */
export async function describeSome(env, { fetchImpl = fetch, deadline = Date.now() + 20000, now = Date.now() } = {}) {
  const { DB } = env;
  if (!DB || !env.AI) return null;
  await ensureMediaIndex(DB);
  const out = { described: 0, checked: 0, held: 0, errors: 0, stopped: null };
  let rows = await todo(DB, 24);
  while (rows.length && Date.now() < deadline - AI_TIMEOUT_MS) {
    const batch = rows.splice(0, AT_ONCE);
    const results = await Promise.allSettled(batch.map((r) => describeOne(env, r, { fetchImpl, now })));
    for (const r of results) {
      if (r.status === 'rejected') {
        const e = r.reason;
        if (aiCapped(e)) { out.stopped = 'Workers AI’s spending cap'; return out; }
        if (e instanceof AiDown) { out.stopped = 'Workers AI isn’t answering'; return out; }
        out.errors++;
        continue;
      }
      const v = r.value;
      if (v.error) out.errors++;
      if (v.described_at) out.described++;
      if (v.check_state) { out.checked++; if (v.check_state === 'held') out.held++; }
    }
    // Refused ones were counted against their photo by describeOne's caller: mark them so they're not asked forever
    for (const [i, r] of results.entries()) if (r.status === 'rejected' && r.reason instanceof Refused) await DB.prepare('UPDATE media_items SET tries = tries + 1 WHERE id = ?').bind(batch[i].id).run();
    if (!rows.length && Date.now() < deadline - AI_TIMEOUT_MS) rows = await todo(DB, 24);
  }
  return out;
}
