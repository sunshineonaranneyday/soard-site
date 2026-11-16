/**
 * Emails for the Advisory Board
 * ===========================================================================
 * To advisors (people outside SOARD): off until settings.emails is on, the switch
 * on Members. The monthly ask, an update on an introduction or a hosted fundraiser,
 * a note when a gift lands on their page, the welcome. Nothing else starts them:
 * filling in data never sends anything.
 *
 * The welcome ("Your Advisory Board page is ready") goes when staff press Add to
 * Advisory Board on an application (Peter, Nov 16 2026), once the sign-in knows
 * their address: the sign-in list is brought up to date there and then, and if
 * Cloudflare hasn't taken it yet the welcome waits for the heartbeat that sees
 * it has. With the switch off it waits for the switch (welcomeOnJoin,
 * sendWaitingWelcomes).
 *
 * To whoever runs the group: on from the start, because an introduction that nobody
 * sees is worse than none. A notice names what came in and links to Run it, never a
 * contact's email or phone, which stay on the page.
 *
 * Replies go to whoever runs the group (Peter's call, Nov 7 2026), or to info@ while
 * nobody does or they have no address on file. No email ever names a kid
 * or a gift amount beside a reveal; the kid is theirs to hear about at the meeting.
 * The ask's buttons carry a token for one ask and one advisor (D1 keeps only its hash), and GET only shows
 * the question, because mail scanners open links: a person's press is a POST.
 */

import { sendEmails, sendEmailItems, EMAIL_FROM, SITE_ORIGIN, isEmail } from './_broadcast-notify.js';
import * as shell from './_email-shell.js';
import { activeAdvisors, peopleRows, privateEmails, readState, boardAdmins } from './_board-roles.js';
import { ensureAdvisory, getSettings, INTRO_STATUSES, HOSTED_STATUSES, answerAsk } from './_advisory.js';
import { syncBoardAccess, canSignIn, accessStatus } from './_board-access.js';
import { greetName } from './_advisory-form.js';

const LOG = 'advisory-mail';
const FROM = EMAIL_FROM.replace(/^[^<]*/, 'SOARD Advisory Board ');
const PAGE = `${SITE_ORIGIN}/admin/advisory/`;
// Run it, by a link that survives the sign-in (a #/ link lands on Home)
const RUN = `${SITE_ORIGIN}/advisory/run`;
const FALLBACK = 'info@soardcharity.com';
const LINK_DAYS = 30;
const NUDGE_EVERY_MS = 7 * 86_400_000;
const longDay = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');
// The name to greet: "Dr. Jordan Smith" is Jordan (a title alone, "Dr. Smith", stays whole)
const firstOf = (name) => greetName({ fullName: name }) || String(name || '').trim();
const tag = (value) => [{ name: 'kind', value }];

async function leadOf(env, settings) {
  const [people, emails] = await Promise.all([peopleRows(env.DB), privateEmails(env.DB)]);
  const p = people.find((x) => x.slug === settings.lead);
  const email = p ? emails[p.slug] : '';
  return { name: p?.name || '', email: isEmail(email) ? email : FALLBACK };
}
const replyTo = async (env, settings) => (await leadOf(env, settings)).email;

async function remember(DB, entry, now = Date.now()) {
  const log = await readState(DB, LOG);
  const what = { ask: `This month’s ask: ${entry.title || ''}`, welcome: 'Your page is ready', goal: 'The goal was reached', 'goal-note': 'You reached the goal', 'advisory-update': 'An update to an Advisory Board member' }[entry.kind] || (String(entry.kind).startsWith('notice-') ? 'A notice to whoever runs the group' : entry.kind);
  // (the list alone is written: what else the record holds is never written back from this read)
  await setTop(DB, 'list', [{ at: new Date(now).toISOString(), what, ...entry }, ...(log.list || [])].slice(0, 40));
}
export const mailLog = async (DB) => (await readState(DB, LOG)).list || [];
/*
 * welcomed: { slug: { at, to } }, when it went and to which address. Had it means sent to the address they have now: a
 * new person later given a deleted person's web address (People's own editor can) gets their own; the same person put
 * back from Recently deleted, with their address again, isn't sent it twice. An older record (the time alone) counts
 * as had, whoever. A welcome on its way is { sending: when }, never had.
 */
const plain = (e) => String(e || '').trim().toLowerCase();
const hadIt = (v, email = '') => typeof v === 'string' || (!!v && typeof v === 'object' && !!v.at && !v.sending && (!v.to || !email || v.to === plain(email)));
/** { slug: true } for everyone who's had theirs at the address they have now */
export const welcomedSlugs = async (DB) => {
  const [log, emails] = await Promise.all([readState(DB, LOG), privateEmails(DB)]);
  return Object.fromEntries(Object.entries(log.welcomed || {}).filter(([slug, v]) => hadIt(v, emails[slug])).map(([slug]) => [slug, true]));
};
/** Every address with a welcome had, on its way or waiting (./_advisory-add.js never gives a new person one of these) */
export const mailSlugs = async (DB) => { const log = await readState(DB, LOG); return [...Object.keys(log.welcomed || {}), ...Object.keys(log.waiting || {})]; };

/*
 * One entry of the mail record (welcomed, waiting, nudgedAt) changed in place by D1 itself, never the whole record
 * read and written back: two at once (a press and the heartbeat, two staff) never undo each other.
 */
const SENDING_STALE_MS = 10 * 60 * 1000; // a welcome "on its way" longer than this was a request that died: it can go again
const pathOf = (group, key) => `$.${JSON.stringify(group)}${key == null ? '' : `.${JSON.stringify(String(key))}`}`;
async function logRow(DB) {
  await readState(DB, LOG); // (makes the table)
  await DB.prepare("INSERT OR IGNORE INTO board_state (key, data, updated_at) VALUES (?, '{}', ?)").bind(LOG, new Date().toISOString()).run();
}
// (the group made first, so a key inside it always has somewhere to go)
const withGroup = (group) => `json_set(CASE WHEN json_valid(data) THEN data ELSE '{}' END, '${pathOf(group)}', json(ifnull(json_extract(CASE WHEN json_valid(data) THEN data ELSE '{}' END, '${pathOf(group)}'), '{}')))`;
async function setEntry(DB, group, key, value) {
  await logRow(DB);
  await DB.prepare(`UPDATE board_state SET data = json_set(${withGroup(group)}, ?, json(?)), updated_at = ? WHERE key = ?`)
    .bind(pathOf(group, key), JSON.stringify(value), new Date().toISOString(), LOG).run();
}
async function removeEntry(DB, group, key) {
  await logRow(DB);
  await DB.prepare('UPDATE board_state SET data = json_remove(data, ?), updated_at = ? WHERE key = ? AND json_valid(data)')
    .bind(pathOf(group, key), new Date().toISOString(), LOG).run();
}
async function setTop(DB, key, value) {
  await logRow(DB);
  await DB.prepare("UPDATE board_state SET data = json_set(CASE WHEN json_valid(data) THEN data ELSE '{}' END, ?, json(?)), updated_at = ? WHERE key = ?")
    .bind(pathOf(key), JSON.stringify(value), new Date().toISOString(), LOG).run();
}
/**
 * Their welcome, claimed for this send: true only for the one send that gets it (nobody emailed twice). Free to claim:
 * none yet, a claim a dead request left, or one that went to another address (someone else at this web address)
 */
async function claimWelcome(DB, slug, now, email) {
  await logRow(DB);
  const path = pathOf('welcomed', slug);
  const r = await DB.prepare(`UPDATE board_state SET data = json_set(${withGroup('welcomed')}, ?, json(?)), updated_at = ? WHERE key = ?
    AND (json_extract(data, ?) IS NULL OR (json_type(data, ?) = 'object' AND (
      (json_extract(data, ?) IS NOT NULL AND json_extract(data, ?) < ?)
      OR (json_extract(data, ?) IS NOT NULL AND json_extract(data, ?) IS NOT NULL AND json_extract(data, ?) != ?))))`)
    .bind(path, JSON.stringify({ sending: new Date(now).toISOString() }), new Date().toISOString(), LOG, path, path,
      `${path}.sending`, `${path}.sending`, new Date(now - SENDING_STALE_MS).toISOString(),
      `${path}.at`, `${path}.to`, `${path}.to`, plain(email)).run();
  return !!r?.meta?.changes;
}

/**
 * Their welcome, written down as waiting (Add does this before Joined): the heartbeat sends it unless they've had it.
 * greet: the name their application asked to be called (kept with it, so a deleted application doesn't lose it)
 */
export async function queueWelcome(DB, slug, { by = '', now = Date.now(), greet = '' } = {}) {
  const [log, emails] = await Promise.all([readState(DB, LOG), privateEmails(DB)]);
  if (hadIt(log.welcomed?.[slug], emails[slug])) return;
  await setEntry(DB, 'waiting', slug, { at: new Date(now).toISOString(), by, ...(greet ? { greet } : {}) });
}

/** Their web address on People changed (./rename-content.js): their welcome, had or waiting, goes with them */
export async function renameMember(DB, from, to) {
  const log = await readState(DB, LOG);
  for (const group of ['welcomed', 'waiting']) {
    const v = log[group]?.[from];
    if (v === undefined) continue;
    await setEntry(DB, group, to, v);
    await removeEntry(DB, group, from);
  }
}

/**
 * Someone deleted from People: a welcome still waiting for them goes. The one they had stays on record (put back from
 * Recently deleted, they aren't sent it twice; Add never gives their address to anyone new, ./_advisory-add.js)
 */
export async function forgetMember(DB, slug) {
  await removeEntry(DB, 'waiting', slug);
}

/**
 * The names Advisory Board members gave on their application, by People slug: the one they asked to be called ("Jo"),
 * else their first name as they wrote it ("Katie", where People has Katherine); their latest application's
 */
async function preferredNames(DB) {
  try {
    const { results } = await DB.prepare("SELECT person_slug, answers FROM advisory_applications WHERE person_slug IS NOT NULL ORDER BY created_at").all();
    const out = {};
    for (const r of results || []) {
      let a = {};
      try { a = JSON.parse(r.answers || '{}') || {}; } catch { a = {}; }
      const g = greetName(a);
      if (g) out[r.person_slug] = g;
    }
    return out;
  } catch (e) {
    // (the greeting only: a read that fails greets by their People first name, never holds an email up)
    if (!/no such table/i.test(e?.message || '')) console.error('[advisory-mail] names from applications', e?.message);
    return {};
  }
}
const greetingFor = (a, preferred) => preferred[a.slug] || firstOf(a.name);
/** Had their welcome, or one is on its way right now (a claim left by a request that died doesn't count) */
const hasOrGoing = (v, now, email) => hadIt(v, email) || (!!v?.sending && Date.parse(v.sending) > now - SENDING_STALE_MS);

const para = (text) => shell.paragraphs(text);

// ─── To whoever runs the group ──────────────────────────────────────

/** What came in, for the person running the group. Never throws */
export async function noticeLead(env, { kind, who, intro, hosted, note, term }) {
  try {
    const settings = await getSettings(env.DB);
    const lead = await leadOf(env, settings);
    const name = who?.name || 'An Advisory Board member';
    const words = {
      intro: { subject: `${firstOf(name)} made an introduction`, line: `${name} introduced ${intro?.name || 'someone'}${intro?.company ? ` at ${intro.company}` : ''}.` },
      host: { subject: `${firstOf(name)} wants to host a fundraiser`, line: `${name} asked to host: ${hosted?.title || ''}. It needs a yes or a not now.` },
      answer: { subject: `${firstOf(name)} can help with this month’s ask`, line: `${name} said yes to this month’s ask.${note ? ` They wrote: “${note}”` : ''}` },
      renew: { subject: `${firstOf(name)} renewed`, line: `${name} renewed for another year, through ${longDay(term?.ends) || 'next year'}.` },
    }[kind];
    if (!words) return;
    const html = shell.emailShell({
      preheader: words.line, eyebrow: 'Advisory Board', heading: words.subject, bodyHtml: para(words.line) + shell.button('Open Run it', RUN, 'primary', { big: true }),
    });
    const r = await sendEmails(env, { to: [lead.email], from: FROM, subject: words.subject, html, text: `${words.line}\n\n${RUN}`, tags: tag('advisory-lead') });
    await remember(env.DB, { kind: `notice-${kind}`, to: 'lead', sent: r.sent, error: r.errors?.[0] || null });
  } catch (e) { console.error('[advisory-mail] notice', e.message); }
}

/** The group reached its goal: what to do next, for whoever runs it and the admins */
export async function noticeGoal(env, settings, { raised }) {
  const lead = await leadOf(env, settings);
  const admins = await boardAdmins(env.DB);
  const to = [...new Set([lead.email, ...admins])];
  const subject = 'The Advisory Board reached its goal';
  const line = settings.kid
    ? 'The group has raised its goal. Next, move their makeover’s job forward in JobTread, because the site never changes a job’s status.'
    : 'The group has raised its goal. Next, pick the kid the group will sponsor on Members, then move that job forward in JobTread.';
  const html = shell.emailShell({ preheader: line, eyebrow: 'Advisory Board', heading: subject, bodyHtml: para(line) + shell.button('Open Members', RUN, 'primary', { big: true }) });
  await sendEmails(env, { to, from: FROM, subject, html, text: `${line}\n\n${RUN}`, tags: tag('advisory-lead') });
  await remember(env.DB, { kind: 'goal', to: 'lead and admins', raised });
}

/** Once a week at most, when something has been waiting a week, or no ask has gone out in a month. Never throws */
export async function maybeNudgeLead(env, { now = Date.now() } = {}) {
  try {
    await ensureAdvisory(env.DB);
    const log = await readState(env.DB, LOG);
    if (log.nudgedAt && now - Date.parse(log.nudgedAt) < NUDGE_EVERY_MS) return null;
    const week = new Date(now - NUDGE_EVERY_MS).toISOString();
    const month = new Date(now - 30 * 86_400_000).toISOString();
    const intros = (await env.DB.prepare("SELECT COUNT(*) AS n FROM advisory_intros WHERE status = 'thanks' AND at < ?").bind(week).first())?.n || 0;
    const hosted = (await env.DB.prepare("SELECT COUNT(*) AS n FROM advisory_hosted WHERE status = 'new' AND at < ?").bind(week).first())?.n || 0;
    const advisors = (await activeAdvisors(env.DB)).length;
    const lastAsk = (await env.DB.prepare('SELECT MAX(sent_at) AS at FROM advisory_asks').first())?.at;
    const noAsk = advisors > 0 && (await getSettings(env.DB)).emails && (!lastAsk || lastAsk < month);
    if (!intros && !hosted && !noAsk) return null;
    const settings = await getSettings(env.DB);
    const lead = await leadOf(env, settings);
    const lines = [
      intros ? `${intros} ${intros === 1 ? 'introduction is' : 'introductions are'} waiting for an answer.` : '',
      hosted ? `${hosted} ${hosted === 1 ? 'fundraiser request is' : 'fundraiser requests are'} waiting for a yes or a not now.` : '',
      noAsk ? 'It’s been a month since the last ask went out.' : '',
    ].filter(Boolean);
    const subject = 'The Advisory Board has things waiting';
    const html = shell.emailShell({ preheader: lines[0], eyebrow: 'Advisory Board', heading: subject, bodyHtml: para(lines.join('\n\n')) + shell.button('Open Run it', RUN, 'primary', { big: true }) });
    await sendEmails(env, { to: [lead.email], from: FROM, subject, html, text: `${lines.join('\n')}\n\n${RUN}`, tags: tag('advisory-lead') });
    await setTop(env.DB, 'nudgedAt', new Date(now).toISOString());
    return lines;
  } catch (e) { console.error('[advisory-mail] nudge', e.message); return null; }
}

// ─── To advisors (only with the switch on) ──────────────────────────

const LINKS = 'CREATE TABLE IF NOT EXISTS advisory_links (hash TEXT PRIMARY KEY, ask_id TEXT NOT NULL, slug TEXT NOT NULL, expires TEXT NOT NULL)';
const hashOf = async (t) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const tokenOf = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function linkFor(DB, askId, slug, now) {
  await DB.prepare(LINKS).run();
  const t = tokenOf();
  await DB.prepare('INSERT INTO advisory_links (hash, ask_id, slug, expires) VALUES (?, ?, ?, ?)').bind(await hashOf(t), askId, slug, new Date(now + LINK_DAYS * 86_400_000).toISOString()).run();
  return t;
}
/** What a link in an email stands for: { askId, slug }, or null when it's unknown or old */
export async function linkFrom(DB, token, { now = Date.now() } = {}) {
  await DB.prepare(LINKS).run();
  const row = await DB.prepare('SELECT ask_id, slug, expires FROM advisory_links WHERE hash = ?').bind(await hashOf(String(token || ''))).first();
  if (!row || row.expires <= new Date(now).toISOString()) return null;
  // Someone who has left the group can't answer from an old email
  return (await activeAdvisors(DB)).some((a) => a.slug === row.slug) ? { askId: row.ask_id, slug: row.slug } : null;
}
export async function answerFromLink(DB, token, { answer, note = '' }, { now = Date.now() } = {}) {
  const link = await linkFrom(DB, token, { now });
  if (!link) throw Object.assign(new Error('This link has expired. Open the Advisory Board page to answer.'), { status: 410 });
  return { ...link, ...(await answerAsk(DB, link.askId, link.slug, { answer, note, via: 'email' }, { now })) };
}

export function askEmail(ask, first, { yes, no }) {
  const heading = ask.title;
  const html = shell.emailShell({
    preheader: ask.body || 'This month’s ask from the Advisory Board.', eyebrow: 'This month’s ask', heading,
    bodyHtml: para(`Hi ${first},\n\n${ask.body || 'Can you help with this one?'}${ask.link ? `\n\nMore here: ${ask.link}` : ''}`) + shell.buttonRow([shell.button('I can help', yes, 'primary'), shell.button('Not this time', no, 'outline')]),
    footerHtml: 'Questions? Just reply to this email.',
  });
  return { subject: `This month’s ask: ${ask.title}`, html, text: `Hi ${first},\n\n${ask.title}\n\n${ask.body || ''}${ask.link ? `\n\nMore here: ${ask.link}` : ''}\n\nI can help: ${yes}\nNot this time: ${no}` };
}

export async function sendAsk(env, ask, { now = Date.now() } = {}) {
  const settings = await getSettings(env.DB);
  if (!settings.emails) return { off: true };
  const log = await mailLog(env.DB);
  if (log.some((l) => l.kind === 'ask' && l.id === ask.id && l.sent > 0)) return { already: true };
  const advisors = (await activeAdvisors(env.DB)).filter((a) => isEmail(a.email));
  const preferred = await preferredNames(env.DB);
  const items = [];
  for (const a of advisors) {
    const t = await linkFor(env.DB, ask.id, a.slug, now);
    const at = (d) => `${SITE_ORIGIN}/api/advisory-action?t=${encodeURIComponent(t)}&do=${d}`;
    items.push({ to: a.email, ...askEmail(ask, greetingFor(a, preferred), { yes: at('yes'), no: at('no') }) });
  }
  const r = await sendEmailItems(env, items, { from: FROM, replyTo: await replyTo(env, settings), tags: tag('advisory-ask') });
  await remember(env.DB, { kind: r.sent ? 'ask' : 'ask-failed', id: ask.id, title: ask.title, sent: r.sent, failed: r.failed, ...(r.sent ? {} : { what: `This month’s ask didn’t send: ${ask.title}` }) }, now);
  return { sent: r.sent, failed: r.failed };
}

async function toOne(env, slug, { subject, heading, line, kind }) {
  const settings = await getSettings(env.DB);
  if (!settings.emails) return { off: true };
  const a = (await activeAdvisors(env.DB)).find((x) => x.slug === slug);
  if (!a || !isEmail(a.email)) return { sent: 0 };
  const html = shell.emailShell({ preheader: line, eyebrow: 'Advisory Board', heading, bodyHtml: para(line) + shell.button('Open your page', PAGE, 'primary', { big: true }) });
  const r = await sendEmails(env, { to: [a.email], from: FROM, subject, html, text: `${line}\n\n${PAGE}`, replyTo: await replyTo(env, settings), tags: tag(kind) });
  await remember(env.DB, { kind, sent: r.sent });
  return { sent: r.sent };
}
export function sendIntroUpdate(env, intro) {
  const label = INTRO_STATUSES.find((s) => s.id === intro.status);
  return toOne(env, intro.slug, { kind: 'advisory-update', subject: `An update on ${intro.name}`, heading: `${intro.name}: ${label?.label || intro.status}`, line: `An update on your introduction: ${label?.sub || label?.label || ''}.${intro.note ? `\n\n${intro.note}` : ''}` });
}
export function sendHostUpdate(env, hosted) {
  const label = HOSTED_STATUSES.find((s) => s.id === hosted.status);
  return toOne(env, hosted.slug, { kind: 'advisory-update', subject: `Your fundraiser: ${hosted.title}`, heading: `${hosted.title}: ${label?.label || hosted.status}`, line: hosted.note || `Your request to host is now marked ${String(label?.label || hosted.status).toLowerCase()}.` });
}
export const sendGiftNote = (env, slug, n) => toOne(env, slug, { kind: 'advisory-update', subject: 'A gift came through your page', heading: 'A gift came through your page', line: `${n === 1 ? 'Someone' : `${n} people`} gave through your page. Thank you for sharing it.` });

/** The group reached the goal: a thank-you to everyone, with no kid named */
export async function sendGoalNote(env, settings) {
  if (!settings.emails) return { off: true };
  const advisors = (await activeAdvisors(env.DB)).filter((a) => isEmail(a.email));
  const line = 'You did it. Together you have raised enough to fund a makeover. There’s more to come at the next meeting.';
  const html = shell.emailShell({ preheader: line, eyebrow: 'Advisory Board', heading: 'You reached the goal', bodyHtml: para(line) + shell.button('Open your page', PAGE, 'primary', { big: true }) });
  const r = await sendEmails(env, { to: advisors.map((a) => a.email), from: FROM, subject: 'You reached the goal', html, text: `${line}\n\n${PAGE}`, replyTo: await replyTo(env, settings), tags: tag('advisory-update') });
  await remember(env.DB, { kind: 'goal-note', sent: r.sent });
  return r;
}

export function welcomeMessage(first, leadName = '') {
  const line = `Your Advisory Board page is ready. It has the next meeting, this month’s ask, how to help with the goal, and everyone in the group. Sign in with this email address: you’ll get a code, and there’s no password to remember.${leadName ? `\n\n${firstOf(leadName)} runs the group. If you have a question, just reply to this email.` : ''}`;
  return {
    subject: 'Your Advisory Board page is ready', text: `Hi ${first},\n\n${line}\n\n${PAGE}`,
    html: shell.emailShell({ preheader: 'Your Advisory Board page is ready.', eyebrow: 'Advisory Board', heading: `Welcome, ${first}`, bodyHtml: para(line) + shell.button('Open your page', PAGE, 'primary', { big: true }) }),
  };
}

/**
 * Added to the Advisory Board from their application: their welcome, now if they can sign in already, else as
 * soon as they can (the heartbeat sends it). With the Advisory Board's emails off it waits for them to be turned
 * on. → { sent } | { waiting, why: 'sign-in' | 'setup' | 'send' } | { off, queued } (the switch) | { already } | { noEmail }
 *   why 'sign-in': Cloudflare hasn't taken the list yet (minutes); 'setup': the sign-in isn't set up all the way
 *   (the Access key, or the policy on the admin's sign-in); 'send': the email service didn't take it
 */
export async function welcomeOnJoin(env, slug, { by = '', now = Date.now(), fetchImpl = fetch, greet = '' } = {}) {
  const settings = await getSettings(env.DB);
  const me = (await activeAdvisors(env.DB)).find((a) => a.slug === slug);
  if (hasOrGoing((await readState(env.DB, LOG)).welcomed?.[slug], now, me?.email)) return { already: true }; // (had it, or it's on its way)
  if (!me || !isEmail(me.email)) return { noEmail: true };
  const wait = () => setEntry(env.DB, 'waiting', slug, { at: new Date(now).toISOString(), by, ...(greet ? { greet } : {}) });
  if (!settings.emails) { await wait(); return { off: true, queued: true }; }
  // The sign-in list now, not at the next heartbeat: the email's link works the moment it lands
  if (!(await canSignIn(env, me.email))) await syncBoardAccess(env, { fetchImpl, now }).catch(() => null);
  let why = 'sign-in';
  if (await canSignIn(env, me.email)) {
    const r = await sendWelcome(env, { by, slugs: [slug], now, greet: greet ? { [slug]: greet } : {} });
    if (r.sent) { await removeEntry(env.DB, 'waiting', slug); return { sent: r.sent }; }
    // (two at once: the other one has it, or is sending it)
    if (hasOrGoing((await readState(env.DB, LOG)).welcomed?.[slug], now, me.email)) return { already: true };
    why = 'send'; // the email service didn't take it: the heartbeat tries again
  } else {
    // Not a matter of minutes: the sign-in itself isn't set up all the way (Board → Members says what's left)
    // (no Access key, or a sync that worked found the policy missing; Cloudflare briefly not answering is minutes)
    const a = await accessStatus(env).catch(() => null);
    if (a && (!a.configured || a.attached === false)) why = 'setup';
  }
  await wait();
  return { waiting: true, why };
}

/** The heartbeat: welcomes that waited for the sign-in to know them, sent once it does. Someone who left, or had theirs, comes off */
export async function sendWaitingWelcomes(env, { now = Date.now() } = {}) {
  const log = await readState(env.DB, LOG);
  const waiting = Object.keys(log.waiting || {});
  if (!waiting.length) return { sent: 0 };
  const settings = await getSettings(env.DB);
  if (!settings.emails) return { sent: 0, off: true }; // switched off meanwhile: they wait (switched on, they go)
  const on = await activeAdvisors(env.DB);
  const ready = [];
  for (const slug of waiting) {
    const me = on.find((a) => a.slug === slug);
    // (not on the Advisory Board now, or had it: comes off. On it with no working email yet: waits for staff to add one)
    if (!me || hadIt(log.welcomed?.[slug], me.email)) await removeEntry(env.DB, 'waiting', slug);
    else if (isEmail(me.email) && await canSignIn(env, me.email)) ready.push(slug);
  }
  // (each with the name it was written down with)
  const greet = Object.fromEntries(ready.map((slug) => [slug, log.waiting?.[slug]?.greet]).filter(([, g]) => g));
  const r = ready.length ? await sendWelcome(env, { by: 'the site', slugs: ready, now, greet }) : { sent: 0 };
  const after = await readState(env.DB, LOG);
  for (const slug of ready) if (hadIt(after.welcomed?.[slug], on.find((a) => a.slug === slug)?.email)) await removeEntry(env.DB, 'waiting', slug);
  return { sent: r.sent || 0, waiting: Object.keys((await readState(env.DB, LOG)).waiting || {}).length };
}

/**
 * Your page is ready: to those named, once each, who haven't had it. Each is claimed before theirs goes (a press
 * and the heartbeat at once never email anyone twice), marked had only once it went, and let go if it didn't, so
 * the next try sends it.
 */
export async function sendWelcome(env, { by = '', slugs = null, now = Date.now(), greet = {} } = {}) {
  const settings = await getSettings(env.DB);
  if (!settings.emails) return { off: true, sent: 0 };
  const advisors = (await activeAdvisors(env.DB)).filter((a) => isEmail(a.email) && (!slugs || slugs.includes(a.slug)));
  const mine = [];
  for (const a of advisors) if (await claimWelcome(env.DB, a.slug, now, a.email)) mine.push(a);
  if (!mine.length) return { sent: 0, failed: 0 };
  const lead = await leadOf(env, settings);
  const preferred = { ...(await preferredNames(env.DB)), ...greet };
  const at = new Date(now).toISOString();
  let sent = 0;
  let failed = 0;
  // (a batch goes, or fails, whole: one at most 100)
  for (let i = 0; i < mine.length; i += 100) {
    const chunk = mine.slice(i, i + 100);
    const r = await sendEmailItems(env, chunk.map((a) => ({ to: a.email, ...welcomeMessage(greetingFor(a, preferred), lead.name) })), { from: FROM, replyTo: lead.email, tags: tag('advisory-welcome') });
    if (r.sent) { sent += chunk.length; for (const a of chunk) await setEntry(env.DB, 'welcomed', a.slug, { at, to: plain(a.email) }); }
    else { failed += chunk.length; for (const a of chunk) await removeEntry(env.DB, 'welcomed', a.slug); }
  }
  await remember(env.DB, { kind: 'welcome', by, sent, failed }, now);
  return { sent, failed };
}
