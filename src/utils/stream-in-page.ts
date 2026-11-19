/**
 * stream-in-page.ts: a Cloudflare Stream video played in the page's own <video>, started by the tap that asked for it.
 *
 * Why (Peter, Nov 19 2026: "on mobile the reveals won't play, they just spin"): every "press play" on the site used
 * to put Stream's player in an iframe with autoplay. The tap lands on our page, not inside that iframe, and Safari
 * doesn't hand a tap on to a frame, so on an iPhone the video could only start under Safari's autoplay rules, which
 * change from phone to phone (Low Power Mode, Low Data Mode, the site's Auto-Play setting): a spinner or a second
 * play button instead of the video. play() on our own element inside the tap is always allowed, with sound.
 *
 * Only in Apple's WebKit (every browser on an iPhone or iPad, and Safari on a Mac), which plays Stream's HLS itself
 * (sound as its own rendition, captions in its own menu): the same path the live page's replay takes on iPhones.
 * Elsewhere this returns false and the caller keeps Stream's iframe, which gets the tap there through
 * allow="autoplay" (Chrome, Edge, Android).
 */

const STREAM_HOST = 'https://customer-cuav5h47lgfe96ql.cloudflarestream.com';
const UID_RE = /^[a-f0-9]{32}$/;

/** The Stream video id in one of our player addresses (customer host /<id>/iframe, or iframe.videodelivery.net/<id>) */
export function streamIdFromEmbed(url: string): string | null {
  const m = url.match(/^https:\/\/(?:customer-[a-z0-9]+\.cloudflarestream\.com\/([a-f0-9]{32})\/iframe|iframe\.videodelivery\.net\/([a-f0-9]{32}))(?:[/?#]|$)/);
  return m ? (m[1] || m[2]) : null;
}

function playsHlsItself(video: HTMLVideoElement): boolean {
  return /^Apple/.test(navigator.vendor || '') && !!video.canPlayType('application/vnd.apple.mpegurl');
}

/**
 * Call inside the click/keydown handler, before any await. Builds the <video>, hands it to `place` to put in the
 * page (where the iframe would have gone; it fills its box like the iframe did), and plays it. False when this
 * browser should keep Stream's iframe; nothing is placed then.
 */
export function playStreamInPage(uid: string | undefined | null, title: string, place: (video: HTMLVideoElement) => void): boolean {
  if (!uid || !UID_RE.test(uid)) return false;
  const video = document.createElement('video');
  if (!playsHlsItself(video)) return false;
  video.controls = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.preload = 'auto';
  video.setAttribute('aria-label', title);
  video.poster = `${STREAM_HOST}/${uid}/thumbnails/thumbnail.jpg`;
  video.src = `${STREAM_HOST}/${uid}/manifest/video.m3u8`;
  video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;object-fit:contain;background:#000';
  place(video);
  // Refused only if the tap didn't count (never seen); the video's own play button is there then
  video.play()?.catch(() => {});
  return true;
}

/** Stop and unload any in-page video under `root` (before removing it, so it stops downloading too) */
export function stopVideos(root: ParentNode): void {
  root.querySelectorAll('video').forEach((v) => {
    v.pause();
    v.removeAttribute('src');
    v.load();
  });
}
