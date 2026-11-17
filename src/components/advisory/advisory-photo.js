/**
 * The Advisory Board application's headshot (its 'photo' question), on /advisory-board/apply/.
 *
 * A photo picked (or dragged in) is drawn afresh as an upright JPEG at most 2400 px across
 * (src/utils/photo-prep.ts: an iPhone photo too, in any browser), checked against the size the
 * site needs (functions/api/_advisory-form.js headshotProblem, the server's own rule), shown in
 * the circle, and kept on this device in IndexedDB beside the answers in localStorage, so a
 * closed tab costs nothing. Nothing leaves the device until Send, which sends that JPEG.
 *
 *   photoField(fieldEl, { id, onChange, signal }) → {
 *     value      'added' or '' (its answer for the form's checks)
 *     file       the JPEG to send, or null
 *     url        its picture on this page (for the review), or ''
 *     loaded     a promise: what this device kept, brought back
 *     settled()  a promise: done getting a picked photo ready
 *     load()     bring back what's kept (another tab changed it)
 *     clear()    no photo, and none kept
 *   }
 * The note for a photo that won't do: under the question (the form's own note, and heard through
 * the page's announcer) while there's no photo; in its status line, a live region ("Your earlier
 * headshot is still here"), when one was there already. A wide photo keeps at least 1200 px on its
 * short side, so the 440 px least is judged on what it really is, not on a shrunken copy.
 */
import { photoAsJpeg } from '../../utils/photo-prep';
import { headshotProblem, HEADSHOT_MIN, HEADSHOT_GOOD, HEADSHOT_CUT, HEADSHOT_NOT_PHOTO, HEADSHOT_MAX_BYTES } from '../../../functions/api/_advisory-form.js';

const DB_NAME = 'soard-advisory';
const STORE = 'photos';
/** localStorage: when a photo was last changed here, so another tab brings it in */
export const PHOTO_PING = 'soard-advisory-photo';
const MAX_PICK = 25 * 1024 * 1024; // the makeover application's own limit for a photo
// How it's drawn: a wide photo keeps its short side up to People's sharp size, so it isn't shrunk too small; within
// what Cloudflare Images takes (12,000 px a side, 10 MB: a little under, for the form's other parts sent with it)
const DRAW = { keepShort: HEADSHOT_GOOD, maxLong: 12_000, maxBytes: HEADSHOT_MAX_BYTES - 512 * 1024 };
const WHY = {
  'not-photo': HEADSHOT_NOT_PHOTO,
  cut: HEADSHOT_CUT,
  converter: 'This photo couldn’t be opened just now: the part of the page that reads phone photos (HEIC) didn’t load. Check your connection, reload the page (your answers are kept), and choose it again.',
  unreadable: 'That photo couldn’t be read just now (it may have changed or moved while it was being opened). Please choose it again.',
};

/**
 * One IndexedDB request in its own transaction → its result; null when the browser keeps nothing (private mode,
 * blocked), or doesn't answer in a few seconds (a browser whose IndexedDB hangs): then this page stops asking it, and
 * says the photo can't be kept, never a form waiting on it for good
 */
const IDB_WAIT_MS = 4000;
let idbHung = false;
// (once one request has gone unanswered, every other still waiting stops at the same moment, not seconds later)
let hungNow;
const hung = new Promise((resolve) => { hungNow = () => resolve(null); });
function idb(mode, run) {
  if (idbHung) return Promise.resolve(null);
  let timer;
  const gaveUp = new Promise((resolve) => { timer = setTimeout(() => { idbHung = true; hungNow(); resolve(null); }, IDB_WAIT_MS); });
  return Promise.race([idbNow(mode, run), gaveUp, hung]).finally(() => clearTimeout(timer));
}
function idbNow(mode, run) {
  return new Promise((resolve) => {
    let open;
    try { open = indexedDB.open(DB_NAME, 1); } catch { resolve(null); return; }
    open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE); };
    open.onerror = () => resolve(null);
    open.onblocked = () => resolve(null);
    open.onsuccess = () => {
      const db = open.result;
      try {
        const tx = db.transaction(STORE, mode);
        const req = run(tx.objectStore(STORE));
        tx.oncomplete = () => { db.close(); resolve(req?.result ?? null); };
        tx.onerror = tx.onabort = () => { db.close(); resolve(null); };
      } catch { db.close(); resolve(null); }
    };
  });
}
export const photoStore = {
  get: (key) => idb('readonly', (s) => s.get(key)),
  put: (key, value) => idb('readwrite', (s) => s.put(value, key)),
  del: (key) => idb('readwrite', (s) => s.delete(key)),
};
const ping = () => { try { localStorage.setItem(PHOTO_PING, String(Date.now())); } catch { /* storage off */ } };
// Each pick on this device numbered one after the last: which photo is newer never depends on the device's clock
// (one put right since an earlier pick would make the newer one look older)
const SEQ = 'soard-advisory-photo-seq';
function nextSeq(atLeast = 0) {
  let n = 0;
  try { n = Number(localStorage.getItem(SEQ)) || 0; } catch { /* storage off */ }
  n = Math.max(n, atLeast) + 1;
  try { localStorage.setItem(SEQ, String(n)); } catch { /* storage off */ }
  return n;
}

export function photoField(el, { id, onChange = () => {}, announce = () => {}, signal } = {}) {
  const box = el.querySelector('[data-photo]');
  const input = el.querySelector('input[type="file"]');
  const img = box.querySelector('.adv-photo-img');
  const spin = box.querySelector('.adv-photo-spin');
  const pickText = el.querySelector('[data-photo-pick]');
  const remove = el.querySelector('[data-photo-remove]');
  const status = el.querySelector('[data-photo-status]');
  const err = el.querySelector('.adv-error');
  let held = null; // { file, width, height, sourceWidth, sourceHeight, pickedAt, seq, url }
  let busy = null; // a picked photo being got ready
  // (anyone waiting on the picks is woken each time the one in flight changes: a newer pick, done, refused, taken off)
  const busyWaiters = [];
  function setBusy(next) { busy = next; for (const r of busyWaiters.splice(0)) r(); }
  // A pick (or the photo taken off) since the page opened: what's here is known without this device's answer about
  // the photo it kept, which would be set aside anyway (load: a photo picked meanwhile wins)
  let pickedNow;
  const pickedHere = new Promise((resolve) => { pickedNow = resolve; });
  let gen = 0; // the latest pick (an earlier one still drawing is dropped)
  let kept = true; // whether this device could keep the photo (IndexedDB)
  let saving = 0; // a picked photo being kept on this device right now

  /** The status line (a live region: heard as it changes) */
  function say(words, { warn = false } = {}) {
    status.textContent = words || '';
    status.dataset.kind = warn ? 'warn' : '';
  }
  // A note just said about a pick (refused, added, a little soft): brought into sight if it's behind Back / Continue
  // (on a phone the screen was laid out for the empty card), just far enough, as Send's own note is
  function reveal() {
    const check = () => {
      const note = !err.hidden && err.textContent ? err : status;
      if (!note.textContent || !note.getClientRects().length) return;
      const bar = el.closest('form')?.querySelector('.adv-nav')?.getBoundingClientRect().top ?? innerHeight;
      const over = note.getBoundingClientRect().bottom - Math.min(bar, innerHeight) + 12;
      if (over > 0) window.scrollBy({ top: over, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    };
    // (now, and again once the note's look has settled: with reduced motion its padding and weight come a moment late)
    requestAnimationFrame(check);
    setTimeout(() => requestAnimationFrame(check), 180);
  }
  function paint() {
    box.dataset.state = busy ? 'busy' : held ? 'done' : 'empty';
    img.hidden = !held;
    if (held && img.getAttribute('src') !== held.url) img.src = held.url;
    if (!held) img.removeAttribute('src');
    spin.hidden = !busy;
    pickText.textContent = held ? 'Choose a different photo' : 'Choose a photo';
    remove.hidden = !held;
    remove.style.visibility = busy ? 'hidden' : ''; // (kept in its place while a new one is got ready: nothing jumps)
  }
  const addedNote = () => (held ? `${addedWords(held)}${kept ? '' : ' This browser can’t keep it if the page closes, so send your application before you leave.'}` : '');
  /** The form's own note under the question, for a photo that won't do while there's none */
  function problem(words) {
    el.classList.add('is-invalid');
    err.textContent = words;
    err.hidden = false;
    err.dataset.pick = '1';
    input.setAttribute('aria-invalid', 'true');
  }
  function unproblem() {
    if (!err.dataset.pick && !held) return; // the form's "Please add a headshot" stays until there's a photo
    delete err.dataset.pick;
    el.classList.remove('is-invalid');
    err.textContent = '';
    err.hidden = true;
    input.removeAttribute('aria-invalid');
  }
  // Soft: judged on what goes up (a very wide photo is drawn smaller to fit), its own size said when that's what it is
  // Soft: the site uses the square around their face, as big as the photo's short side. The advice fits the photo:
  // drawn smaller to fit (very wide or tall), a photo closer to square; a wide or tall one, a closer photo of their
  // face; else a larger one
  const addedWords = (h) => {
    if (Math.min(h.width, h.height) >= HEADSHOT_GOOD) return 'Added.';
    const sw = h.sourceWidth || h.width;
    const sh = h.sourceHeight || h.height;
    if (h.width !== sw || h.height !== sh) return `Added. It’s so ${sw > sh ? 'wide' : 'tall'} it may look a little soft on our website. A photo closer to square is better if you have it.`;
    if (Math.max(sw, sh) / Math.min(sw, sh) > 2) return `Added. It’s ${sw} × ${sh} pixels, so the square we use around your face may look a little soft on our website. A closer photo of your face is better if you have it.`;
    return `Added. It’s ${h.width} × ${h.height} pixels, so it may look a little soft on our website. A larger one is better if you have it.`;
  };
  function setHeld(next) {
    if (held?.url) URL.revokeObjectURL(held.url);
    held = next ? { ...next, url: URL.createObjectURL(next.file) } : null;
  }

  async function take(file) {
    if (!file) return;
    const my = ++gen;
    pickedNow();
    const hadOne = !!held;
    const wont = (words) => {
      setBusy(null); // (an earlier pick still being got ready is dropped with this one: never left spinning)
      if (hadOne) say(`${words} Your earlier headshot is still here.`, { warn: true });
      else { say(''); problem(words); announce(words); } // (the note under it isn't a live region: heard here)
      paint();
      onChange({ problem: true });
      reveal();
    };
    if (!file.size) { wont('That file is empty, or couldn’t be read. Please choose it again, or another photo.'); return; }
    if (file.size > MAX_PICK) { wont('That photo is too large. Please choose one under 25 MB.'); return; }
    setBusy(photoAsJpeg(file, DRAW));
    say('Getting your photo ready…');
    paint();
    // An iPhone photo can take a few seconds in a browser that isn't Safari: said, so nobody thinks it's stuck
    const slow = setTimeout(() => { if (my === gen && busy) say('Still getting your photo ready. A large or iPhone photo can take a few seconds.'); }, 3500);
    let got = null;
    try { got = await busy; } catch { got = { error: 'not-photo' }; } finally { clearTimeout(slow); }
    if (my !== gen) return; // a newer pick is being got ready
    setBusy(null);
    if (!got?.photo) { wont(WHY[got?.error] || WHY['not-photo']); return; }
    const drawn = got.photo;
    // Judged on what it really is: too small, or (drawn within Cloudflare's limits) too wide and narrow to use
    const real = { width: drawn.sourceWidth || drawn.width, height: drawn.sourceHeight || drawn.height };
    const small = headshotProblem(real)
      || (Math.min(drawn.width, drawn.height) < HEADSHOT_MIN ? `This photo is too wide and narrow to use as a headshot (${real.width} × ${real.height} pixels). Please choose one closer to square.` : null);
    if (small) { wont(small); return; }
    const pickedAt = Date.now();
    const seq = nextSeq(held?.seq || 0);
    setHeld({ file: drawn.file, width: drawn.width, height: drawn.height, sourceWidth: real.width, sourceHeight: real.height, pickedAt, seq });
    // Added at once; kept on the device meanwhile (a slow IndexedDB never holds the note up). While it's being kept,
    // another tab's word never puts the photo it's replacing back (load waits)
    kept = true;
    unproblem();
    say(addedNote());
    announce(''); // (an earlier refusal said there isn't left for a screen reader: this note says it's added)
    paint();
    onChange({});
    reveal();
    saving++;
    try {
      kept = !!(await photoStore.put(id, { blob: drawn.file, name: drawn.file.name, width: drawn.width, height: drawn.height, sourceWidth: real.width, sourceHeight: real.height, at: pickedAt, seq }));
    } finally { saving--; }
    if (my !== gen) return;
    if (!kept) { say(addedNote()); onChange({}); reveal(); } // (this browser couldn't keep it: said)
    else onChange({ kept: true }); // (kept: the overview, if it's showing, says so now)
    ping();
  }

  async function load() {
    if (saving) return; // (a pick being kept: its own word to the other tabs follows)
    const my = gen;
    const stored = await photoStore.get(id);
    if (busy || saving || my !== gen) return; // a photo picked (or cleared) meanwhile wins
    const blob = stored?.blob;
    if (blob && blob.size && stored.width && stored.height) {
      if (held && held.width === stored.width && held.height === stored.height && held.file.size === blob.size) return;
      const file = blob instanceof File ? blob : new File([blob], stored.name || 'headshot.jpg', { type: blob.type || 'image/jpeg' });
      kept = true;
      setHeld({ file, width: stored.width, height: stored.height, sourceWidth: stored.sourceWidth || stored.width, sourceHeight: stored.sourceHeight || stored.height, pickedAt: Number(stored.at) || 0, seq: Number(stored.seq) || 0 });
      unproblem();
      say(addedNote());
    } else {
      if (!held) return;
      setHeld(null);
      say('');
    }
    paint();
    onChange({ silent: true });
  }

  async function clear({ keep = false } = {}) {
    gen++;
    pickedNow();
    setBusy(null);
    setHeld(null);
    delete err.dataset.pick;
    say('');
    paint();
    if (!keep) { await photoStore.del(id); ping(); }
  }

  // The circle is a way in too (on a phone it's what people tap first)
  box.querySelector('.adv-photo-frame')?.addEventListener('click', () => input.click(), { signal });
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    input.value = ''; // the same file picked again still counts
    take(f);
  }, { signal });
  remove.addEventListener('click', async () => {
    await clear();
    say('Photo removed.');
    onChange({});
    input.focus();
  }, { signal });
  // Dragged in on a computer: the whole card takes it. Dropped anywhere else on the page (just missing the card), it's
  // nothing: never the browser opening the photo in place of the application
  let depth = 0;
  const has = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  const onCard = (e) => box.contains(e.target);
  window.addEventListener('dragover', (e) => {
    if (!has(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = onCard(e) && !box.closest('[data-off], [hidden]') ? 'copy' : 'none';
  }, { signal });
  window.addEventListener('drop', (e) => {
    if (!has(e)) return;
    e.preventDefault();
    depth = 0;
    box.classList.remove('is-over');
    if (onCard(e)) take(e.dataTransfer.files?.[0]); // (a photo still being got ready gives way to this one)
  }, { signal });
  box.addEventListener('dragenter', (e) => { if (!has(e)) return; depth++; box.classList.add('is-over'); }, { signal });
  box.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) box.classList.remove('is-over'); }, { signal });
  signal?.addEventListener('abort', () => { if (held?.url) URL.revokeObjectURL(held.url); });

  paint();
  let loadedYet = false;
  // (no photo ever picked on this device, its numbering never started: nothing kept to look for, so a browser whose
  // IndexedDB hangs never makes anyone wait on it)
  const pickedHereEver = (() => { try { return localStorage.getItem(SEQ) !== null; } catch { return true; } })();
  const loaded = (pickedHereEver ? load() : Promise.resolve()).finally(() => { loadedYet = true; });
  return {
    get value() { return held ? 'added' : ''; },
    get file() { return held?.file || null; },
    get url() { return held?.url || ''; },
    /** When this photo was picked (the server keeps the newest when one application is sent twice) */
    get pickedAt() { return held?.pickedAt || 0; },
    /** Whether this device could keep it (IndexedDB): the overview says so when it can't */
    get kept() { return kept; },
    /** This device's number for the pick (newer is higher, whatever its clock says) */
    get pickedSeq() { return held?.seq || 0; },
    /** Settled since the page opened (what this device kept, brought back) */
    get isLoaded() { return loadedYet; },
    /** A picked photo being got ready right now (not what this device kept, being looked for) */
    get preparing() { return !!busy; },
    /** A picked photo being kept on this device right now (whether it can be isn't known yet) */
    get keeping() { return saving > 0; },
    /** The status line's words off (the form's own note now says what's needed) */
    quiet() { if (!busy) say(''); },
    /** Leaving the step: a warning about a photo turned down there goes (an added photo's note stays) */
    leave() { if (!busy && status.dataset.kind === 'warn') say(held ? addedNote() : ''); },
    loaded,
    /** What's here is known: what this device kept, brought back, or a pick made since (which wins over it) */
    known: Promise.race([loaded, pickedHere]),
    /** Every pick settled, one made while waiting included (never the earlier one it replaced) */
    async settled() { while (busy) await new Promise((resolve) => { busyWaiters.push(resolve); }); },
    load,
    clear,
    /** The server turned this photo down (its own check, after the page's): taken off, so another is chosen */
    // (the server's reason then shows under it, and stays: it's this photo's own, never "Please add a headshot.")
    async refuse() { await clear(); err.dataset.pick = '1'; paint(); },
    /**
     * Its height at its tallest (a photo in, with the longest note it can have): the step is split into screens by
     * this, so a photo going in never splits it again (Back and Forward would land on other screens)
     */
    tallest() {
      const now = el.getBoundingClientRect().height;
      const was = { state: box.dataset.state, text: status.textContent, kind: status.dataset.kind, img: img.hidden, rm: remove.hidden, pick: pickText.textContent };
      box.dataset.state = 'done'; img.hidden = false; remove.hidden = false; pickText.textContent = 'Choose a different photo';
      status.dataset.kind = '';
      status.textContent = 'Added. It’s 99999 × 99999 pixels, so the square we use around your face may look a little soft on our website. A closer photo of your face is better if you have it. This browser can’t keep it if the page closes, so send your application before you leave.';
      const then = el.getBoundingClientRect().height;
      box.dataset.state = was.state; img.hidden = was.img; remove.hidden = was.rm; pickText.textContent = was.pick; status.dataset.kind = was.kind || ''; status.textContent = was.text;
      return Math.max(now, then);
    },
  };
}
