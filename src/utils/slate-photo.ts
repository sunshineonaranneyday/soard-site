/**
 * slate-photo.ts — the starting-soon screen's photo, cut to its frame
 * ===================================================================
 * The frame is 796 × 540 on the 1920 × 1080 screen and 960 × 888 on the 1080 × 1920 one; each crop is about twice
 * that. SlateScreen.astro cuts the kid's photo this way, its script cuts a photo picked when the reveal was
 * scheduled the same way (setPhoto), and the server writes that picked photo into the screen before it goes out
 * (functions/live/[[path]].js), so all three ask for the same picture.
 */
export const SLATE_CROP = {
  landscape: 'w=1592,h=1080,fit=cover,gravity=face,q=88',
  portrait: 'w=1840,h=1702,fit=cover,gravity=face,q=88',
} as const;
