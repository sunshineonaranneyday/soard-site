/**
 * A Stream video plays in the page's own <video>, started by the tap, only in Apple's WebKit
 * (src/utils/stream-in-page.ts; Peter, Nov 19 2026: reveals spun on his iPhone in Stream's iframe).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';

const code = buildSync({ entryPoints: ['src/utils/stream-in-page.ts'], bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'silent' }).outputFiles[0].text;
const mod = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

const UID = '99fc2ba0c84823eb6fb0f7cda795e837';

function fakeBrowser({ vendor, hls }) {
  const made = [];
  Object.defineProperty(globalThis, 'navigator', { value: { vendor }, configurable: true, writable: true });
  globalThis.document = {
    createElement(tag) {
      const el = {
        tag, attrs: {}, style: {}, played: 0,
        canPlayType: (t) => (hls && t === 'application/vnd.apple.mpegurl' ? 'maybe' : ''),
        setAttribute(k, v) { this.attrs[k] = v; },
        play() { this.played++; return Promise.resolve(); },
      };
      made.push(el);
      return el;
    },
  };
  return made;
}

test('the video id is read from both Stream player addresses, nothing else', () => {
  assert.equal(mod.streamIdFromEmbed(`https://customer-cuav5h47lgfe96ql.cloudflarestream.com/${UID}/iframe?autoplay=true`), UID);
  assert.equal(mod.streamIdFromEmbed(`https://iframe.videodelivery.net/${UID}?autoplay=true&preload=true`), UID);
  assert.equal(mod.streamIdFromEmbed(`https://iframe.videodelivery.net/${UID}`), UID);
  assert.equal(mod.streamIdFromEmbed('https://www.youtube-nocookie.com/embed/OBa-SEM0bZA?autoplay=1'), null);
  assert.equal(mod.streamIdFromEmbed(`https://evil.example/${UID}/iframe`), null);
  assert.equal(mod.streamIdFromEmbed(`https://iframe.videodelivery.net/${UID}x`), null);
});

test('iPhone (Apple WebKit, plays HLS itself): placed and played in the same call, with controls and inline', () => {
  fakeBrowser({ vendor: 'Apple Computer, Inc.', hls: true });
  let placed = null;
  const ok = mod.playStreamInPage(UID, "Dylan's room reveal video", (v) => { placed = v; assert.equal(v.played, 0, 'placed before play'); });
  assert.equal(ok, true);
  assert.ok(placed);
  assert.equal(placed.played, 1);
  assert.equal(placed.src, `https://customer-cuav5h47lgfe96ql.cloudflarestream.com/${UID}/manifest/video.m3u8`);
  assert.equal(placed.controls, true);
  assert.equal(placed.playsInline, true);
  assert.equal(placed.attrs.playsinline, '');
  assert.equal(placed.attrs['aria-label'], "Dylan's room reveal video");
  assert.match(placed.poster, /\/thumbnails\/thumbnail\.jpg$/);
});

test('Chrome, Android, Firefox (not Apple WebKit) keep the iframe: nothing placed', () => {
  for (const b of [{ vendor: 'Google Inc.', hls: true }, { vendor: 'Google Inc.', hls: false }, { vendor: '', hls: false }]) {
    fakeBrowser(b);
    let placed = false;
    assert.equal(mod.playStreamInPage(UID, 'x', () => { placed = true; }), false);
    assert.equal(placed, false);
  }
});

test('a bad or missing id never builds a player', () => {
  fakeBrowser({ vendor: 'Apple Computer, Inc.', hls: true });
  for (const id of [undefined, null, '', 'abc', `${UID}/../x`]) {
    assert.equal(mod.playStreamInPage(id, 'x', () => assert.fail('placed')), false);
  }
});
