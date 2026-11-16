/**
 * functions/api/_bot-trap.js: the site's one bot trap, and the servers that read a form posted as it is.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRAP_NAME, TRAP_INPUT_ATTRS, trapHtml, trapFilled, trapValue } from '../functions/api/_bot-trap.js';

test('its name and label match nothing autofill or a password manager fills, and it carries each one’s "leave this alone" flag', () => {
  // The words Chrome, Safari and password managers fill boxes by
  assert.doesNotMatch(TRAP_NAME, /web|url|site|home|company|org|name|mail|phone|tel|addr|street|city|zip|postal|country|user|login|pass/i);
  for (const flag of ['data-1p-ignore', 'data-lpignore', 'data-bwignore', 'data-form-type']) assert.ok(flag in TRAP_INPUT_ATTRS, flag);
  assert.equal(TRAP_INPUT_ATTRS.tabindex, '-1');
  assert.equal(TRAP_INPUT_ATTRS.autocomplete, 'off');
  const html = trapHtml();
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /left:-10000px/);
  assert.doesNotMatch(html, /display:\s*none|visibility:\s*hidden|<[^>]*\shidden[\s>]/, 'laid out, never display:none or hidden (some bots skip those)');
  assert.match(html, /<label>Leave this empty <input [^>]*name="leave-this-empty"/);
});

test('trapFilled: a posted form or its boxes as an object, by its name now or an old one; a person’s empty box never counts', () => {
  const fd = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };
  for (const name of [TRAP_NAME, 'website', 'website2']) {
    assert.equal(trapFilled(fd({ email: 'a@b.co', [name]: 'http://spam' })), true, `form: ${name}`);
    assert.equal(trapFilled({ email: 'a@b.co', [name]: 'spam' }), true, `object: ${name}`);
  }
  for (const empty of [{}, { [TRAP_NAME]: '' }, { [TRAP_NAME]: '   ' }, { website: '' }, { [TRAP_NAME]: { a: 1 } }, null, undefined]) {
    assert.equal(trapFilled(empty), false, JSON.stringify(empty));
  }
  assert.equal(trapFilled(fd({ email: 'a@b.co', [TRAP_NAME]: '' })), false);
});

test('trapValue reads the trap in a form (and nothing when there’s none)', () => {
  const form = { querySelector: (sel) => (sel === '[data-bot-trap]' ? { value: '  filled ' } : null) };
  assert.equal(trapValue(form), 'filled');
  assert.equal(trapValue({ querySelector: () => null }), '');
  assert.equal(trapValue(undefined), '');
});

test('the newsletter’s own page (no script) and the profile form, posted with the trap filled: answered like a person, nothing done', async () => {
  const real = globalThis.fetch;
  let called = 0;
  globalThis.fetch = async () => { called++; throw new Error('nothing should be called'); };
  try {
    const { onRequestPost: newsletter } = await import('../functions/api/newsletter.js');
    const form = new FormData();
    form.append('email', 'bot@example.org');
    form.append(TRAP_NAME, 'http://spam');
    const res = await newsletter({ request: new Request('https://sunshineonaranneyday.com/api/newsletter', { method: 'POST', body: form, headers: { Origin: 'https://sunshineonaranneyday.com' } }), env: {}, waitUntil: () => {} });
    assert.ok(res.status === 303 || res.status === 302 || res.status === 200, `answered (${res.status})`);
    const { onRequestPost: profile } = await import('../functions/api/profile-request.js');
    const pf = new FormData();
    pf.append('token', 'x');
    pf.append(TRAP_NAME, 'spam');
    const pr = await profile({ request: new Request('https://sunshineonaranneyday.com/api/profile-request', { method: 'POST', body: pf }), env: {} });
    assert.deepEqual(await pr.json(), { ok: true });
  } finally { globalThis.fetch = real; }
  assert.equal(called, 0, 'Kit, Resend and the database never asked');
});
