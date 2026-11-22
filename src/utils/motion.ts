/**
 * motion.ts: the live page's four speeds and two curves, for animations the scripts play (Web Animations, inline
 * transitions). The same values as --m-* in src/styles/global.css: change one, change both. Quick: a press, a hover;
 * short: a small move or fade; medium: a panel, the room's pictures opening, the corner video; long: what enters the
 * page. Move: what travels or grows; fade: colour and opacity.
 */
export const MOTION = {
  quick: 150,
  short: 250,
  medium: 350,
  long: 500,
  move: 'cubic-bezier(0.16, 1, 0.3, 1)',
  fade: 'cubic-bezier(0.4, 0, 0.2, 1)',
  /** a press's small spring: a button, the heart, the corner video let go */
  pop: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
} as const;
