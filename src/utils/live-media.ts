/**
 * live-media.ts — which layout the live page is in, one definition for every part of it
 * =====================================================================================
 * The live page's parts (LivePage, LiveStage, LiveDesignRail, LiveDesign, LiveMessages,
 * LiveGive and their scripts) all switch on the same three questions. CSS can't import
 * these, so each @media there repeats the query word for word, with a note pointing here:
 * change one, change them all.
 *
 * PHONE  the phone layout: up to 960px wide, or a touch screen up to 1023px wide held
 *        sideways (the biggest Android phones turned sideways are about 1000px wide; no
 *        phone is 1024, and every tablet held sideways is, so a tablet whose keyboard
 *        leaves its page short never flips into the phone layout). Also the biggest tablets
 *        held upright (a 13-inch iPad is 1024 or 1032 wide and over 1200 tall): a big phone,
 *        like every smaller tablet held upright (Peter, Nov 21 2026: his 13-inch iPad should
 *        show the large-phone layout too). No laptop window is 1200 tall at 1100 wide or less,
 *        and a screen that tall at that width is upright, so laptops and a tablet held
 *        sideways keep their layout
 * DESK   everything else: the laptop layout
 * UPRIGHT everything that isn't SIDE (below)
 * SIDE   a phone held sideways: at least 7:4, at most 540px tall and at least 560px wide.
 *        Wide, not only "landscape": every phone held sideways is 1.78:1 or wider (an
 *        iPhone SE's 667×375) and at least 568px wide (the first SE's), while no phone held
 *        upright is 560px wide. So an on-screen keyboard that shrinks an upright phone's page
 *        (Android in-app browsers do), however short it leaves it, never flips the page
 *        sideways
 */
export const PHONE = '(max-width: 960px), (pointer: coarse) and (min-aspect-ratio: 7/4) and (max-height: 540px) and (max-width: 1023px), (min-width: 961px) and (max-width: 1100px) and (min-height: 1200px)';
export const DESK = '(min-width: 1101px), (min-width: 961px) and (max-height: 1199px) and (pointer: fine), (min-width: 961px) and (max-height: 1199px) and (pointer: none), (min-width: 961px) and (max-height: 1199px) and (min-height: 541px), (min-width: 961px) and (max-height: 1199px) and (max-aspect-ratio: 1749/1000), (min-width: 1024px) and (max-height: 1199px)';
export const SIDE = '(min-aspect-ratio: 7/4) and (max-height: 540px) and (min-width: 560px) and (max-width: 960px), (min-aspect-ratio: 7/4) and (max-height: 540px) and (min-width: 560px) and (max-width: 1023px) and (pointer: coarse)';
/** PHONE_UPRIGHT  the phone layout, held upright (PHONE without SIDE): the box to write a message is docked at the
 *  bottom of the screen during the watch party (LiveMessages) */
export const PHONE_UPRIGHT = '(max-width: 559px), (max-width: 960px) and (max-aspect-ratio: 1749/1000), (max-width: 960px) and (min-height: 541px), (min-width: 961px) and (max-width: 1100px) and (min-height: 1200px)';
/** UPRIGHT  everything but SIDE (a laptop, a tablet, a phone held upright), as a query of its own: where the live
 *  controls can go in a rail beside an upright picture, which the server draws before any script runs (LiveStage) */
export const UPRIGHT = '(max-width: 559px), (max-aspect-ratio: 1749/1000), (min-height: 541px), (min-width: 1024px), (min-width: 961px) and (pointer: fine), (min-width: 961px) and (pointer: none)';

/** A text field: while one has focus on a phone, its on-screen keyboard is up (LivePage holds the frame's height, the
 *  corner player steps aside) */
export const typingIn = (el: Element | null): boolean =>
  !!el?.matches?.('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]), textarea, [contenteditable="true"]');
