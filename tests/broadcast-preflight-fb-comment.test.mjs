/**
 * The go/no-go says, before a reveal, whether the Facebook token can post the Page's first comment (the website link)
 * on the live post. At Max's go-live (Nov 20 2026) the token had no comment permissions; Facebook refused the
 * comment and nothing had said so beforehand (Peter, Nov 21 2026: yes to adding it to the 10-minute check).
 * Run: node --test tests/broadcast-preflight-fb-comment.test.mjs
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';

const BASE_SCOPES = ['publish_video', 'pages_show_list', 'business_management', 'pages_read_engagement', 'pages_manage_posts', 'public_profile'];
const fake = { scopes: BASE_SCOPES, debugFails: false, calls: [] };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input?.url || input?.href || input);
  fake.calls.push(url);
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
  if (url.startsWith('https://graph.facebook.com/')) {
    const path = new URL(url).pathname;
    if (path.endsWith('/debug_token')) {
      if (fake.debugFails) return json({ error: { message: 'An unexpected error has occurred.', code: 2 } }, 500);
      return json({ data: { is_valid: true, type: 'PAGE', app_id: '307', expires_at: 0, scopes: fake.scopes } });
    }
    if (path.endsWith('/123')) return json({ id: '123', name: 'Sunshine on a Ranney Day', link: 'https://www.facebook.com/SunshineOnaRanneyDay' });
    return json({ data: [] });
  }
  return new Response('not mocked: ' + url, { status: 599 });
};
after(() => { globalThis.fetch = realFetch; });

let env, preflight, fb;
before(async () => {
  const DB = await createD1({ schemaFiles: ['scripts/schema.sql'] });
  env = { DB, FB_PAGE_ID: '123', FB_PAGE_TOKEN: 'fbtok' };
  preflight = await import('../functions/api/_broadcast-preflight.js');
  fb = await import('../functions/api/_broadcast-fb.js');
});

const run = (mode) => preflight.run(env, { facebook: { mode } }, { phase: 'scheduled', title: 'Remi', kidSlug: 'remi', kidName: 'Remi' }, {});
const item = (r, key) => r.items.find((i) => i.key === key);

test('a token without the comment permissions is a warning at the go/no-go, naming both and the fix', async () => {
  fake.scopes = BASE_SCOPES;
  const r = await run('api');
  const c = item(r, 'facebookComment');
  assert.ok(c, 'the comment is checked in API mode');
  assert.equal(c.status, 'warn');
  assert.match(c.detail, /pages_manage_engagement and pages_read_user_content/);
  assert.match(c.detail, /live post still goes up/);
  assert.match(c.fix, /FB_PAGE_TOKEN/);
  assert.equal(item(r, 'facebookToken').status, 'ok', 'the token itself still works');
  // It shows in the Slack post and the staff text, as the 10-minute check posts them
  const post = preflight.slackText(r, { title: 'Remi' }, {});
  assert.match(post.detail, /Facebook won't take the website link comment/);
  // The staff text names failures first; on a day where the rest passes (here Stream and Slack aren't set up), it names this
  const otherwiseGreen = { ...r, items: r.items.filter((i) => i.status !== 'fail'), counts: { ...r.counts, fail: 0 }, ready: true };
  assert.match(preflight.textLine(otherwiseGreen), /Check: .*Facebook won't take the website link comment/);
  assert.equal(preflight.slackText(otherwiseGreen, { title: 'Remi' }, {}).title, 'Go, with notes: Remi', 'a go, with a note, never a no-go');
});

test('one of the two missing is named alone', async () => {
  fake.scopes = [...BASE_SCOPES, 'pages_manage_engagement'];
  const c = item(await run('api'), 'facebookComment');
  assert.equal(c.status, 'warn');
  assert.match(c.detail, /missing pages_read_user_content\./);
  assert.doesNotMatch(c.detail, /pages_manage_engagement/);
});

test('a token with both passes', async () => {
  fake.scopes = [...BASE_SCOPES, 'pages_manage_engagement', 'pages_read_user_content'];
  const c = item(await run('api'), 'facebookComment');
  assert.equal(c.status, 'ok');
  assert.equal(c.label, 'The Page can comment the website link on the live post');
});

test('with the persistent key there is no comment, so no check', async () => {
  fake.scopes = BASE_SCOPES;
  const from = fake.calls.length;
  assert.equal(item(await run('persistent'), 'facebookComment'), undefined);
  assert.equal(fake.calls.slice(from).filter((u) => u.includes('/debug_token')).length, 0, 'no token lookup for it');
});

test('if Facebook can\'t say what the token holds, the check says nothing rather than guess', async () => {
  fake.debugFails = true;
  try {
    const r = await run('api');
    assert.equal(item(r, 'facebookComment'), undefined);
    assert.equal(item(r, 'facebookToken').status, 'ok');
  } finally { fake.debugFails = false; }
});

test('the token info lists what the comment is missing, for the admin\'s Facebook test too', async () => {
  fake.scopes = BASE_SCOPES;
  assert.deepEqual((await fb.fbTokenInfo(env)).missingForComment, ['pages_manage_engagement', 'pages_read_user_content']);
  fake.scopes = [...BASE_SCOPES, ...fb.FB_COMMENT_SCOPES];
  assert.deepEqual((await fb.fbTokenInfo(env)).missingForComment, []);
});
