/**
 * Search every photo and video (Admin → Photos & Videos)
 * ===========================================================================
 * Peter, Nov 26 2026: "the search has to be top tier, epic, amazing".
 *
 * One box for everything in the index (./_media-index.js): a kid's or event's
 * name, a year, a stage, a room, a photographer, a folder, a file's name, and
 * what's in the picture (every photo is described for search:
 * ./_media-describe.js). "max after", "2019 bedroom", "girl unicorn",
 * "wheelchair smiling", "gala video", "dewone before drive".
 *
 *   - Words match from their start and by their stem: "smil" and "smiling" find
 *     "smiles"; a few everyday words bring their kin ("bath" finds showers,
 *     "kid" finds girls and boys, "happy" finds smiles).
 *   - Words that are filters act as filters: "video", "photos", "before",
 *     "after", "during", "drive", "jobtread", "youtube", "website", a year.
 *   - A word nothing has is read as its nearest word that something has
 *     ("wheelchiar" → "wheelchair"), and the answer says so.
 *   - Ranking: a word in the album's name counts most, then a title, then what's
 *     in the picture, then folders and file names; the whole phrase together,
 *     a page's own photo and a newer one count a little more.
 *   - Counts by source, kind, stage and year for the filter chips (each
 *     counted with the other filters on, so a chip says what it would show).
 * The people who sign in for Photos & Videos only find only what they may see
 * (visibleSql): a public album's open rows, and a 'check' row the address check
 * passed.
 */

import { norm, getState, ensureMediaIndex } from './_media-index.js';
import { CF_HASH, STREAM_CODE } from '../../public/admin/media-shared.js';
import { inboxThumb } from './_media-inbox.js';

// ─── Reading a query ────────────────────────────────────────────────

/**
 * Everyday words and what else they may mean, one way: "kid" finds girls and boys, "girl" finds girls and daughters
 * (never boys); "happy" finds smiles and laughs
 */
const KIN_MAP = {
  kid: ['child', 'boy', 'girl', 'son', 'daughter', 'teen', 'toddler', 'baby'], kids: ['child', 'boy', 'girl', 'son', 'daughter', 'teen', 'toddler', 'baby'],
  child: ['kid', 'boy', 'girl'], children: ['kid', 'boy', 'girl'],
  girl: ['daughter'], girls: ['daughter'], boy: ['son'], boys: ['son'], daughter: ['girl'], son: ['boy'],
  smile: ['laugh', 'grin', 'happy', 'joy'], smiles: ['laugh', 'grin', 'happy', 'joy'], smiling: ['laugh', 'grin', 'happy', 'joy'], happy: ['smil', 'laugh', 'joy', 'grin'], laugh: ['smil', 'happy'], laughing: ['smil', 'happy'],
  mom: ['mother'], mother: ['mom'], dad: ['father'], father: ['dad'], parents: ['mom', 'dad', 'mother', 'father'], parent: ['mom', 'dad', 'mother', 'father'],
  family: ['mom', 'dad', 'parent', 'sibling', 'brother', 'sister'],
  bath: ['shower', 'tub', 'toilet', 'vanity'], bathroom: ['shower', 'tub', 'toilet', 'vanity'],
  bed: ['bedroom'], therapy: ['sensory', 'swing'], sensory: ['therapy', 'swing'],
  crew: ['team', 'volunteer', 'worker', 'contractor', 'builder'], volunteers: ['crew', 'team'], volunteer: ['crew', 'team'],
  gala: ['fundraiser', 'party'], hug: ['hugging', 'embrac'], hugging: ['hug', 'embrac'], cry: ['tear', 'emotional'], crying: ['tear', 'emotional'], tears: ['cry', 'emotional'],
  ramp: ['lift'], logo: ['logos'], dog: ['puppy'], puppy: ['dog'], mural: ['painting', 'painted'],
};
/** A word's forms to look for: its stem and its kin's, none that another one already covers ("kid" covers "kids") */
export function formsOf(word) {
  const all = [...new Set([stem(word), ...(KIN_MAP[word] || []).map(stem)])].filter((f) => f.length >= 2).map((f) => f.slice(0, 40));
  return all.filter((f) => !all.some((g) => g !== f && f.startsWith(g)));
}
const STAGE_WORDS = { before: 'Before', existing: 'Before', during: 'During', progress: 'During', construction: 'During', demo: 'During', after: 'After', reveal: 'After', reveals: 'After', finished: 'After' };
const KIND_WORDS = { photo: 'photo', photos: 'photo', picture: 'photo', pictures: 'photo', pic: 'photo', pics: 'photo', image: 'photo', images: 'photo', video: 'video', videos: 'video', clip: 'video', clips: 'video', reel: 'video', reels: 'video', film: 'video' };
const SOURCE_WORDS = { website: 'site', site: 'site', drive: 'drive', archive: 'drive', jobtread: 'jobtread', jt: 'jobtread', youtube: 'youtube', stream: 'stream', texted: 'inbox', emailed: 'inbox', inbox: 'inbox' };
const STOP = new Set(['a', 'an', 'the', 'of', 'and', 'in', 'on', 'with', 'for', 'at', 'to', 'from', 'by', 'me', 'show', 'find', 'all', 'any', 'some', 'our', 'is', 's']);

/** A word's stem, for matching from its start: "smiling" → "smil", "showers" → "shower", "families" → "famil" */
export function stem(w) {
  if (w.length <= 4 || /^\d+$/.test(w)) return w;
  let s = w;
  for (const [end, keep] of [['ies', 'i'], ['ing', ''], ['ed', ''], ['es', ''], ['s', '']]) {
    if (s.endsWith(end) && s.length - end.length >= 3) { s = s.slice(0, s.length - end.length) + keep; break; }
  }
  return s.length >= 3 ? s : w;
}

/**
 * The query, read: words to find (each a group of forms any of which may match), and the words that were filters.
 * → { groups: [{ word, forms: [...] }], kind, stage, source, year, phrase }
 */
export function parseQuery(q) {
  const words = norm(q).split(' ').filter(Boolean);
  const out = { groups: [], kind: null, stage: null, source: null, year: null, phrase: norm(q) };
  for (const w of words) {
    if (/^(19|20)\d\d$/.test(w) && !out.year) { out.year = w; continue; }
    if (KIND_WORDS[w] && !out.kind) { out.kind = KIND_WORDS[w]; continue; }
    if (SOURCE_WORDS[w] && !out.source) { out.source = SOURCE_WORDS[w]; continue; }
    if (STAGE_WORDS[w] && !out.stage) { out.stage = STAGE_WORDS[w]; continue; }
    if (STOP.has(w)) continue;
    if (out.groups.length < 8) out.groups.push({ word: w, forms: formsOf(w) });
  }
  return out;
}

// ─── Who may see what ───────────────────────────────────────────────

/**
 * The rows the Photos & Videos sign-in may see: in a public album (a published kid or project, an event not
 * cancelled, a library folder; never a job no page is matched to), open, or 'check' and passed
 */
export const VISIBLE_SQL = `(gate = 'open' OR (gate = 'check' AND check_state = 'ok'))
  AND album NOT LIKE 'jt:%'
  AND (album NOT LIKE 'kid:%' OR substr(album, 5) IN (SELECT slug FROM kids WHERE COALESCE(json_extract(data, '$.publishStatus'), 'published') <> 'draft'))
  AND (album NOT LIKE 'community:%' OR substr(album, 11) IN (SELECT slug FROM community WHERE COALESCE(json_extract(data, '$.publishStatus'), 'published') <> 'draft'))
  AND (album NOT LIKE 'event:%' OR substr(album, 7) IN (SELECT slug FROM events WHERE COALESCE(json_extract(data, '$.status'), '') <> 'cancelled'))`;

// ─── Finding ────────────────────────────────────────────────────────

const yearOf = `substr(COALESCE(taken_at, added_at), 1, 4)`;
/** WHERE for the words and filters; `skip` leaves one filter out (its own chip counts) → { sql, args } */
function whereOf(p, f, { staff, skip = null } = {}) {
  const parts = [];
  const args = [];
  for (const g of p.groups) {
    parts.push(`(${g.forms.map(() => "(' ' || words) LIKE ?").join(' OR ')})`);
    for (const form of g.forms) args.push(`% ${form}%`);
  }
  const kind = f.kind || p.kind;
  const stage = f.stage || p.stage;
  const source = f.source || p.source;
  const year = f.year || p.year;
  if (kind && skip !== 'kind') { parts.push('kind = ?'); args.push(kind); }
  if (stage && skip !== 'stage') { parts.push(stage === 'none' ? 'stage IS NULL' : 'stage = ?'); if (stage !== 'none') args.push(stage); }
  if (source && skip !== 'source') { parts.push('source = ?'); args.push(source); }
  if (year && skip !== 'year') { parts.push(`(${yearOf} = ? OR (' ' || words || ' ') LIKE ?)`); args.push(year, `% ${year} %`); }
  if (f.album) { parts.push('album = ?'); args.push(f.album); }
  if (!staff) parts.push(VISIBLE_SQL);
  return { sql: parts.length ? `WHERE ${parts.join(' AND ')}` : '', args };
}

/** How far apart two words are (letters added, dropped, changed or swapped) */
export function distance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}
/** The nearest word something has, for a word nothing has (vocab: word → how many rows have it) */
export function nearest(word, vocab) {
  if (word.length < 4 || /^\d+$/.test(word)) return null;
  const most = word.length >= 8 ? 2 : 1;
  let best = null;
  for (const [w, n] of Object.entries(vocab || {})) {
    if (Math.abs(w.length - word.length) > most) continue;
    const dist = distance(word, w);
    if (dist <= most && (!best || dist < best.dist || (dist === best.dist && n > best.n))) best = { word: w, dist, n };
  }
  return best?.word || null;
}

let vocabCache = { at: 0, value: null };
async function vocabOf(DB) {
  if (vocabCache.value && Date.now() - vocabCache.at < 10 * 60e3) return vocabCache.value;
  vocabCache = { at: Date.now(), value: (await getState(DB, 'vocab')) || {} };
  return vocabCache.value;
}

/** Every word in the index and how many rows have it, built a slice at a time on quiet turns (the typo fixer's list) */
export async function buildVocab(DB, { slice = 6000, deadline = Date.now() + 10000 } = {}) {
  const st = (await getState(DB, 'vocab-build')) || { offset: 0, counts: {} };
  while (Date.now() < deadline) {
    const r = await DB.prepare('SELECT words FROM media_items ORDER BY id LIMIT ? OFFSET ?').bind(slice, st.offset).all();
    const rows = r.results || [];
    for (const row of rows) for (const w of new Set(String(row.words || '').split(' '))) if (w.length >= 3 && !/^\d+$/.test(w)) st.counts[w] = (st.counts[w] || 0) + 1;
    st.offset += rows.length;
    if (rows.length < slice) {
      const top = Object.entries(st.counts).sort((a, b) => b[1] - a[1]).slice(0, 25000);
      const { setState } = await import('./_media-index.js');
      await setState(DB, 'vocab', Object.fromEntries(top));
      await setState(DB, 'vocab-build', { offset: 0, counts: {}, doneAt: new Date().toISOString() });
      vocabCache = { at: 0, value: null };
      return { done: true, words: top.length };
    }
  }
  const { setState } = await import('./_media-index.js');
  await setState(DB, 'vocab-build', st);
  return { done: false, offset: st.offset };
}

// ─── Ranking ────────────────────────────────────────────────────────

const has = (text, form) => (` ${text} `).includes(` ${form}`);
const exact = (text, w) => (` ${text} `).includes(` ${w} `);
/** A row's score for the query: where each word was found, the phrase together, a page's own photo, a newer one */
export function scoreOf(row, p) {
  let s = 0;
  const album = norm(row.album_name);
  const title = norm(row.title);
  const desc = norm([row.alt, row.description].filter(Boolean).join(' '));
  const place = norm([row.path, row.name].filter(Boolean).join(' '));
  for (const g of p.groups) {
    let best = 0;
    for (const form of g.forms) {
      const own = form === stem(g.word);
      const k = own ? 1 : 0.6;
      if (has(album, form)) best = Math.max(best, (exact(album, g.word) ? 10 : 7) * k);
      if (has(title, form)) best = Math.max(best, (exact(title, g.word) ? 6 : 5) * k);
      if (has(desc, form)) best = Math.max(best, (exact(desc, g.word) ? 4 : 3) * k);
      if (has(place, form)) best = Math.max(best, 2 * k);
      if (!best && has(row.words, form)) best = 1 * k;
    }
    s += best;
  }
  if (p.groups.length > 1 && p.phrase && (` ${norm(row.words)} `).includes(` ${p.groups.map((g) => g.word).join(' ')} `)) s += 6;
  if (row.source === 'site') s += 1;
  if (row.alt) s += 0.5;
  const when = Date.parse(row.taken_at || row.added_at || 0) || 0;
  if (when) s += Math.max(0, 1.5 - (Date.now() - when) / (365 * 864e5) / 4);
  return s;
}

// ─── An item for the page ───────────────────────────────────────────

const youtubeId = (ref) => (String(ref || '').match(/[?&]v=([\w-]{11})/) || [])[1] || '';
/** What the page needs to show and download a row: its thumbnail, its download, and for staff why it's held */
export function itemOut(row, { staff = false } = {}) {
  const ref = String(row.id).slice(String(row.id).indexOf(':') + 1);
  const extra = (() => { try { return JSON.parse(row.extra || '{}') || {}; } catch { return {}; } })();
  const thumb = row.source === 'inbox' ? inboxThumb(row, 600)
    : row.source === 'site' ? `https://imagedelivery.net/${CF_HASH}/${ref}/w=480,h=480,fit=cover,gravity=auto,q=72`
    : row.source === 'stream' ? `https://customer-${STREAM_CODE}.cloudflarestream.com/${ref}/thumbnails/thumbnail.jpg?width=480&height=270&fit=crop`
    : row.source === 'jobtread' ? `${row.ref}?size=512`
    : row.source === 'youtube' ? `https://i.ytimg.com/vi/${youtubeId(row.ref)}/hqdefault.jpg`
    : `/api/media-thumb?id=${encodeURIComponent(row.id)}&s=480`;
  const full = row.source === 'inbox' ? (row.kind === 'photo' && extra.previews !== false ? `/api/media-thumb?id=${encodeURIComponent(row.id)}&s=2000` : null)
    : row.source === 'site' ? `https://imagedelivery.net/${CF_HASH}/${ref}/w=2000,h=2000,fit=scale-down,q=85`
    : row.source === 'jobtread' ? `${row.ref}?size=2048`
    : row.source === 'drive' ? `/api/media-thumb?id=${encodeURIComponent(row.id)}&s=1600` : null;
  const held = row.gate === 'staff' || (row.gate === 'check' && row.check_state !== 'ok');
  return {
    id: row.id, source: row.source, kind: row.kind, album: row.album, albumName: row.album_name, name: row.name, title: row.title,
    stage: row.stage, takenAt: row.taken_at, addedAt: row.added_at, size: row.size, width: row.width, height: row.height, seconds: row.seconds,
    alt: row.alt || null, description: row.description || null, thumb, full,
    uid: row.source === 'stream' ? ref : row.source === 'inbox' ? extra.uid || null : null, url: row.source === 'youtube' ? row.ref : null,
    sender: row.source === 'inbox' ? extra.from || null : null,
    download: row.source === 'youtube' ? null : `/api/media-download?item=${encodeURIComponent(row.id)}`,
    ...(staff ? { held, why: held ? (row.gate === 'check' ? (row.check_state === 'held' ? `The address check held it: ${row.check_why || 'it may show the home'}` : 'Waiting for the address check') : row.why) : null } : {}),
  };
}

const COLS = 'id, source, kind, album, album_name, name, path, stage, taken_at, added_at, size, width, height, seconds, ref, title, alt, description, words, gate, why, check_state, check_why, extra';

/**
 * Search → { total, items, facets: { source, kind, stage, year }, query: { read, corrected } }
 * filters: { kind, stage, source, year, album }, sort: 'best' | 'newest' | 'oldest'
 */
export async function search(DB, q, { filters = {}, sort = 'best', offset = 0, limit = 60, staff = false } = {}) {
  await ensureMediaIndex(DB);
  const p = parseQuery(q);
  const corrected = [];
  // A word nothing has: its nearest word that something has
  if (p.groups.length) {
    const vocab = await vocabOf(DB);
    const words = Object.keys(vocab);
    for (const g of p.groups) {
      // (the word list answers first; only a word it doesn't know is looked for in the index itself)
      if (g.word.length < 4 || words.some((w) => g.forms.some((f) => w.startsWith(f)))) continue;
      const any = await DB.prepare(`SELECT 1 FROM media_items WHERE ${g.forms.map(() => "(' ' || words) LIKE ?").join(' OR ')} LIMIT 1`).bind(...g.forms.map((f) => `% ${f}%`)).first();
      if (any) continue;
      const near = nearest(g.word, vocab);
      if (near) { corrected.push([g.word, near]); g.word = near; g.forms = formsOf(near); }
    }
  }
  const w = whereOf(p, filters, { staff });
  // Every chip's count and the total from one look: grouped by all four; a dimension that's filtered is counted again
  // without its own filter, so its chips say what each would show
  const grouped = async (skip) => {
    const fw = whereOf(p, filters, { staff, skip });
    return (await DB.prepare(`SELECT source, kind, COALESCE(stage, 'none') AS stage, ${yearOf} AS year, COUNT(*) AS n FROM media_items ${fw.sql} GROUP BY source, kind, stage, year`).bind(...fw.args).all()).results || [];
  };
  const base = await grouped(null);
  const total = base.reduce((t, r) => t + r.n, 0);
  // Best match: the matching rows scored here (the newest 3,000 when there are more); newest or oldest: in order from D1
  let items;
  if (sort === 'best' && p.groups.length) {
    const rows = (await DB.prepare(`SELECT ${COLS} FROM media_items ${w.sql} ORDER BY COALESCE(taken_at, added_at) DESC LIMIT 3000`).bind(...w.args).all()).results || [];
    items = rows.map((r) => [scoreOf(r, p), r]).sort((a, b) => b[0] - a[0]).slice(offset, offset + limit).map(([, r]) => r);
  } else {
    const order = sort === 'oldest' ? 'ASC' : 'DESC';
    // (no words: a page's own photos first, then the newest)
    const lead = !p.groups.length && sort === 'best' ? "CASE WHEN source = 'site' AND alt IS NOT NULL THEN 0 ELSE 1 END, " : '';
    items = (await DB.prepare(`SELECT ${COLS} FROM media_items ${w.sql} ORDER BY ${lead}COALESCE(taken_at, added_at) ${order} LIMIT ? OFFSET ?`).bind(...w.args, limit, offset).all()).results || [];
  }
  const active = { kind: filters.kind || p.kind, stage: filters.stage || p.stage, source: filters.source || p.source, year: filters.year || p.year };
  const facet = async (dim) => {
    const rows = active[dim] ? await grouped(dim) : base;
    const by = new Map();
    for (const r of rows) if (r[dim] != null && r[dim] !== '') by.set(String(r[dim]), (by.get(String(r[dim])) || 0) + r.n);
    return [...by].map(([value, n]) => ({ value, n })).sort((a, b) => b.n - a.n);
  };
  const [source, kind, stage, year] = [await facet('source'), await facet('kind'), await facet('stage'), await facet('year')];
  return {
    total,
    items: items.map((r) => itemOut(r, { staff })),
    facets: { source, kind, stage, year: year.sort((a, b) => b.value.localeCompare(a.value)) },
    query: { words: p.groups.map((g) => g.word), kind: p.kind, stage: p.stage, source: p.source, year: p.year, corrected },
  };
}

/** One album's rows from the index (what the page doesn't show itself: the archive, JobTread, the library's others) */
export async function albumItems(DB, album, { staff = false, limit = 5000 } = {}) {
  await ensureMediaIndex(DB);
  const w = whereOf({ groups: [] }, { album }, { staff });
  const rows = (await DB.prepare(`SELECT ${COLS} FROM media_items ${w.sql} ORDER BY COALESCE(taken_at, added_at) DESC LIMIT ?`).bind(...w.args, limit).all()).results || [];
  return rows.map((r) => itemOut(r, { staff }));
}

/** Each album's counts from the index, for the album cards: { album: { photo, video, sources: { drive: n, … }, newest } } */
export async function albumCounts(DB, { staff = false } = {}) {
  await ensureMediaIndex(DB);
  const w = whereOf({ groups: [] }, {}, { staff });
  const r = await DB.prepare(`SELECT album, album_name, source, kind, COUNT(*) AS n, MAX(COALESCE(added_at, taken_at)) AS newest FROM media_items ${w.sql} GROUP BY album, source, kind`).bind(...w.args).all();
  const out = {};
  for (const x of r.results || []) {
    const a = (out[x.album] ||= { name: x.album_name, photo: 0, video: 0, sources: {}, newest: null });
    a[x.kind] += x.n;
    a.sources[x.source] = (a.sources[x.source] || 0) + x.n;
    if (x.newest && (!a.newest || x.newest > a.newest)) a.newest = x.newest;
  }
  return out;
}

/** One row a person may have (a download, a thumbnail): null when it isn't theirs to see */
export async function itemFor(DB, id, { staff = false } = {}) {
  await ensureMediaIndex(DB);
  const w = whereOf({ groups: [] }, {}, { staff });
  const sql = w.sql ? `${w.sql} AND id = ?` : 'WHERE id = ?';
  return DB.prepare(`SELECT ${COLS} FROM media_items ${sql}`).bind(...w.args, id).first();
}
