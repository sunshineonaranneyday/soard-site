/**
 * live-message-look.ts — how messages for the family look, for the server and the page alike
 * ==========================================================================================
 * Each message carries its writer's first letter in a circle (LiveMessages.astro), in one of five
 * of the brand's colours picked from the name, so the same writer always gets the same one. On a
 * phone, the newest message also shows in one line under the video. The server draws the messages
 * so far and that line into the page (functions/live/[[path]].js) and the page script draws what
 * comes in (live-messages.ts): both ask here, so they match.
 */

/** The first whole character a person would see: a flag, an emoji with its skin tone, a letter with its accent */
function firstGrapheme(s: string): string {
  if (!s) return '';
  try {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    for (const { segment } of seg.segment(s)) return segment;
  } catch { /* no Segmenter: by code point below */ }
  return Array.from(s)[0] || '';
}

/** The writer's first letter, capital (the same capital in every language's browser: no locale) */
export function messageInitial(name: string): string {
  return firstGrapheme(String(name ?? '').trim().normalize('NFC')).toUpperCase();
}

/** Which of the five colours (0 to 4): the name's length in characters, so it's the same everywhere */
export function messageTone(name: string): number {
  return Array.from(String(name ?? '').trim()).length % 5;
}

/** The heart in the newest-message line when nobody has written yet */
export const LATEST_HEART = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>';

export interface LatestLine {
  /** What the line stands for: the newest message's id, or the invitation to be first */
  id: string;
  /** The circle: the writer's letter (text), or the heart (html) for the invitation */
  initial: string | null;
  heart: boolean;
  tone: number;
  name: string;
  text: string;
  label: string;
}

/**
 * The newest-message line under the video on a phone (LiveMessages.astro): the newest message, or while there's
 * none and the box is open, an invitation to be the first. Null: no line.
 */
export function latestLine(kidName: string | null, newest: { id: string; name: string; body: string } | null, open: boolean): LatestLine | null {
  if (newest) {
    return {
      id: newest.id, initial: messageInitial(newest.name), heart: false, tone: messageTone(newest.name),
      name: newest.name, text: newest.body, label: `Newest message, from ${newest.name}: ${newest.body}. See every message`,
    };
  }
  if (!open) return null;
  const kid = String(kidName || '').trim();
  return {
    id: `first:${kid}`, initial: null, heart: true, tone: 0, name: '',
    text: kid ? `Be the first to write to ${kid}'s family` : 'Be the first to leave a message', label: 'Be the first to leave a message',
  };
}
