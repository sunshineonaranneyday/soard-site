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
import { messageInitial, messageTone } from './live-message-look';

export interface MessagesView {
  /** A broadcast is on (scheduled, live or replay) and it is this page's kid */
  active: boolean;
  broadcastId: string | null;
  kidName: string | null;
  /** Watch party: the panel goes beside the video */
  party: boolean;
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
  const latest = $<HTMLButtonElement>('latest');
  let latestId = '';
  const HEART = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>';
  function paintLatest(arrived = false) {
    if (!latest) return;
    const li = list?.lastElementChild as HTMLElement | null;
    const id = li?.dataset.id || (open ? `first:${view.kidName || ''}` : '');
    setHidden(latest, !id);
    if (!id || id === latestId) return;
    latestId = id;
    // None yet: the line asks for the first (a tap goes to the box)
    if (!li) {
      const av = $('latest-av'); if (av) { av.innerHTML = HEART; av.dataset.tone = '0'; }
      const n = $('latest-name'); if (n) n.textContent = '';
      const t = $('latest-text'); if (t) t.textContent = view.kidName ? `Be the first to write to ${view.kidName}'s family` : 'Be the first to leave a message';
      latest.setAttribute('aria-label', 'Be the first to leave a message');
      return;
    }
    const av = $('latest-av'); const src = li.querySelector<HTMLElement>('.msg__av');
    if (av) { av.textContent = src?.textContent || ''; av.dataset.tone = src?.dataset.tone || '0'; }
    const name = li.querySelector('.msg__name')?.textContent || '';
    const body = li.querySelector('.msg__body')?.textContent || '';
    const n = $('latest-name'); if (n) n.textContent = name;
    const t = $('latest-text'); if (t) t.textContent = body;
    latest.setAttribute('aria-label', `Newest message, from ${name}: ${body}. See every message`);
    if (arrived && !reduced) { latest.classList.remove('is-new'); void latest.offsetWidth; latest.classList.add('is-new'); }
  }
  latest?.addEventListener('animationend', () => latest.classList.remove('is-new'));
  latest?.addEventListener('click', () => {
    if (!list?.children.length) { form?.querySelector<HTMLTextAreaElement>('textarea[name="body"]')?.focus(); return; }
    (wall || list)?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
    toEnd();
  });
  // (the messages the server drew into the page: their newest is the line's from the start)
  paintLatest();
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
      const res = await fetch(MESSAGES_URL, { cache: 'no-store' });
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
    client.on('msg', ({ message }) => { if (broadcast) add(message); }),
    client.on('msg-hide', ({ id }) => remove(id)),
    client.on('connection', ({ connected }) => { if (connected && broadcast) load(false); }),
    // A hub that counts viewers also relays messages
    client.on('viewers', () => { relayed = true; }),
  ];
  const poll = setInterval(() => { if (broadcast && !(client.connected && relayed) && !document.hidden && shown) load(false); }, POLL_MS);

  // ── The box, docked at the bottom of a phone's screen (LiveMessages.astro) ──
  // It's fixed to the page's bottom, which an on-screen keyboard covers: while it's up, the box rides on top of it (the
  // visible part of the page, visualViewport). And the page knows how tall it is (--live-dock): the page's foot leaves
  // that much room, and the corner video sits above it (live-stage.ts, data-bottom-bar)
  const compose = $('compose');
  const docked = () => !!compose && getComputedStyle(compose).position === 'fixed';
  const vv = window.visualViewport;
  const onViewport = () => {
    if (!compose) return;
    const kb = docked() && vv ? Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop)) : 0;
    if (kb) compose.style.setProperty('--kb', `${kb}px`); else compose.style.removeProperty('--kb');
  };
  vv?.addEventListener('resize', onViewport);
  vv?.addEventListener('scroll', onViewport);
  const root = document.documentElement;
  const sizeDock = () => {
    // (at rest: while someone's in it, it shows its "Writing as" line too, and the page above mustn't move for that)
    if (compose?.contains(document.activeElement)) return;
    const h = docked() && compose ? Math.round(compose.getBoundingClientRect().height) : 0;
    if (h) root.style.setProperty('--live-dock', `${h}px`); else root.style.removeProperty('--live-dock');
  };
  // (a frame later: the page laid out again for the new height inside the observer's own pass is a loop browsers warn about)
  let dockFrame = 0;
  const dockWatch = compose && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
    cancelAnimationFrame(dockFrame);
    dockFrame = requestAnimationFrame(() => { sizeDock(); onViewport(); });
  }) : null;
  if (compose) dockWatch?.observe(compose);
  // (its position changes with the layout, not its size: a turn sideways undocks it)
  addEventListener('resize', sizeDock);

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
    bodyInput?.addEventListener('input', typed);
    // Enter posts, Shift+Enter is a new line, like every chat
    bodyInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
    const say = (text: string, error = false) => { if (note) { note.className = error ? 'remind-note remind-note--error' : 'remind-note'; note.textContent = text; } };
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"]') as HTMLButtonElement;
      const name = nameInput?.value.trim() || '';
      const text = bodyInput?.value.trim() || '';
      if (!name) { say('Add your first name.', true); nameInput?.focus(); return; }
      if (text.length < 2) { say('Write a little more.', true); bodyInput?.focus(); return; }
      btn.disabled = true; say('Posting…');
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
          if (data.status === 'shown' && data.message) { add(data.message, true, true); say('Posted. Thank you!'); }
          else say('Thank you! Your message will show up once someone on our team takes a look.');
        } else {
          say(data.error || 'Something went wrong. Please try again.', true);
        }
      } catch {
        say('No connection. Please try again.', true);
      } finally {
        btn.disabled = false;
      }
    });
  }

  return {
    update(next: MessagesView) {
      view = next;
      const heading = $('heading');
      if (heading) heading.textContent = next.kidName ? `Messages for ${next.kidName}'s family` : 'Messages for the family';
      const area = panel.querySelector<HTMLTextAreaElement>('textarea');
      if (area) area.placeholder = next.kidName ? `${next.kidName}, we are so happy for you!` : 'We are so happy for you!';
      if (!next.active) { broadcast = ''; open = false; }
      else if (next.broadcastId !== broadcast) { broadcast = next.broadcastId || ''; load(true); }
      paint();
    },
    /** The page is being swapped out by a client-side navigation */
    destroy() {
      clearInterval(poll);
      for (const off of offs) off();
      vv?.removeEventListener('resize', onViewport);
      vv?.removeEventListener('scroll', onViewport);
      removeEventListener('resize', sizeDock);
      dockWatch?.disconnect();
      cancelAnimationFrame(dockFrame);
      root.style.removeProperty('--live-dock');
    },
  };
}
