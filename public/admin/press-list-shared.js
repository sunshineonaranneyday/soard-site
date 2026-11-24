/**
 * The media advisory's press list, as people paste it: one address or many, a column from a sheet, or a whole
 * To line copied from an email, where a name can hold a comma ("Ross, Kaitlyn <k@example.com>"). No DOM: the
 * admin (./reveal-press.js) and the server (functions/api/_reveal-press.js) read a paste the same way.
 */

const BARE = /[^\s<>,;:"()[\]]+@[^\s<>,;:"()[\]]+\.[a-z]{2,}/gi;
export const isEmail = (e) => /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(String(e || ''));

/** Text or a list → [{ email, name }]: lower-case addresses, each once, in the order given */
export function parseList(input) {
  const out = [];
  const seen = new Set();
  const add = (email, name = '') => {
    const e = String(email || '').trim().toLowerCase().replace(/^mailto:/, '');
    if (!isEmail(e) || seen.has(e)) return;
    seen.add(e);
    out.push({ email: e, name: String(name || '').replace(/["<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) });
  };
  if (Array.isArray(input)) {
    for (const x of input) (typeof x === 'string' ? parseList(x) : [x]).forEach((p) => add(p?.email, p?.name));
    return out;
  }
  const text = String(input || '');
  let last = 0;
  // Each "<address>" takes the words before it as its name, back to the address before it
  for (const m of text.matchAll(/<\s*([^<>\s]+@[^<>\s]+)\s*>/g)) {
    const gap = text.slice(last, m.index);
    const bare = [...gap.matchAll(BARE)];
    bare.forEach((b) => add(b[0]));
    const tail = bare.length ? gap.slice(bare.at(-1).index + bare.at(-1)[0].length) : gap;
    add(m[1], tail.replace(/^[\s,;]+|[\s,;]+$/g, '').replace(/^"(.*)"$/s, '$1'));
    last = m.index + m[0].length;
  }
  for (const b of text.slice(last).matchAll(BARE)) add(b[0]);
  return out;
}
