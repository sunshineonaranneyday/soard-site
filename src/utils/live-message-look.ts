/**
 * live-message-look.ts — how one message for the family looks, for the server and the page alike
 * ===============================================================================================
 * Each message carries its writer's first letter in a circle (LiveMessages.astro), in one of five
 * of the brand's colours picked from the name, so the same writer always gets the same one. The
 * server draws the messages so far into the page (functions/live/[[path]].js messageHtml) and the
 * page script draws the ones that come in (live-messages.ts add): both ask here, so they match.
 */

/** The writer's first letter (a whole character, so an accented letter or an emoji isn't cut in half) */
export function messageInitial(name: string): string {
  const first = Array.from(String(name ?? '').trim())[0] || '';
  return first.toLocaleUpperCase();
}

/** Which of the five colours (0 to 4): the name's length in characters, so it's the same everywhere */
export function messageTone(name: string): number {
  return Array.from(String(name ?? '').trim()).length % 5;
}
