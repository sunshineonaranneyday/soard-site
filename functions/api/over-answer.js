/**
 * POST /api/over-answer: a tap on "Yes, it's over" or "No, the signal dropped" on /over/<token>
 * ===========================================================================
 * Public (the token in the link is the key; checked inside, ./_over-page.js), refused from another site, rate
 * limited in the middleware. The answer goes through answerByText exactly as a Y or N text does.
 */

import { postOverAnswer } from './_over-page.js';

export async function onRequestPost(context) {
  return postOverAnswer(context);
}
