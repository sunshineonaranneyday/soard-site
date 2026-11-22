/**
 * /live/ holds still before a reveal: the server writes the hero (eyebrow, status) and puts the messages box in its
 * section as the page script would (functions/live/[[path]].js firstView, messagesInSection; src/utils/live-when.ts,
 * live-hero-text.ts). Run: node --test tests/live-first-view.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';

const load = (entry) => import(`data:text/javascript,${encodeURIComponent(buildSync({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent', packages: 'external' }).outputFiles[0].text)}`);
const { formatWhen, relativeUntil, revealLabel, daysUntil, dayWords } = await load('src/utils/live-when.ts');
const { plannedText, betweenText, ctasThatApply, ctaPicks, momentWords, afterReveal, watchWords } = await load('src/utils/live-hero-text.ts');
const { firstView, addFirstView, messagesInSection, messageHtml, pastFirst, onRequest, RETIRED_SLATE } = await load('functions/live/[[path]].js');

const NOW = Date.parse('2026-11-10T15:00:00Z'); // Tuesday 10 AM Eastern
const DYLAN = '2026-11-18T21:00:00.000Z';       // Wednesday 4 PM Eastern

test('the time words in a zone: the same sentence the browser writes there', () => {
  assert.equal(formatWhen(DYLAN, 'America/New_York', NOW), 'Wednesday, November 18 at 4:00 PM EST');
  assert.equal(formatWhen(DYLAN, 'America/Los_Angeles', NOW), 'Wednesday, November 18 at 1:00 PM PST');
  assert.equal(relativeUntil(DYLAN, NOW, 'America/New_York'), 'in 8 days');
  assert.equal(revealLabel(DYLAN, 'America/New_York', NOW), 'Coming up');
  assert.equal(revealLabel(DYLAN, 'America/New_York', Date.parse('2026-11-18T13:00:00Z')), 'Reveal day');
  assert.equal(formatWhen(DYLAN, 'America/New_York', Date.parse('2026-11-18T13:00:00Z')), 'today at 4:00 PM EST');
  assert.equal(formatWhen(DYLAN, 'America/New_York', Date.parse('2026-11-17T13:00:00Z')), 'tomorrow at 4:00 PM EST');
  // A late evening reveal in the east is still "tomorrow" on the west coast's calendar, counted in its own days
  const late = '2026-11-19T03:30:00.000Z'; // 10:30 PM Eastern on the 18th, 7:30 PM Pacific on the 18th
  assert.equal(formatWhen(late, 'America/Los_Angeles', Date.parse('2026-11-17T20:00:00Z')), 'tomorrow at 7:30 PM PST');
  assert.equal(relativeUntil('2026-11-10T15:20:00Z', NOW, 'America/New_York'), 'in 20 minutes');
  assert.equal(relativeUntil('2026-11-11T09:00:00Z', NOW, 'America/New_York'), 'in 18 hours');
});

test('the day is said as the live page says it: "Today" only on the day itself', () => {
  const tz = 'America/New_York';
  assert.equal(daysUntil(DYLAN, tz, NOW), 8);
  assert.equal(dayWords(DYLAN, tz, NOW), 'Wednesday, November 18', 'eight days out: the date, not "Live Wednesday", which reads as this week');
  assert.equal(dayWords(DYLAN, tz, Date.parse('2026-11-17T13:00:00Z')), 'tomorrow');
  assert.equal(daysUntil(DYLAN, tz, Date.parse('2026-11-18T05:30:00Z')), 0, '12:30 AM on the day is the day');
  assert.equal(daysUntil(DYLAN, tz, Date.parse('2026-11-18T04:30:00Z')), 1, '11:30 PM the night before is not');
  // formatWhen is built from the same words
  assert.equal(formatWhen(DYLAN, tz, Date.parse('2026-11-17T13:00:00Z')), `${dayWords(DYLAN, tz, Date.parse('2026-11-17T13:00:00Z'))} at 4:00 PM EST`);
});

test('the hero before a reveal and between reveals', () => {
  assert.deepEqual(plannedText(DYLAN, 'America/New_York', NOW), { eyebrow: 'Coming up', status: 'We go live Wednesday, November 18 at 4:00 PM EST, in 8 days.' });
  assert.equal(plannedText(null, 'America/New_York', NOW).status, 'A reveal is on the calendar.');
  assert.equal(plannedText('2026-11-10T14:58:00Z', 'America/New_York', NOW).status, 'Any moment now. Stay right here.');
  const max = { slug: 'max', name: 'Max', confirmed: true, date: '2026-11-20', time: '16:00', startsAt: '2026-11-20T21:00:00.000Z', liveUrl: '/live/max/' };
  const colin = { slug: 'colin', name: 'Colin', confirmed: false, window: { label: 'early December' } };
  assert.equal(betweenText([max, colin], 'max', 'America/New_York'), "Max's reveal is Friday, November 20 at 4:00 PM EST.");
  assert.match(betweenText([max, colin], 'colin', 'America/New_York'), /^Colin's reveal is planned for early December\./);
  assert.equal(betweenText([max, colin], '', 'America/New_York'), "Next up: Max's reveal, Friday, November 20 at 4:00 PM EST.");
  assert.equal(betweenText([max], 'nobody', 'America/New_York'), '');
});

test('which view the server draws first: as the page script will', () => {
  const state = { phase: 'scheduled', kidSlug: 'dylan-2026', scheduledAt: DYLAN, broadcastId: 'b1' };
  const pub = { kidSlug: 'dylan-2026', id: 'b1' };
  const tz = 'America/New_York';
  // Dylan's page and /live/: the reveal coming up
  assert.equal(firstView({ state, pub, pageKid: 'dylan-2026', tz, now: NOW }).view, 'upcoming');
  assert.equal(firstView({ state, pub, pageKid: '', tz, now: NOW }).status, 'We go live Wednesday, November 18 at 4:00 PM EST, in 8 days.');
  // Max's page while Dylan's is scheduled: between reveals, naming Max's
  const rows = [{ slug: 'max', name: 'Max', confirmed: true, date: '2026-11-20', time: '16:00', startsAt: '2026-11-20T21:00:00.000Z' }];
  assert.deepEqual(firstView({ state, pub, pageKid: 'max', rows, tz, now: NOW }), {
    view: 'idle', eyebrow: null, status: "Max's reveal is Friday, November 20 at 4:00 PM EST.", badge: '',
    watch: { when: 'Friday, November 20 at 4:00 PM EST', sub: '', today: false },
  });
  // Nothing on the photo before a reveal any more (no "Live in 8 days" badge): the watch card says when
  assert.equal(firstView({ state, pub, pageKid: 'dylan-2026', tz, now: NOW }).badge, '');
  assert.deepEqual(firstView({ state, pub, pageKid: 'dylan-2026', tz, now: NOW }).watch, { when: 'Wednesday, November 18 at 4:00 PM EST', sub: '', today: false });
  // The watch party has its own first paint; a live reveal without a video is the script's
  assert.equal(firstView({ state, pub, pageKid: 'dylan-2026', party: { mode: 'starting' }, tz, now: NOW }), null);
  assert.equal(firstView({ state: { ...state, phase: 'live' }, pub, pageKid: 'dylan-2026', tz, now: NOW }), null);
  assert.equal(firstView({ state: { phase: 'idle' }, pub: {}, pageKid: '', rows: [], tz, now: NOW }).view, 'idle');
});

test('the messages box moves from the hero into its section, whole', () => {
  const page = '<section id="live-hero"><div class="hero-party" data-slot="hero" hidden><!--msgs-panel--><div class="msgs" data-msgs="panel" data-place="hero"><ol data-msgs="list"></ol></div><!--/msgs-panel--></div></section><section class="live-msgs" data-live-msgs hidden><div class="container" data-slot="section" data-astro-cid-x></div></section>';
  const out = messagesInSection(page);
  assert.match(out, /<div class="hero-party" data-slot="hero" hidden><\/div>/, 'the hero slot is left empty');
  assert.match(out, /<div class="container" data-slot="section" data-astro-cid-x><!--msgs-panel--><div class="msgs" data-msgs="panel"/);
  assert.equal(out.match(/data-msgs="panel"/g).length, 1, 'one box, not two');
  assert.equal(messagesInSection('<div>no markers</div>'), null);
});

test('a message is drawn as the script draws it, and never as markup', () => {
  assert.equal(messageHtml({ id: 'm1', name: 'Ana', body: 'So happy <3 & "proud"' }), '<li class="msg" data-id="m1" style="animation:none"><span class="msg__av" data-tone="3" aria-hidden="true">A</span><div class="msg__card"><span class="msg__name">Ana</span><p class="msg__body">So happy &lt;3 &amp; &quot;proud&quot;</p></div></li>');
  // The writer's letter is a whole character, and its colour the same for the same name wherever it's drawn
  assert.match(messageHtml({ id: 'm2', name: 'élodie', body: 'x' }), /data-tone="1" aria-hidden="true">É</);
  assert.match(messageHtml({ id: 'm3', name: '😊 Sam', body: 'x' }), /aria-hidden="true">😊</);
  assert.doesNotMatch(messageHtml({ id: 'x"><script>', name: '<b>', body: '' }), /<script>|<b>/);
});

test('the hero’s two buttons: the same rule for the server and the page', () => {
  const base = { scheduledAt: DYLAN, remindUsable: true, pageKid: 'dylan-2026', inSchedule: true, pastOnPage: true, hasPlayer: false, now: NOW };
  const picks = (f) => { const a = ctasThatApply(f); return ctaPicks(f.display, (k) => !!a[k]); };
  // Before a reveal: every reveal by email, and the calendar
  assert.deepEqual(picks({ ...base, display: 'upcoming', view: 'upcoming' }), ['cta-remind', 'cta-calendar']);
  // Reminders off: the calendar and Share
  assert.deepEqual(picks({ ...base, display: 'upcoming', view: 'upcoming', remindUsable: false }), ['cta-calendar', 'cta-share']);
  // Past its time: no reminders, no calendar
  assert.deepEqual(picks({ ...base, display: 'upcoming', view: 'upcoming', now: Date.parse(DYLAN) + 60e3 }), ['cta-share', 'cta-donate']);
  // Max's page between reveals: email, and his own invite
  assert.deepEqual(picks({ ...base, pageKid: 'max', display: 'idle', view: 'idle' }), ['cta-remind', 'cta-calendar']);
  // /live/ between reveals: email, then past reveals
  assert.deepEqual(picks({ ...base, pageKid: '', inSchedule: false, display: 'idle', view: 'idle' }), ['cta-remind', 'cta-past']);
});

test('nobody is sent off to Facebook, except to watch an emergency Facebook-only broadcast (Peter, Nov 18 2026)', () => {
  const base = { scheduledAt: DYLAN, remindUsable: true, pageKid: 'dylan-2026', inSchedule: true, pastOnPage: true, now: Date.parse(DYLAN) + 3600e3 };
  const picks = (f) => { const a = ctasThatApply(f); return ctaPicks(f.display, (k) => !!a[k]); };
  // Live with our video: giving and sharing (no Facebook; "Leave a message" is the message box's own to show)
  assert.deepEqual(picks({ ...base, display: 'live', view: 'live', hasPlayer: true, source: 'stream' }), ['cta-donate', 'cta-share']);
  // Our stream with no video yet: still no Facebook
  assert.equal(ctasThatApply({ ...base, display: 'live', view: 'live', hasPlayer: false, source: 'stream' })['cta-facebook'], false);
  // The reveal over, its replay on its way, and the replay itself: Share and Fund the next room
  for (const hasPlayer of [false, true]) {
    assert.deepEqual(picks({ ...base, display: 'replay', view: 'replay', hasPlayer, source: 'stream' }), ['cta-share', 'cta-donate'], `replay (${hasPlayer ? 'ready' : 'on its way'})`);
  }
  // An emergency Facebook-only broadcast: live there, nothing here, so Watch on Facebook; once it's over, not even then
  assert.deepEqual(picks({ ...base, display: 'live', view: 'live', hasPlayer: false, source: 'manual' }), ['cta-facebook', 'cta-donate']);
  assert.equal(ctasThatApply({ ...base, display: 'replay', view: 'replay', hasPlayer: false, source: 'manual' })['cta-facebook'], false);
  // and its words: only it says "live on Facebook"
  assert.equal(momentWords({ view: 'live', scheduledAt: DYLAN, hasPlayer: false, source: 'manual' }).status, 'We are live on Facebook right now.');
  assert.equal(momentWords({ view: 'live', scheduledAt: DYLAN, hasPlayer: false, source: 'stream' }).status, '');
});

test('the reveal over, its replay not here yet: the watch party kept, the frame says it, not the status line', () => {
  const now = Date.parse(DYLAN) + 3600e3;
  const endedAt = new Date(now - 5 * 60e3).toISOString();
  assert.deepEqual(afterReveal({ view: 'replay', hasPlayer: false, source: 'stream', endedAt, now }), { ended: true, replaySoon: true });
  assert.deepEqual(afterReveal({ view: 'replay', hasPlayer: false, source: 'stream', endedAt: new Date(now - 7 * 3600e3).toISOString(), now }), { ended: true, replaySoon: false }, 'overdue: no promise');
  assert.equal(afterReveal({ view: 'replay', hasPlayer: true, source: 'stream', endedAt, now }).ended, false, 'the replay ready: its own video');
  assert.equal(afterReveal({ view: 'replay', hasPlayer: false, source: 'manual', endedAt, now }).ended, false, 'Facebook only: nothing to come back to');
  assert.equal(afterReveal({ view: 'live', hasPlayer: false, source: 'stream', endedAt, now }).ended, false);
  assert.equal(momentWords({ view: 'replay', scheduledAt: DYLAN, hasPlayer: false, source: 'stream', endedAt, party: true, now }).status, '');
  assert.equal(momentWords({ view: 'replay', scheduledAt: DYLAN, hasPlayer: false, source: 'stream', endedAt, now }).status, 'The reveal just ended. The replay will appear here soon.', 'outside the watch party, as before');
});

test('between reveals, past reveals go before the story in the page itself, so a page that arrives in pieces is drawn in order', () => {
  const html = '<div class="live-page"><section id="live-hero"></section><!--live-body--><section class="live-body"></section><div class="live-next"></div><!--live-past--><div class="live-past"><section id="past-reveals"></section></div><!--/live-past--></div>';
  const out = pastFirst(html);
  assert.ok(out.indexOf('class="live-past"') < out.indexOf('class="live-body"'));
  assert.equal(out.match(/class="live-past"/g).length, 1);
  assert.equal(pastFirst('<div>none</div>'), null);
});

test('the retired starting-soon screen answers an empty, see-through page at its old addresses (a Larix layer left on shows the camera)', async () => {
  for (const path of ['/live/slate/', '/live/slate', '/live/dylan-2026/slate/', '/live/dylan-2026/slate/?embed=1&music=0&o=portrait']) {
    const res = await onRequest({ request: new Request(`https://sunshineonaranneyday.com${path}`), env: {}, next: async () => { throw new Error(`${path} went on to the page`); } });
    assert.equal(res.status, 200, path);
    assert.match(res.headers.get('X-Robots-Tag') || '', /noindex/, path);
    const html = await res.text();
    assert.match(html, /<body style="margin:0;background:transparent"><\/body>/, path);
    assert.doesNotMatch(html, /<script|<img|<video|<iframe/, path);
  }
  for (const path of ['/live/', '/live/dylan-2026/', '/live/slater/']) assert.equal(RETIRED_SLATE.test(path), false, path);
});

test('the watch card before a reveal: where and when to watch it (Peter, Nov 19 2026: "more obvious than just text")', () => {
  const tz = 'America/New_York';
  const day = Date.parse('2026-11-18T20:52:00Z'); // 3:52 PM Eastern on the day
  // On the day: today, and how long to go
  assert.deepEqual(watchWords({ view: 'upcoming', scheduledAt: DYLAN, pageKid: 'dylan-2026', tz, now: day }), { when: 'Today at 4:00 PM EST', sub: 'in 8 minutes', today: true });
  // The day before: tomorrow, no countdown
  assert.deepEqual(watchWords({ view: 'upcoming', scheduledAt: DYLAN, pageKid: '', tz, now: Date.parse('2026-11-17T15:00:00Z') }), { when: 'Tomorrow at 4:00 PM EST', sub: '', today: false });
  // Its time come, the camera not on yet; then running late
  assert.deepEqual(watchWords({ view: 'upcoming', scheduledAt: DYLAN, pageKid: '', tz, now: Date.parse(DYLAN) + 60e3 }), { when: 'Any moment now', sub: 'Stay right here', today: true });
  assert.equal(watchWords({ view: 'upcoming', scheduledAt: DYLAN, pageKid: '', tz, now: Date.parse(DYLAN) + 31 * 60e3 }).when, 'Running a little late');
  // No time set for the broadcast: the sentence, as before
  assert.equal(watchWords({ view: 'upcoming', scheduledAt: null, pageKid: '', tz, now: NOW }), null);
  // Between reveals: a child's own page, from the schedule (a set day and time, a time still to come, a third of a month)
  const max = { slug: 'max', name: 'Max', confirmed: true, date: '2026-11-20', time: '16:00', startsAt: '2026-11-20T21:00:00.000Z' };
  const noTime = { slug: 'ava', name: 'Ava', confirmed: true, date: '2026-11-24', time: null, startsAt: '2026-11-24T05:00:00.000Z' };
  const colin = { slug: 'colin', name: 'Colin', confirmed: false, window: { label: 'early December' } };
  const rows = [max, noTime, colin];
  assert.deepEqual(watchWords({ view: 'idle', scheduledAt: null, pageKid: 'max', upcoming: rows, tz, now: Date.parse('2026-11-20T15:00:00Z') }), { when: 'Today at 4:00 PM EST', sub: 'in 6 hours', today: true });
  assert.deepEqual(watchWords({ view: 'idle', scheduledAt: null, pageKid: 'ava', upcoming: rows, tz, now: NOW }), { when: 'Tuesday, November 24', sub: 'Time to come', today: false });
  assert.deepEqual(watchWords({ view: 'idle', scheduledAt: null, pageKid: 'colin', upcoming: rows, tz, now: NOW }), { when: 'Early December', sub: 'Day and time to come', today: false });
  // A child's reveal over and the broadcast moved on to the next one, the schedule still listing it for the rest of its day:
  // no "Watch it live" for it (found in review: 9 PM after Dylan's reveal, with Max's scheduled)
  const dylan = { slug: 'dylan-2026', name: 'Dylan', confirmed: true, date: '2026-11-18', time: '16:00', startsAt: DYLAN };
  assert.equal(watchWords({ view: 'idle', scheduledAt: null, pageKid: 'dylan-2026', upcoming: [dylan, max], tz, now: Date.parse('2026-11-19T02:00:00Z') }), null);
  assert.equal(watchWords({ view: 'idle', scheduledAt: null, pageKid: 'dylan-2026', upcoming: [dylan, max], tz, now: Date.parse(DYLAN) + 5 * 60e3 }), null);
  assert.equal(watchWords({ view: 'idle', scheduledAt: null, pageKid: 'dylan-2026', upcoming: [dylan, max], tz, now: Date.parse(DYLAN) - 5 * 60e3 }).sub, 'in 5 minutes');
  // /live/ between reveals (its frame lists what's coming up), a child not on the schedule, during and after a reveal: none
  assert.equal(watchWords({ view: 'idle', scheduledAt: null, pageKid: '', upcoming: rows, tz, now: NOW }), null);
  assert.equal(watchWords({ view: 'idle', scheduledAt: null, pageKid: 'dylan-2026', upcoming: rows, tz, now: NOW }), null);
  for (const view of ['live', 'replay']) assert.equal(watchWords({ view, scheduledAt: DYLAN, pageKid: 'dylan-2026', upcoming: rows, tz, now: NOW }), null);
});

test('the server writes the watch card from the first paint, the sentence hidden, nothing on the photo', async () => {
  // (Node has no HTMLRewriter: each handler is run on a stand-in element, as tests/live-remind.test.mjs does)
  class El {
    constructor(attrs = {}) { this.attrs = new Map(Object.entries(attrs)); this.text = null; }
    getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; }
    hasAttribute(n) { return this.attrs.has(n); }
    setAttribute(n, v) { this.attrs.set(n, String(v)); }
    removeAttribute(n) { this.attrs.delete(n); }
    setInnerContent(c) { this.text = c; }
  }
  const run = async (first) => {
    const handlers = [];
    globalThis.HTMLRewriter = class { on(sel, h) { handlers.push([sel, h]); return this; } transform(res) { return res; } };
    try { await addFirstView(new Response('<html></html>', { headers: { 'content-type': 'text/html' } }), first); } finally { delete globalThis.HTMLRewriter; }
    return (sel, attrs) => { const e = new El(attrs); for (const [s, h] of handlers) if (s === sel) h.element(e); return e; };
  };
  const state = { phase: 'scheduled', kidSlug: 'dylan-2026', scheduledAt: DYLAN };
  const el = await run(firstView({ state, pub: { kidSlug: 'dylan-2026' }, pageKid: 'dylan-2026', tz: 'America/New_York', now: Date.parse('2026-11-18T20:52:00Z') }));
  const card = el('#live-hero [data-live="watch"]', { hidden: '' });
  assert.equal(card.hasAttribute('hidden'), false, 'the card shown');
  assert.equal(card.hasAttribute('data-today'), true, "with the day's ring");
  assert.equal(el('#live-hero [data-live="watch-when"]').text, 'Today at 4:00 PM EST');
  assert.equal(el('#live-hero [data-live="watch-sub"]').text, 'in 8 minutes');
  const status = el('#live-hero [data-live="status"]');
  assert.equal(status.hasAttribute('hidden'), true, 'the sentence hidden, as the script keeps it');
  assert.equal(status.text, 'We go live today at 4:00 PM EST, in 8 minutes.');
  assert.equal(el('#live-hero [data-s="badge"]').hasAttribute('hidden'), true, 'no badge');
  // No time set for the broadcast: the sentence, and no card
  const plain = await run(firstView({ state: { ...state, scheduledAt: null }, pub: { kidSlug: 'dylan-2026' }, pageKid: 'dylan-2026', tz: 'America/New_York', now: NOW }));
  assert.equal(plain('#live-hero [data-live="watch"]', { hidden: '' }).hasAttribute('hidden'), true);
  assert.equal(plain('#live-hero [data-live="status"]').hasAttribute('hidden'), false);
  assert.equal(plain('#live-hero [data-live="status"]').text, 'A reveal is on the calendar.');
});
