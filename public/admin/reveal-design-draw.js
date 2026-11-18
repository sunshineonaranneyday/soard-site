/**
 * reveal-design-draw.js — getting a drawing sheet ready to show the public
 * ===========================================================================
 * Used by ./reveal-design-import.js when a drawing comes in from JobTread
 * for a kid's reveal. A sheet carries the family's street address (in the
 * title block, sometimes in a note), so before it leaves the computer:
 *   1. every word of the address the PDF's own text layer has is painted
 *      over in white (findAddress: the street, its number and name, the
 *      city, the zip and the family's name; a word, a line, or letters set
 *      one at a time or spaced out, "M A R I E T T A");
 *   2. so is any phone number or email address (findContact), and the line
 *      the address was on is written back without it, in the sheet's own
 *      letters ("DYLAN 2026: 12 MAPLE LN" → "DYLAN 2026": relabelLines);
 *   3. a sheet whose street was found that way goes up whole, as the designer
 *      drew it (Peter, Nov 16 2026: "is there a way to make this look more like
 *      an official plan set"): its border, its title block with the SOARD logo,
 *      the sheet's name, number and scale, the legend and the notes, with where
 *      the drawing sits on it (drawingFocus) so the page can zoom to it;
 *   4. any other sheet has its title block cut off when there really is one (a
 *      dark rule across the sheet in its bottom fifth, or down its right
 *      third, with writing beyond it; a rule within 5% of the edge is the
 *      sheet's own border, never a title block), and the plain white margin
 *      around what's left trimmed.
 * Only words can be found this way. A drawing whose address wasn't found by
 * its words (a picture, a scanned PDF, a job with no address on file) is
 * left for staff to look over, cover or tick (the import won't add it
 * until they have).
 *
 * Also: which sheet a page is (sheetTitle, kindFromSheet), by its title
 * first: JobTread's sheet name, the sheet's largest words, or a line headed
 * by a sheet number ("A1.0 EXISTING FLOOR PLAN"). Cover sheets, sheet
 * indexes, notes, elevations and trade plans (electrical, plumbing…) are
 * never the reveal's.
 * Pure functions over pixel arrays and pdf.js text items, tested in node
 * (tests/reveal-design-admin.test.mjs).
 */

/** Words and lines compared as plain lowercase words: "731 Juniper Hill Ln," → "731 juniper hill ln" */
export const plainWords = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * The address word this bit of text gives away, or null. words: addressWords()
 * from ./reveal-design.js. A word or phrase whole in the text; a long word the
 * text is one whole word of ("JUNIPER" of "juniper hill"); or, with the
 * spaces taken out, a word of five letters or more ("M A R I E T T A",
 * "7 3 1 J U N I P E R H I L L"), a number only as itself.
 */
export function addressHit(text, words) {
  const t = plainWords(text);
  if (!t) return null;
  const padded = ` ${t} `;
  const flat = t.replace(/ /g, '');
  for (const raw of words || []) {
    const w = plainWords(raw);
    if (!w) continue;
    if (padded.includes(` ${w} `)) return raw;
    if (t.length >= 5 && ` ${w} `.includes(padded)) return raw;
    const fw = w.replace(/ /g, '');
    if (fw.length >= 5 && flat.length > fw.length - 1) {
      let i = flat.indexOf(fw);
      while (i >= 0) {
        if (!/\d/.test(fw) || (!/\d/.test(flat[i - 1] || '') && !/\d/.test(flat[i + fw.length] || ''))) return raw;
        i = flat.indexOf(fw, i + 1);
      }
    }
  }
  return null;
}
export const isAddressText = (text, words) => !!addressHit(text, words);

const mul = (m1, m2) => [
  m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1],
  m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
];

/**
 * A text item on the canvas: where its baseline starts, which way it runs and
 * which way is up (pdf.js items: { str, transform, width, height }; vt: the
 * viewport's transform; scale: the viewport's scale).
 */
export function placeItem(item, vt, scale) {
  const t = mul(vt, item.transform);
  const runLen = Math.hypot(t[0], t[1]) || 1;
  const along = [t[0] / runLen, t[1] / runLen];
  const size = Math.hypot(t[2], t[3]) || Math.abs(item.height || 0) * scale || 1;
  const up = [t[2] / size, t[3] / size];
  const width = Math.abs(item.width || 0) * scale || size * 0.5 * String(item.str || '').length;
  return { x: t[4], y: t[5], along, up, size, width, str: String(item.str || ''), font: String(item.fontName || '') };
}

/** The box to paint over a placed item, a little bigger than the letters: four corners */
export function boxOf(p, pad = 0.3) {
  const [ax, ay] = p.along;
  const [ux, uy] = p.up;
  const back = p.size * pad;
  const below = p.size * (0.25 + pad);
  const above = p.size * (1 + pad);
  const run = p.width + p.size * pad;
  const at = (a, u) => [p.x + ax * a + ux * u, p.y + ay * a + uy * u];
  return [at(-back, -below), at(run, -below), at(run, above), at(-back, above)];
}

const placedOf = (items, vt, scale) => (items || [])
  .filter((it) => it && typeof it.str === 'string' && it.str.trim() && Array.isArray(it.transform))
  .map((it) => placeItem(it, vt, scale));

/**
 * The page's text as lines: items running the same way on the same baseline
 * (within a third of a letter), each starting near where the last ended (a
 * gap of more than three letters starts a new line: two notes side by side
 * aren't one). Each line: its items, its words, its biggest letter size.
 */
export function linesOf(placed) {
  const groups = new Map();
  for (const p of placed) {
    const key = `${Math.round(p.along[0] * 20)},${Math.round(p.along[1] * 20)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const out = [];
  for (const list of groups.values()) {
    const [ax, ay] = list[0].along;
    const across = (p) => p.x * -ay + p.y * ax;
    const run = (p) => p.x * ax + p.y * ay;
    const sorted = [...list].sort((a, b) => across(a) - across(b) || run(a) - run(b));
    const rows = [];
    for (const p of sorted) {
      const row = rows.find((l) => Math.abs(across(l[0]) - across(p)) < Math.max(l[0].size, p.size) / 3);
      if (row) row.push(p); else rows.push([p]);
    }
    for (const row of rows) {
      row.sort((a, b) => run(a) - run(b));
      let part = [row[0]];
      const close = () => { if (part.length) out.push({ items: part, text: part.map((x) => x.str).join(' ').replace(/\s+/g, ' ').trim(), size: Math.max(...part.map((x) => x.size)) }); };
      for (let i = 1; i < row.length; i++) {
        const prev = row[i - 1];
        if (run(row[i]) - (run(prev) + prev.width) > prev.size * 3) { close(); part = []; }
        part.push(row[i]);
      }
      close();
    }
  }
  return out;
}

/**
 * What to paint over, and which address words were found: each item that
 * gives the address away, and every item of a line that does.
 * → { boxes: [[x, y] × 4], hits: Set of the words found }
 */
export function findAddress(items, vt, scale, words) {
  const placed = placedOf(items, vt, scale);
  const hit = new Set();
  const hits = new Set();
  for (const p of placed) { const w = addressHit(p.str, words); if (w) { hit.add(p); hits.add(w); } }
  for (const line of linesOf(placed)) {
    if (line.items.length < 2) continue;
    const w = addressHit(line.text, words);
    if (w) { line.items.forEach((x) => hit.add(x)); hits.add(w); }
  }
  return { boxes: [...hit].map((p) => boxOf(p)), hits };
}
/** The boxes alone (as findAddress) */
export const wipeBoxes = (items, vt, scale, words) => findAddress(items, vt, scale, words).boxes;

// ── What else reaches the family, and the address's line written back ──

// A phone number ("(770) 555-0123", "770.555.0123", "+1 770 555 0123") or an email address: never on a sheet that's shown
const PHONE = /(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\b\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/;
const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
export const isContactText = (s) => PHONE.test(String(s || '')) || EMAIL.test(String(s || ''));

/** The boxes to paint over for phone numbers and email addresses: each item that has one, and every item of a line that does */
export function findContact(items, vt, scale) {
  const placed = placedOf(items, vt, scale);
  const hit = new Set(placed.filter((p) => isContactText(p.str)));
  for (const line of linesOf(placed)) if (line.items.length > 1 && isContactText(line.text)) line.items.forEach((x) => hit.add(x));
  return [...hit].map((p) => boxOf(p));
}

// What an address leaves behind once its words are out: a street type, the state, a unit
const LEFT_BEHIND = /\b(?:ln|lane|st|street|rd|road|dr|drive|ave|avenue|ct|court|way|blvd|boulevard|cir|circle|pl|place|trl|trail|pkwy|parkway|hwy|ter|terrace|apt|unit|ste|suite|ga|georgia|usa)\b\.?|#\s*\d*/gi;
// A line that only said where ("ADDRESS:", "SITE:", "HARTWELL RESIDENCE") says nothing once the address is out
const ONLY_WHERE = /^(?:project\s+|job\s*)?(?:address|site|location|property|lot|jobsite|residence|home|house|client|owner)$/i;
const escapeRe = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s,.]+');

/**
 * A line with its address taken out: "DYLAN 2026: 12 MAPLE LN" → "DYLAN 2026", "ADDRESS: 12 Maple Ln" → "",
 * "HARTWELL RESIDENCE" → "". What's left never gives the address away (spaced-out letters included): if it
 * would, nothing is.
 */
export function restOfLine(text, words) {
  let s = ` ${String(text || '')} `;
  const list = [...(words || [])].map((x) => String(x || '').trim()).filter(Boolean).sort((a, b) => b.length - a.length);
  for (const w of list) s = s.replace(new RegExp(`(^|[^a-z0-9])${escapeRe(w)}(?=[^a-z0-9]|$)`, 'gi'), '$1 ');
  s = s.replace(LEFT_BEHIND, ' ').replace(/\s+/g, ' ');
  // Separators the address was hung on ("2026: ", " - ", ", ,"), at either end or doubled
  s = s.replace(/\s*([:;,|·–—-])\s*(?=[:;,|·–—-]|$)/g, '').replace(/^[\s:;,.|·–—/-]+|[\s:;,|·–—/-]+$/g, '').trim();
  if (!/[a-z0-9]/i.test(s) || ONLY_WHERE.test(s.replace(/[:.]/g, '').trim())) return '';
  return addressHit(s, words) ? '' : s;
}

/**
 * The lines the address was found on, upright ones, with what to write back on each (restOfLine) and where: the
 * line's box, its baseline, its letter size and the PDF's own font for it (pdf.js's loaded name).
 * → [{ text, text0 (the line as it was), x0, x1, y0, y1, baseline, size, font }]
 */
export function relabelLines(items, vt, scale, words) {
  const out = [];
  for (const line of linesOf(placedOf(items, vt, scale))) {
    if (!addressHit(line.text, words) && !line.items.some((p) => addressHit(p.str, words))) continue;
    const [ax, ay] = line.items[0].along;
    if (Math.abs(ax - 1) > 0.02 || Math.abs(ay) > 0.02) continue;
    const text = restOfLine(line.text, words);
    if (!text) continue;
    const corners = line.items.flatMap((p) => boxOf(p));
    const xs = corners.map((c) => c[0]);
    const ys = corners.map((c) => c[1]);
    const first = line.items[0];
    out.push({ text, text0: line.text, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), baseline: first.y, size: line.size, font: first.font });
  }
  return out;
}

/**
 * The part of a line's own letters that stays, as pixels (so it's the sheet's own lettering, whatever its font): the
 * words of rest, found among the line's words by the gaps between them. data: the line's band (RGBA, w × h); text: the
 * line as it was; rest: what stays (restOfLine); size: its letter size. A trailing mark the rest dropped ("2026:" →
 * "2026") is left off when it stands apart, narrow, at the end of its word. → { x0, x1 } (columns, inclusive), or null
 * when the words can't be told apart (the line is then written back in type)
 */
export function keptSpan(data, w, h, text, rest, size) {
  const tokens = String(text || '').trim().split(/\s+/).filter(Boolean);
  const want = String(rest || '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length || !want.length) return null;
  const bare = (t) => t.replace(/[:;,.|·–—-]+$/, '');
  let from = -1;
  for (let i = 0; i + want.length <= tokens.length && from < 0; i++) {
    if (want.every((wd, j) => tokens[i + j] === wd || (j === want.length - 1 && bare(tokens[i + j]) === wd))) from = i;
  }
  if (from < 0) return null;
  const ink = new Uint8Array(w);
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) if (lum(data, (y * w + x) * 4) < 160) { ink[x] = 1; break; }
  const runs = [];
  for (let x = 0; x < w;) {
    if (!ink[x]) { x++; continue; }
    let e = x;
    while (e + 1 < w && ink[e + 1]) e++;
    runs.push([x, e]);
    x = e + 1;
  }
  // The spaces: the line has tokens.length words, so its widest tokens.length - 1 gaps, each wider than any gap left
  // inside a word (a "1" with room either side is still a letter); else the words can't be told apart
  if (runs.length < tokens.length) return null;
  const gaps = runs.slice(1).map((r, i) => ({ i: i + 1, w: r[0] - runs[i][1] - 1 })).sort((a, b) => b.w - a.w);
  const breaks = gaps.slice(0, tokens.length - 1);
  const inside = gaps[tokens.length - 1];
  if (breaks.length && inside && breaks[breaks.length - 1].w <= inside.w) return null;
  if (breaks.some((g) => g.w < Math.max(2, size * 0.15))) return null;
  const cut = new Set(breaks.map((g) => g.i));
  const words = [];
  runs.forEach((r, i) => { if (!i || cut.has(i)) words.push([r]); else words[words.length - 1].push(r); });
  if (words.length !== tokens.length) return null;
  const lastWord = words[from + want.length - 1];
  let x1 = lastWord[lastWord.length - 1][1];
  if (tokens[from + want.length - 1] !== want[want.length - 1]) {
    const tail = lastWord[lastWord.length - 1];
    if (lastWord.length < 2 || tail[1] - tail[0] + 1 > size * 0.4) return null;
    x1 = lastWord[lastWord.length - 2][1];
  }
  return { x0: words[from][0][0], x1 };
}

/**
 * Where a line written back goes across: the middle of the title block's cell it's in (the dark rules either side of
 * it, as tall as the line, within a third of the sheet), else the middle of where it was. → { mid, room }
 */
export function cellOf(data, w, h, l) {
  const y0 = Math.max(0, Math.floor(l.y0)), y1 = Math.min(h - 1, Math.ceil(l.y1));
  const tall = Math.max(1, y1 - y0 + 1);
  const rule = (x) => { let n = 0; for (let y = y0; y <= y1; y++) if (lum(data, (y * w + x) * 4) < 120) n++; return n >= tall * 0.9; };
  const reach = Math.round(w / 3);
  let left = null, right = null;
  for (let x = Math.floor(l.x0) - 1; x >= Math.max(0, Math.floor(l.x0) - reach); x--) if (rule(x)) { left = x; break; }
  for (let x = Math.ceil(l.x1) + 1; x <= Math.min(w - 1, Math.ceil(l.x1) + reach); x++) if (rule(x)) { right = x; break; }
  if (left != null && right != null) return { mid: (left + right) / 2, room: right - left - l.size * 1.2 };
  return { mid: (l.x0 + l.x1) / 2, room: Math.max(l.x1 - l.x0, l.size * 4) };
}

// ── Which sheet a page is ────────────────────────────────────────────

const SHEET_NO = /^\s*[A-Z]{1,2}-?\d{1,3}(?:\.\d{1,2})?[A-Z]?(?=\s|$|[-–:])/;

/**
 * A page's title, as a designer sets it: its largest words (lines whose
 * letters are within a tenth of the biggest on the sheet), and lines headed by
 * a sheet number ("A1.0 EXISTING FLOOR PLAN"). A page with three or more
 * lines headed by sheet numbers is a sheet index (a cover). Address words
 * don't count as a title.
 * → { big: [text], numbered: [text], index: boolean }
 */
export function sheetTitle(items, vt, scale, words = []) {
  const lines = linesOf(placedOf(items, vt, scale)).filter((l) => !addressHit(l.text, words) && /[a-z]{2}/i.test(l.text));
  if (!lines.length) return { big: [], numbered: [], index: false };
  const max = Math.max(...lines.map((l) => l.size));
  const byPlace = (a, b) => (b.items[0].y < a.items[0].y ? 1 : -1);
  const big = lines.filter((l) => l.size >= max * 0.9).sort(byPlace).map((l) => l.text);
  const numberedLines = lines.filter((l) => SHEET_NO.test(l.text) && /[a-z]{3}/i.test(l.text.replace(SHEET_NO, '')));
  return { big, numbered: numberedLines.sort(byPlace).map((l) => l.text), index: numberedLines.length >= 3 };
}

// Sheets that are never the reveal's: covers, contents and indexes, summaries, notes, elevations and sections, trade
// plans, schedules, details. A ceiling PLAN is a trade plan; "CEILING HEIGHT: 8 FT" on a floor plan is only a note
// (Max's set, Nov 10 2026: that note threw out his existing layout)
const NOT_FOR_REVEAL = /\b(cover|title\s+sheet|index|(?:table\s+of\s+)?contents|(?:project\s+)?summary|general|notes?|specifications?|specs|elevations?|sections?|details?|electrical|plumbing|mechanical|hvac|lighting|reflected\s+ceiling|ceiling\s+plan|schedules?|site\s+plan|roof|framing|structural|foundation|door|window|finish\s+schedule)\b/i;
const NAMED_KIND = /\b(existing\s+floor\s+plan|existing\s+plan|as[\s-]?built(?:\s+(?:floor\s+)?plan)?|demolition\s+plan|proposed\s+floor\s+plan|proposed\s+plan|new\s+floor\s+plan|(?:design|mood|inspiration|finish(?:es)?|material|concept|presentation)\s+boards?|renderings?)\b/i;

/**
 * A file that's a document, not a drawing, by its name ("Scope of Work", "Project Summary Letter", a résumé, a
 * countertop template): its pages are never guessed to be the reveal's (they can still be picked by hand). Max's
 * Scope of Work mentions a "demolition plan" in its words, which made it the as-built (Nov 10 2026).
 */
export const isDocumentName = (name) => /\b(scope\s+of\s+work|sow|summary|letter|r[eé]sum[eé]|template|contract|agreement|invoice|estimate|budget|quote|schedule|checklist|w-?9|insurance|coi|permit|warranty|receipt)\b/i.test(String(name || '').replace(/[_.]+/g, ' '));

/**
 * Which kind a page is, by its title first: JobTread's sheet name, then the
 * sheet's largest words, then lines headed by a sheet number; a title that
 * names a sheet the reveal never shows (a cover, notes, elevations,
 * electrical…) settles it as none. Only when no title says either way do the
 * page's other words count, and then only an exact name for a kind
 * ("existing floor plan", "design board"). kindFromText: ./reveal-design.js's.
 * → { kind: 'as-built'|'proposed'|'board'|null, title: the words that said so }
 */
export function kindFromSheet({ sheet = '', title = { big: [], numbered: [], index: false }, body = '' } = {}, kindFromText) {
  const decide = (t) => {
    const s = String(t || '').trim();
    if (!s) return undefined;
    const named = s.match(NAMED_KIND);
    if (named) return { kind: kindFromText(named[0]), title: s };
    if (NOT_FOR_REVEAL.test(s)) return { kind: null, title: s };
    // A title says what it is ("EXISTING CONDITIONS PLAN", "PROPOSED LAYOUT", a designer's "PROPOSED V1"); a stray
    // "existing" in a sentence doesn't
    if (!/\b(plan|layout|board|renderings?|as[\s-]?built)\b/i.test(s) && !/^\s*(proposed|existing)\b/i.test(s)) return undefined;
    const k = kindFromText(s);
    return k ? { kind: k, title: s } : undefined;
  };
  const first = decide(sheet);
  if (first) return first;
  if (title.index) return { kind: null, title: title.big[0] || '' };
  for (const t of [...(title.big || []), ...(title.numbered || [])]) {
    const d = decide(t);
    if (d) return d;
  }
  const named = String(body || '').match(NAMED_KIND);
  return named ? { kind: kindFromText(named[0]), title: named[0] } : { kind: null, title: sheet || title.big?.[0] || '' };
}

// ── The title block and the margin ───────────────────────────────────

const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
const EDGE = 0.05; // within this of the edge, a rule is the sheet's border

/**
 * Where the title block starts, if the sheet has one: { bottom } is the row of
 * its top rule (a dark line across nine tenths of the width in the bottom
 * fifth), { right } the column of its left rule (a dark line down nine tenths
 * of the height in the right third), each with writing beyond it. A rule
 * within 5% of the edge is the sheet's border. data: RGBA pixels, w × h.
 */
export function findTitleBlock(data, w, h) {
  const darkIn = (x0, x1, y0, y1) => {
    let n = 0;
    for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) if (lum(data, (y * w + x) * 4) < 110) n++;
    return n;
  };
  const enough = (area) => Math.max(12, area * 0.0004);
  const [bx0, bx1] = [Math.ceil(w * EDGE), Math.floor(w * (1 - EDGE))];
  const [by0, by1] = [Math.ceil(h * EDGE), Math.floor(h * (1 - EDGE))];
  const rowDark = (y) => { let n = 0; for (let x = 0; x < w; x++) if (lum(data, (y * w + x) * 4) < 110) n++; return n; };
  let bottom = null;
  for (let y = Math.floor(h * 0.8); y < by1 && bottom == null; y++) {
    if (rowDark(y) <= w * 0.9) continue;
    // Writing below it, past the rule's own thickness (and not the border)
    let end = y;
    while (end + 1 < h && rowDark(end + 1) > w * 0.9) end++;
    const from = end + 3;
    const area = (bx1 - bx0) * Math.max(0, by1 - from);
    if (area > 0 && darkIn(bx0, bx1, from, by1) > enough(area)) bottom = y;
    else break;
  }
  const tall = bottom ?? h;
  const colDark = (x) => { let n = 0; for (let y = 0; y < tall; y++) if (lum(data, (y * w + x) * 4) < 110) n++; return n; };
  let right = null;
  for (let x = Math.floor(w * 0.67); x < bx1 && right == null; x++) {
    if (colDark(x) <= tall * 0.9) continue;
    let end = x;
    while (end + 1 < w && colDark(end + 1) > tall * 0.9) end++;
    const from = end + 3;
    const yEnd = Math.min(by1, tall - 4);
    const area = Math.max(0, bx1 - from) * Math.max(0, yEnd - by0);
    if (area > 0 && darkIn(from, bx1, by0, yEnd) > enough(area)) right = x;
    else break;
  }
  return { bottom, right };
}

/** What's on the sheet within a box: the smallest box holding every pixel that isn't near-white, with a little room around it */
export function contentBox(data, w, h, box = { x: 0, y: 0, w, h }, padFrac = 0.02) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) {
      if (lum(data, (y * w + x) * 4) < 235) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { ...box };
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * padFrac);
  const nx = Math.max(box.x, x0 - pad);
  const ny = Math.max(box.y, y0 - pad);
  return { x: nx, y: ny, w: Math.min(box.x + box.w, x1 + pad + 1) - nx, h: Math.min(box.y + box.h, y1 + pad + 1) - ny };
}

/**
 * Inside the sheet's own border: a dark line most of the way across (or down)
 * at the very edge of what's drawn is the frame around the drawing area, not
 * the drawing. The box is taken in past it, on each side that has one.
 */
export function insideBorder(data, w, h, box) {
  const dark = (x, y) => lum(data, (y * w + x) * 4) < 140;
  const rowRun = (y) => { let n = 0; for (let x = box.x; x < box.x + box.w; x++) if (dark(x, y)) n++; return n; };
  const colRun = (x) => { let n = 0; for (let y = box.y; y < box.y + box.h; y++) if (dark(x, y)) n++; return n; };
  const reach = (len) => Math.max(3, Math.round(len * 0.04));
  let { x, y, w: bw, h: bh } = box;
  // From each edge inward: past a line that runs 60% of the side with open paper just inside it (a frame, not the
  // edge of something solid drawn there), and its thickness
  const step = (from, dir, len, run, span) => {
    let at = from, found = -1;
    for (let k = 0; k < reach(len); k++, at += dir) if (run(at) > span * 0.6) found = at;
    if (found < 0) return from;
    let inside = found + dir;
    while (Math.abs(inside - from) < len * 0.5 && run(inside) > span * 0.6) inside += dir;
    return run(inside + dir) < span * 0.25 ? inside + dir : from;
  };
  const top = step(y, 1, bh, rowRun, bw);
  const bottom = step(y + bh - 1, -1, bh, rowRun, bw);
  const left = step(x, 1, bw, colRun, bh);
  const right = step(x + bw - 1, -1, bw, colRun, bh);
  if (bottom - top < bh * 0.3 || right - left < bw * 0.3) return box;
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

/**
 * The drawing itself: the biggest patch of ink on the sheet, with what sits
 * close to it (dimensions, room labels, door swings), leaving out a legend
 * box, a note or a stamp set apart from it. A sheet whose ink is spread over
 * several patches of about the same size (a board of pictures) is kept whole.
 */
export function mainDrawing(data, w, h, box) {
  const cell = Math.max(4, Math.round(Math.min(box.w, box.h) / 90));
  const cols = Math.ceil(box.w / cell), rows = Math.ceil(box.h / cell);
  const ink = new Uint16Array(cols * rows);
  for (let y = box.y; y < box.y + box.h; y++) {
    const r = Math.floor((y - box.y) / cell);
    for (let x = box.x; x < box.x + box.w; x++) if (lum(data, (y * w + x) * 4) < 200) ink[r * cols + Math.floor((x - box.x) / cell)]++;
  }
  const inked = (i) => ink[i] > 0;
  // Close gaps of about 3% of the sheet: a label beside a wall belongs to the plan, a legend in the corner doesn't
  const gap = Math.max(1, Math.round(Math.min(cols, rows) * 0.03));
  const seen = new Int32Array(cols * rows).fill(-1);
  const comps = [];
  for (let i = 0; i < ink.length; i++) {
    if (!inked(i) || seen[i] >= 0) continue;
    const id = comps.length;
    const c = { n: 0, c0: Infinity, r0: Infinity, c1: -1, r1: -1 };
    const stack = [i];
    seen[i] = id;
    while (stack.length) {
      const j = stack.pop();
      const cc = j % cols, rr = (j - cc) / cols;
      c.n += ink[j];
      c.c0 = Math.min(c.c0, cc); c.c1 = Math.max(c.c1, cc); c.r0 = Math.min(c.r0, rr); c.r1 = Math.max(c.r1, rr);
      for (let dr = -gap; dr <= gap; dr++) for (let dc = -gap; dc <= gap; dc++) {
        const r2 = rr + dr, c2 = cc + dc;
        if (r2 < 0 || c2 < 0 || r2 >= rows || c2 >= cols) continue;
        const k = r2 * cols + c2;
        if (inked(k) && seen[k] < 0) { seen[k] = id; stack.push(k); }
      }
    }
    comps.push(c);
  }
  if (!comps.length) return box;
  const total = comps.reduce((a, c) => a + c.n, 0);
  const best = comps.reduce((a, c) => (c.n > a.n ? c : a));
  if (best.n < total * 0.55) return box;
  const pad = Math.round(Math.max(best.c1 - best.c0 + 1, best.r1 - best.r0 + 1) * cell * 0.04);
  const x0 = Math.max(box.x, box.x + best.c0 * cell - pad), y0 = Math.max(box.y, box.y + best.r0 * cell - pad);
  const x1 = Math.min(box.x + box.w, box.x + (best.c1 + 1) * cell + pad), y1 = Math.min(box.y + box.h, box.y + (best.r1 + 1) * cell + pad);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * The part of a sheet to keep: above and left of a real title block, inside
 * the sheet's border, cropped to the drawing itself (so a floor plan fills
 * its frame on the live page instead of sitting small on a white page).
 * titleBlock: one was cut off.
 */
export function keepBox(data, w, h) {
  const { bottom, right } = findTitleBlock(data, w, h);
  const sheet = { x: 0, y: 0, w: right != null ? Math.max(1, right - 2) : w, h: bottom != null ? Math.max(1, bottom - 2) : h };
  const drawn = contentBox(data, w, h, sheet);
  const inner = insideBorder(data, w, h, drawn);
  const main = mainDrawing(data, w, h, inner);
  return { ...contentBox(data, w, h, main), titleBlock: bottom != null || right != null };
}

/** "PROPOSED FLOOR PLAN" → "Proposed floor plan"; "A1.2 - Existing Plan" and "A1.0 EXISTING FLOOR PLAN" lose their sheet numbers */
export function captionOf(sheet) {
  let s = String(sheet || '').replace(/\.(pdf|png|jpe?g|heic)$/i, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/^[A-Z]{0,3}\s?-?\d+(\.\d+)*[A-Z]?\s*[-–:]\s*/i, '').replace(/^[A-Z]{1,2}-?\d{1,3}(?:\.\d{1,2})?[A-Z]?\s+(?=[A-Za-z])/, '')
    // A contents-style number ("2 EXISTING LAYOUT", "3. PROPOSED PLAN")
    .replace(/^\d{1,2}\.?\s+(?=[A-Za-z]{3})/, '');
  if (!s) return '';
  if (s === s.toUpperCase()) s = s.toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Covering by hand ─────────────────────────────────────────────────

/**
 * Boxes drawn by hand, as fractions of the picture ({ x, y, w, h } from 0 to
 * 1), kept inside it and at least a few pixels big; in pixels for a w × h
 * picture.
 */
export function coverRects(boxes, w, h) {
  return (boxes || []).map((b) => {
    const x0 = Math.max(0, Math.min(1, b.x)), y0 = Math.max(0, Math.min(1, b.y));
    const x1 = Math.max(0, Math.min(1, b.x + b.w)), y1 = Math.max(0, Math.min(1, b.y + b.h));
    return { x: Math.floor(Math.min(x0, x1) * w), y: Math.floor(Math.min(y0, y1) * h), w: Math.ceil(Math.abs(x1 - x0) * w), h: Math.ceil(Math.abs(y1 - y0) * h) };
  }).filter((r) => r.w >= 2 && r.h >= 2);
}

// ── Drawing a PDF page (the import here, and the automatic import in Cloudflare's browser) ─────────

const canvasOf = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };

/** White over each address box (four corners each), as findAddress gives them */
export function paintOver(ctx, boxes) {
  ctx.save();
  ctx.fillStyle = '#fff';
  for (const b of boxes) { ctx.beginPath(); ctx.moveTo(b[0][0], b[0][1]); for (let i = 1; i < 4; i++) ctx.lineTo(b[i][0], b[i][1]); ctx.closePath(); ctx.fill(); }
  ctx.restore();
}

/**
 * One pdf.js page drawn at a width (or long edge), with the address painted out wherever its words are.
 * → { canvas, wiped (boxes painted), hits (address words found), textLayer, title, body }
 */
export async function drawPdfPage(page, { width, longEdge, words = [] }) {
  const base = page.getViewport({ scale: 1 });
  const scale = longEdge ? longEdge / Math.max(base.width, base.height) : width / base.width;
  const viewport = page.getViewport({ scale });
  const canvas = canvasOf(viewport.width, viewport.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: !!longEdge });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport, background: '#ffffff' }).promise;
  const content = await page.getTextContent().catch(() => ({ items: [] }));
  const { boxes, hits } = findAddress(content.items, viewport.transform, scale, words);
  const contact = findContact(content.items, viewport.transform, scale);
  // The address's lines, the ink each was written in and its letters as they were, before they're painted out
  const lines = relabelLines(content.items, viewport.transform, scale, words).map((l) => ({ ...l, ink: inkOf(ctx, l), band: bandOf(ctx, l) }));
  paintOver(ctx, boxes);
  paintOver(ctx, contact);
  writeBack(ctx, lines, content.styles || {});
  const textLayer = content.items.some((i) => String(i.str || '').trim());
  const title = sheetTitle(content.items, viewport.transform, scale, words);
  const body = content.items.map((i) => i.str || '').join(' ').replace(/\s+/g, ' ').trim();
  // relabeled: how each address line was written back ('letters': its own, moved; 'typed': in type)
  return { canvas, wiped: boxes.length, hits, textLayer, title, body, contact: contact.length, relabeled: lines.map((l) => l.how) };
}

/** A line's letters as they were: the band from its capitals' tops to its descenders, across its box */
function bandOf(ctx, l) {
  const x = Math.max(0, Math.floor(l.x0)), y = Math.max(0, Math.floor(l.baseline - l.size * 0.95));
  const w = Math.max(1, Math.min(ctx.canvas.width - x, Math.ceil(l.x1 - l.x0)));
  const h = Math.max(1, Math.min(ctx.canvas.height - y, Math.ceil(l.size * 1.25)));
  return { x, y, image: ctx.getImageData(x, y, w, h) };
}

/** The darkest ink inside a line's box (its letters' colour), as a CSS colour; black when there's none */
function inkOf(ctx, l) {
  const x = Math.max(0, Math.floor(l.x0)), y = Math.max(0, Math.floor(l.y0));
  const w = Math.max(1, Math.min(ctx.canvas.width - x, Math.ceil(l.x1 - l.x0))), h = Math.max(1, Math.min(ctx.canvas.height - y, Math.ceil(l.y1 - l.y0)));
  const { data } = ctx.getImageData(x, y, w, h);
  let best = 255 * 3, at = -1;
  for (let i = 0; i < data.length; i += 4) { const v = data[i] + data[i + 1] + data[i + 2]; if (v < best) { best = v; at = i; } }
  return at < 0 || best > 600 ? '#000' : `rgb(${data[at]}, ${data[at + 1]}, ${data[at + 2]})`;
}

/**
 * Each address line written back without the address (relabelLines), in the middle of its cell: its own letters moved
 * there (keptSpan), so it's the sheet's own lettering whatever its font; else typed in the PDF's own font where the
 * browser has it (pdf.js loads a sheet's fonts under their loaded names as it draws), else a plain one, never wider
 * than the cell
 */
function writeBack(ctx, lines, styles) {
  if (!lines.length) return;
  const { data } = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (const l of lines) {
    const { mid: at } = cellOf(data, ctx.canvas.width, ctx.canvas.height, l);
    const b = l.band;
    const keep = b && keptSpan(b.image.data, b.image.width, b.image.height, l.text0, l.text, l.size);
    if (keep) {
      const width = keep.x1 - keep.x0 + 1;
      ctx.putImageData(b.image, Math.round(at - width / 2) - keep.x0, b.y, keep.x0, 0, width, b.image.height);
      l.how = 'letters';
      continue;
    }
    l.how = 'typed';
    const loaded = typeof document !== 'undefined' && l.font && [...(document.fonts || [])].some((f) => f.family === l.font || f.family === `"${l.font}"`);
    const own = loaded ? `"${l.font}", ` : '';
    const family = `${own}${styles[l.font]?.fontFamily && styles[l.font].fontFamily !== 'sans-serif' ? `${styles[l.font].fontFamily}, ` : ''}"Helvetica Neue", Arial, sans-serif`;
    const { mid, room } = cellOf(data, ctx.canvas.width, ctx.canvas.height, l);
    let size = l.size;
    ctx.save();
    ctx.font = `${size}px ${family}`;
    const wide = ctx.measureText(l.text).width;
    if (wide > room && room > 0) { size = Math.max(l.size * 0.6, size * (room / wide)); ctx.font = `${size}px ${family}`; }
    ctx.fillStyle = l.ink || '#000';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(l.text, mid - ctx.measureText(l.text).width / 2, l.baseline);
    ctx.restore();
  }
}

/** Where the drawing sits on a whole sheet, as fractions of it ({ x, y, w, h } from 0 to 1): what the page zooms to */
export function drawingFocus(data, w, h) {
  const b = keepBox(data, w, h);
  const r = (n) => Math.round(n * 10000) / 10000;
  return { x: r(b.x / w), y: r(b.y / h), w: r(b.w / w), h: r(b.h / h) };
}

/**
 * A sheet as it goes up. whole (its street was found by its words and painted out): the whole sheet, as the designer
 * drew it, with where its drawing is (focus). Otherwise a real title block cut off and the white margin trimmed.
 * → { canvas, w, h, trimmed, whole, focus? }
 */
export function finishSheet(canvas, { whole = false } = {}) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  if (whole) return { canvas, w: canvas.width, h: canvas.height, trimmed: false, whole: true, focus: drawingFocus(data, canvas.width, canvas.height) };
  const box = keepBox(data, canvas.width, canvas.height);
  const out = canvasOf(box.w, box.h);
  out.getContext('2d').drawImage(canvas, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  return { canvas: out, w: out.width, h: out.height, trimmed: box.titleBlock, whole: false };
}
