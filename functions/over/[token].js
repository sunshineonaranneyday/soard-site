/**
 * GET /over/<token>: the tap-to-answer page linked from "Is the reveal over?" texts (functions/api/_over-page.js).
 * Public (staff open it from the text on their phones), read only: the buttons post to /api/over-answer.
 */

import { getOverPage } from '../api/_over-page.js';

export async function onRequestGet(context) {
  return getOverPage(context.env, context.params?.token);
}
