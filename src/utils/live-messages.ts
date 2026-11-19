/**
 * live-messages.ts — behaviour for LiveMessages.astro (messages for the family)
 * ============================================================================
 * One panel that lives in two places: beside the video during the watch
 * party (the hero's text column) and in its own section before it. It moves
 * between them on its own, but never while someone is typing in it.
 *
 * Chat order: newest at the bottom, next to the box you write in. The wall
 * stays pinned to the newest message unless you've scrolled up to read,
 * in which case a "New messages" button appears instead of yanking you down.
 *
 * Messages arrive over the real-time hub; without one that relays them, the
 * panel polls every 20 seconds.
 */
import { trapValue } from '../../functions/api/_bot-trap.js';
import { rehearsal, type LiveClient, type LiveMessage } from './live-client';
import { messageInitial, messageTone, latestLine, LATEST_HEART } from './live-message-look';

export interface MessagesView {
  /** A broadcast is on (scheduled, live or replay) and it is this page's kid */
  active: boolean;
  broadcastId: string | null;
  kidName: string | null;
  /** Watch party: the panel goes beside the video */
  party: boolean;
  /**
   * A child's own past reveal on their page (functions/live/_past-reveal.js): its messages, read by its id, read-only;
   * the hub's messages are the current reveal's, never these
   */
  archive?: boolean;
}
interface Options {
  client: LiveClient;
  panel: HTMLElement;
  /** Slot in the hero's text column */
  heroSlot: HTMLElement;
  /** The section below the hero, and the slot inside it */
  section: HTMLElement;
  sectionSlot: HTMLElement;
  /** "Leave a message" in the hero, shown while the panel is in its section */
  cta: HTMLElement | null;
}

const POLL_MS = 20_000;
// A staff rehearsal's messages are its own (functions/api/live-messages.js ?rehearsal): never the reveal's
const MESSAGES_URL = rehearsal ? '/api/live-messages?rehearsal' : '/api/live-messages';
const MAX = 120;

export function createMessages(opts: Options) {
  const { client, panel, heroSlot, section, sectionSlot, cta } = opts;
  const $ = <T extends HTMLElement = HTMLElement>(k: string) => panel.querySelector(`[data-msgs="${k}"]`) as T | null;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const list = $<HTMLOListElement>('list');
  const wall = $('wall');
  const form = $<HTMLFormElement>('form');
  const setHidden = (el: Element | null, hidden: boolean) => { if (el) (el as HTMLElement).hidden = hidden; };

  let view: MessagesView = { active: false, broadcastId: null, kidName: null, party: false };
  let archived = false;
  let broadcast = '';
  // The server may have put the box in its section already, open and with the messages so far
  // (functions/live/[[path]].js): it starts from that, so the first paint stays as it is until the API answers
  let open = panel.dataset.open === '1';
  let enabled = true;
  let loading = false;
  let shown = !!open && !section.hidden;
  let relayed = false; // the hub relays messages, so no polling
  const ids = new Set<string>([...panel.querySelectorAll<HTMLElement>('[data-msgs="list"] > li[data-id]')].map((li) => li.dataset.id || '').filter(Boolean));

  // The wall is laid out from its end (column-reverse, LiveMessages.astro): its end, the newest message, is scrollTop 0
  // and scrolling back is negative. Read from the page, so a wall drawn the other way still works
  const reversed = () => !!wall && getComputedStyle(wall).flexDirection === 'column-reverse';
  const fromEnd = () => (!wall ? 0 : reversed() ? Math.abs(wall.scrollTop) : wall.scrollHeight - wall.scrollTop - wall.clientHeight);
  const endTop = () => (!wall || reversed() ? 0 : wall.scrollHeight);
  const nearEnd = () => fromEnd() < 80;
  function toEnd() {
    if (wall) { wall.style.scrollBehavior = 'auto'; wall.scrollTop = endTop(); wall.style.scrollBehavior = ''; }
    setHidden($('jump'), true);
  }
  /** A change at the end of the list (a message in or out) keeps what someone scrolled back to read where it is */
  function holdReading(change: () => void, atEnd: boolean) {
    if (!wall || atEnd || !reversed()) { change(); return; }
    const before = wall.scrollHeight;
    change();
    // (at once: the wall scrolls smoothly otherwise, and the message would jump and glide back)
    wall.style.scrollBehavior = 'auto';
    wall.scrollTop -= wall.scrollHeight - before;
    wall.style.scrollBehavior = '';
  }
  wall?.addEventListener('scroll', () => { if (nearEnd()) setHidden($('jump'), true); }, { passive: true });
  $('jump')?.addEventListener('click', () => { wall?.scrollTo({ top: endTop(), behavior: reduced ? 'auto' : 'smooth' }); setHidden($('jump'), true); });

  function place() {
    const target = view.party ? heroSlot : sectionSlot;
    if (panel.parentElement === target || panel.contains(document.activeElement)) return;
    target.appendChild(panel);
    panel.dataset.place = view.party ? 'hero' : 'section';
    toEnd();
  }
  panel.addEventListener('focusout', () => setTimeout(() => { place(); paint(); }, 0));

  function paint() {
    place();
    const show = view.active && enabled && (open || ids.size > 0);
    const inHero = panel.parentElement === heroSlot;
    setHidden(heroSlot, !(show && inHero));
    setHidden(section, !(show && !inHero));
    setHidden(form, !open);
    setHidden($('closed'), open || !ids.size);
    setHidden($('empty'), !!ids.size || !open);
    setHidden(cta, !(show && open && !inHero));
    if (show && !shown) requestAnimationFrame(toEnd);
    shown = show;
    paintLatest();
  }

  function add(m: LiveMessage, animate = true, mine = false) {
    if (!list || ids.has(m.id)) return;
    const stick = mine || nearEnd();
    ids.add(m.id);
    const li = document.createElement('li');
    li.className = 'msg';
    li.dataset.id = m.id;
    // Arriving now (not drawn as part of a fresh load): it rises in and glows for a moment (LiveMessages.astro)
    if (animate) li.classList.add('is-new'); else li.style.animation = 'none';
    // As the server draws it (functions/live/[[path]].js messageHtml): the writer's letter, then the bubble
    const av = document.createElement('span');
    av.className = 'msg__av';
    av.dataset.tone = String(messageTone(m.name));
    av.setAttribute('aria-hidden', 'true');
    av.textContent = messageInitial(m.name);
    const card = document.createElement('div');
    card.className = 'msg__card';
    const who = document.createElement('span');
    who.className = 'msg__name';
    who.textContent = m.name;
    const text = document.createElement('p');
    text.className = 'msg__body';
    text.textContent = m.body;
    card.append(who, text);
    li.append(av, card);
    holdReading(() => list.append(li), stick);
    while (list.children.length > MAX) list.firstElementChild?.remove();
    setHidden($('empty'), true);
    if (stick) toEnd(); else setHidden($('jump'), false);
    paintLatest(animate);
  }

  // ── The newest message, in one line under the video on a phone (LiveMessages.astro); a tap goes to them all ──
  // (the server drew it into the page already, from the same latestLine: data-line says which it shows)
  const latest = $<HTMLButtonElement>('latest');
  let latestId = latest && !latest.hidden ? latest.dataset.line || '' : '';
  function paintLatest(arrived = false) {
    if (!latest) return;
    const li = list?.lastElementChild as HTMLElement | null;
    const newest = li?.dataset.id ? { id: li.dataset.id, name: li.querySelector('.msg__name')?.textContent || '', body: li.querySelector('.msg__body')?.textContent || '' } : null;
    const line = latestLine(view.kidName, newest, open);
    setHidden(latest, !line);
    if (!line || line.id === latestId) return;
    latestId = line.id;
    latest.dataset.line = line.id;
    const av = $('latest-av');
    if (av) { if (line.heart) av.innerHTML = LATEST_HEART; else av.textContent = line.initial || ''; av.dataset.tone = String(line.tone); }
    const n = $('latest-name'); if (n) n.textContent = line.name;
    const t = $('latest-text'); if (t) t.textContent = line.text;
    latest.setAttribute('aria-label', line.label);
    if (arrived && newest && !reduced) { latest.classList.remove('is-new'); void latest.offsetWidth; latest.classList.add('is-new'); }
  }
  latest?.addEventListener('animationend', () => latest.classList.remove('is-new'));
  latest?.addEventListener('click', () => {
    if (!list?.children.length) { form?.querySelector<HTMLTextAreaElement>('textarea[name="body"]')?.focus(); return; }
    (wall || list)?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
    toEnd();
  });
  // (nothing to paint until the page says whose reveal it is, update(): the server drew the line as it should be)
  function remove(id: string) {
    ids.delete(id);
    const li = list?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
    // One under what's on screen (between it and the end) moves the rest; one above it doesn't
    const under = !!li && !!wall && li.getBoundingClientRect().top >= wall.getBoundingClientRect().bottom;
    if (li) holdReading(() => li.remove(), !under);
    setHidden($('empty'), !!list?.children.length);
    paintLatest();
  }

  async function load(fresh: boolean) {
    if (loading) return;
    loading = true;
    try {
      const res = await fetch(view.archive && broadcast ? `/api/live-messages?b=${encodeURIComponent(broadcast)}` : MESSAGES_URL, { cache: 'no-store' });
      const data = await res.json().catch(() => null);
      if (!data || !res.ok) return;
      enabled = !!data.enabled;
      if (!data.enabled || (data.broadcastId && data.broadcastId !== broadcast)) { paint(); return; }
      if (fresh && list) { list.innerHTML = ''; ids.clear(); }
      const incoming: LiveMessage[] = data.messages || [];
      const keep = new Set(incoming.map((m) => m.id));
      if (!fresh) for (const id of [...ids]) if (!keep.has(id)) remove(id);
      for (const m of incoming) add(m, !fresh);
      if (fresh) toEnd();
      paintLatest();
      open = !!data.open;
      paint();
    } catch { /* offline */ } finally { loading = false; }
  }

  const offs = [
    client.on('msg', ({ message }) => { if (broadcast && !view.archive) add(message); }),
    client.on('msg-hide', ({ id }) => remove(id)),
    client.on('connection', ({ connected }) => { if (connected && broadcast) load(false); }),
    // A hub that counts viewers also relays messages
    client.on('viewers', () => { relayed = true; }),
  ];
  const poll = setInterval(() => { if (broadcast && !view.archive && !(client.connected && relayed) && !document.hidden && shown) load(false); }, POLL_MS);

  // ── The box, docked at the bottom of a phone's screen (LiveMessages.astro) ──
  // Its height at rest is the page's to know (LiveMessages.astro sets --live-dock from the first paint: the page's foot
  // leaves that room and the video's size counts it), so nothing here measures it. It's fixed to the page's bottom,
  // which an on-screen keyboard covers: while someone types in it, it rides on top of the keyboard (the visible part of
  // the page, visualViewport). Only then: someone zoomed in with no keyboard up also has a smaller visible part, and
  // the box mustn't chase it around the page
  const compose = $('compose');
  const docked = () => !!compose && getComputedStyle(compose).position === 'fixed';
  const vv = window.visualViewport;
  let kbFrame = 0;
  const onViewport = () => {
    if (!compose) return;
    const typingHere = compose.contains(document.activeElement) && docked();
    const kb = typingHere && vv && vv.scale < 1.05 ? Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop)) : 0;
    if (kb) compose.style.setProperty('--kb', `${kb}px`); else compose.style.removeProperty('--kb');
    // (with the keyboard up the box sits on it, not over the home bar: no room kept for that, LiveMessages.astro)
    if (kb) compose.dataset.kb = ''; else delete compose.dataset.kb;
  };
  const onViewportSoon = () => { cancelAnimationFrame(kbFrame); kbFrame = requestAnimationFrame(onViewport); };
  vv?.addEventListener('resize', onViewportSoon);
  vv?.addEventListener('scroll', onViewportSoon);
  compose?.addEventListener('focusin', onViewportSoon);
  compose?.addEventListener('focusout', onViewportSoon);
  // An iPhone scrolls the page as its keyboard comes up, to show the box above it (the video goes off the top). Once
  // you're done writing, the page goes back to where you were, the video, unless you scrolled it yourself meanwhile
  let restoreY: number | null = null;
  let scrolledSelf = false;
  let restoreTimer: ReturnType<typeof setTimeout> | undefined;
  compose?.addEventListener('focusin', (e) => {
    if (!docked() || compose?.contains(e.relatedTarget as Node | null)) return;
    clearTimeout(restoreTimer);
    restoreY = scrollY; scrolledSelf = false;
  });
  const onSelfScroll = () => { if (restoreY !== null) scrolledSelf = true; };
  addEventListener('touchmove', onSelfScroll, { passive: true });
  addEventListener('wheel', onSelfScroll, { passive: true });
  compose?.addEventListener('focusout', (e) => {
    if (restoreY === null || compose?.contains(e.relatedTarget as Node | null)) return;
    const y = restoreY;
    restoreY = null;
    if (scrolledSelf) return;
    // (once the keyboard has gone and the page has its height back)
    restoreTimer = setTimeout(() => {
      if (compose?.contains(document.activeElement) || Math.abs(scrollY - y) < 8) return;
      scrollTo({ top: y, behavior: reduced ? 'auto' : 'smooth' });
    }, 350);
  });

  // The example in the empty box: the kid's name in it when it fits on the box's one line, a shorter one when it doesn't
  // (a box can't end a line in "…", and the example was cut off mid-word in a narrow one)
  const area = panel.querySelector<HTMLTextAreaElement>('textarea');
  const measure = document.createElement('canvas').getContext('2d');
  let told = false; // (the server's example stands until the page says whose reveal it is: update())
  function fitPlaceholder() {
    if (!area || !told) return;
    const kid = view.kidName ? `${view.kidName}, we are so happy for you!` : '';
    const options = [kid, 'We are so happy for you!', 'So happy for you!'].filter(Boolean);
    const room = area.clientWidth - 2;
    let pick = options[0];
    if (measure && room > 0) {
      measure.font = getComputedStyle(area).font;
      pick = options.find((t) => measure.measureText(t).width <= room) || options[options.length - 1];
    }
    if (area.placeholder !== pick) area.placeholder = pick;
  }
  const areaWatch = area && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => fitPlaceholder()) : null;
  if (area) areaWatch?.observe(area);

  // ── Posting ─────────────────────────────────────────────────────
  function store(key: string, value?: string) {
    try { if (value === undefined) return localStorage.getItem(key) || ''; localStorage.setItem(key, value); } catch { /* private mode */ }
    return '';
  }
  // Who posted is the server's business: it sets its own HttpOnly cookie on the first post
  if (form) {
    const nameInput = form.querySelector<HTMLInputElement>('input[name="name"]');
    const bodyInput = form.querySelector<HTMLTextAreaElement>('textarea[name="body"]');
    const count = $('count');
    const note = $('note');
    const send = $('send');
    // A tap on the arrow never takes the focus from where you're typing: the keyboard stays up for the next message, as
    // a chat's does, and nothing in the box moves between the finger touching the arrow and lifting off it (on an
    // iPhone the box used to change shape as the keyboard went, and the tap landed beside the arrow: nothing sent)
    send?.addEventListener('mousedown', (e) => e.preventDefault());
    if (nameInput) nameInput.value = store('soard-live-name');
    // The box grows with what's typed (to about five lines, then it scrolls), the count shows once it's getting long,
    // and the arrow turns yellow when there's something to send
    const fitBody = () => {
      if (!bodyInput) return;
      bodyInput.style.height = '';
      if (bodyInput.scrollHeight > bodyInput.clientHeight) bodyInput.style.height = `${Math.min(bodyInput.scrollHeight, 132)}px`;
    };
    const typed = () => {
      const n = bodyInput?.value.length || 0;
      if (count) { count.textContent = `${n}/280`; count.hidden = n < 200; }
      send?.classList.toggle('is-ready', (bodyInput?.value.trim().length || 0) >= 2);
      fitBody();
    };
    // Enter posts (the keyboard's Send key too). A message is one paragraph, as it's posted and kept for the family, so
    // Shift+Enter makes no new line either; pasted lines join with a space
    bodyInput?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      if (!e.shiftKey) form.requestSubmit();
    });
    bodyInput?.addEventListener('input', () => { if (bodyInput.value.includes('\n')) { const at = bodyInput.selectionStart; bodyInput.value = bodyInput.value.replace(/\s*\n\s*/g, ' '); bodyInput.setSelectionRange(at, at); } });
    let noteTimer: ReturnType<typeof setTimeout> | undefined;
    let posting = false;
    const say = (text: string, error = false, forMs = 0) => {
      clearTimeout(noteTimer);
      if (!note) return;
      note.className = error ? 'remind-note remind-note--error' : 'remind-note';
      note.textContent = text;
      if (forMs) noteTimer = setTimeout(() => { if (note && note.textContent === text) note.textContent = ''; }, forMs);
    };
    // A note is about what was just sent (or tried): once you write again, it's done
    bodyInput?.addEventListener('input', () => { typed(); if (!posting && note?.textContent) say(''); });
    nameInput?.addEventListener('input', () => { if (!posting && note?.textContent) say(''); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      // (once at a time: Enter again before the first is back would post it twice; the button is off meanwhile, Enter isn't)
      if (posting) return;
      const btn = form.querySelector('button[type="submit"]') as HTMLButtonElement;
      const name = nameInput?.value.trim() || '';
      const text = bodyInput?.value.trim() || '';
      if (!name) { say('Add your first name.', true); nameInput?.focus(); return; }
      if (text.length < 2) { say('Write a little more.', true); bodyInput?.focus(); return; }
      btn.disabled = true; posting = true; say('Posting…');
      try {
        const res = await fetch(MESSAGES_URL, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
          body: JSON.stringify({ name, body: text, website: trapValue(form) }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          store('soard-live-name', name);
          if (bodyInput) bodyInput.value = '';
          typed();
          // (posted: your message on the wall says so, so the note goes after a moment; one held for a person stays)
          if (data.status === 'shown' && data.message) { add(data.message, true, true); say('Posted. Thank you!', false, 3500); }
          else say('Thank you! Your message will show up once someone on our team takes a look.');
        } else {
          say(data.error || 'Something went wrong. Please try again.', true);
        }
      } catch {
        say('No connection. Please try again.', true);
      } finally {
        btn.disabled = false; posting = false;
      }
    });
  }

  return {
    update(next: MessagesView) {
      view = next;
      const heading = $('heading');
      if (heading) heading.textContent = next.kidName ? `Messages for ${next.kidName}'s family` : 'Messages for the family';
      told = true;
      fitPlaceholder();
      const empty = $('empty-text');
      if (empty) empty.textContent = latestLine(next.kidName, null, true)?.text || 'Be the first to leave a message';
      // (the same reveal becoming the page's past one, its replay window over: read again, read-only now)
      if (!next.active) { broadcast = ''; open = false; }
      else if (next.broadcastId !== broadcast || !!next.archive !== archived) { broadcast = next.broadcastId || ''; archived = !!next.archive; if (archived) open = false; load(true); }
      paint();
    },
    /** The page is being swapped out by a client-side navigation */
    destroy() {
      clearInterval(poll);
      for (const off of offs) off();
      vv?.removeEventListener('resize', onViewportSoon);
      vv?.removeEventListener('scroll', onViewportSoon);
      cancelAnimationFrame(kbFrame);
      areaWatch?.disconnect();
      removeEventListener('touchmove', onSelfScroll);
      removeEventListener('wheel', onSelfScroll);
      clearTimeout(restoreTimer);
    },
  };
}
