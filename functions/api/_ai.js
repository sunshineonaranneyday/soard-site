/**
 * Every Workers AI call goes through the site's AI Gateway
 * ===========================================================================
 *   env.AI.run(MODEL, input, viaGateway('mail-sweep'))
 *
 * The gateway (Cloudflare → AI → AI Gateway → soard-site) counts this site's AI
 * apart from the store's, which shares the Cloudflare account, and caps it if
 * something ever loops: calls an hour for the site, dollars a day for the site
 * and for each feature, so one job running away can't stop the others. A call
 * past a cap throws, and aiCapped says that's what it was. A job working through
 * a queue waits (no try spent, a rest of AI_REST_MS) instead of recording the
 * email or paper as read, because the cap lifts by itself and the work is fine.
 *
 * `feature` is the name shown beside the numbers, so a jump in cost points at
 * what made it. It's the only thing kept: family emails, W-9s and board papers
 * go through these calls, so nothing is logged. The gateway's own log setting is
 * off, and collectLog says so again on each call, so a dashboard switch alone
 * can't start saving them. Caching stays off too: a re-read has to really read.
 *
 * tests/ai-gateway.test.mjs fails on a call that leaves this out.
 */

const GATEWAY_ID = 'soard-site';

/** How long a job leaves the AI alone after a cap turned it away: refused calls cost nothing, what comes before them can */
export const AI_REST_MS = 15 * 60 * 1000;
/** What a row waiting on the cap says */
export const AI_WAIT_NOTE = 'Waiting: Workers AI reached its spending cap, and this goes on when it lifts';

/** Cloudflare turned the call away at a cap: 2003 the gateway's calls an hour, 2045 a spend limit */
export const aiCapped = (err) => /^\s*(2003|2045):/.test(String(err?.message || ''));

export function viaGateway(feature) {
  return {
    gateway: { id: GATEWAY_ID, collectLog: false, metadata: { feature } },
    tags: [`${GATEWAY_ID}:${feature}`],
  };
}

// ─── The two picture readers ──────────────────────────────────────────

/**
 * The models that read pictures: checks and the letters beside them (_check-gifts.js), scanned scoresheets
 * (_score-scans.js), box labels at check-in (_kid-scan.js) and receipt photos (_mail-sweep.js). Two from different
 * makers, so one's habits can't fool both, neither one thinking: a picture needs reading, not reasoning, and a check is
 * read inside the heartbeat's 30 seconds.
 *
 * Nov 25 2026: Cloudflare retired Kimi K2.6 on Nov 20 ("5028: Model has been deprecated"), and from the next check on
 * every one waited on it. Qwen 3.8, the other, took 19 to 71 seconds on 5 of 11 test checks with its thinking on low (16
 * to 32 on 3 of 10 with it off), past the 24 a check gets. Tried on nine made-up checks (personal, business, cashier's,
 * donor-advised fund, a foundation "c/o", two photos, a faint one and a small grey scan), three times each, and a grant
 * letter: DeepSeek V4.1 Flash (thinking off) read every one right in 2 to 4 seconds, and Llama 4 Scout every one right
 * in under 10. Gemma 4 was as good but for one photo, where its JSON trailed off into blank space until it ran out of
 * tokens, all three times.
 */
export const READERS = {
  '@cf/deepseek-ai/deepseek-v4.1-flash-1017': { chat_template_kwargs: { enable_thinking: false } },
  '@cf/meta/llama-4-scout-17b-16e-instruct': {},
};

/**
 * Each reader's stand-in, from two more makers, for the day Cloudflare retires it: the reading goes on, and Slack hears
 * once that READERS needs a new model. One stand-in each, never one for both, so two readings are still two models.
 * Qwen 3.8 read every test check right, slowly (a check it doesn't finish in time waits without spending a try).
 * Mistral Small read all but the donor-advised fund's check right, fast; that one it took for a cashier's check, so
 * the two readers disagree and a person types the name
 */
export const SPARE_READERS = {
  '@cf/deepseek-ai/deepseek-v4.1-flash-1017': ['@cf/qwen/qwen3.8-27b', { chat_template_kwargs: { enable_thinking: false } }],
  '@cf/meta/llama-4-scout-17b-16e-instruct': ['@cf/mistralai/mistral-small-3.1-24b-instruct', {}],
};

/** Cloudflare saying a model is gone for good: retired (5028, "Model has been deprecated") or not there (5007, "No such model") */
export const modelGone = (err) => /\b50(07|28)\b|has been deprecated|no such model/i.test(String(err?.message || ''));

// A database → the retired readers already told in this isolate, so a stand-in's every call isn't a state read
const toldGone = new WeakMap();

/**
 * One reader's call: env.AI.run(model, input, gateway), with the caller's viaGateway. A reader Cloudflare has retired is
 * answered by its stand-in, with the stand-in's own settings in place of the reader's. Anything else is thrown as it came
 */
export async function runReader(env, model, input, gateway) {
  try {
    return await env.AI.run(model, input, gateway);
  } catch (e) {
    const spare = SPARE_READERS[model];
    if (!spare || !modelGone(e)) throw e;
    const [stand, settings] = spare;
    const rest = { ...input };
    for (const k of Object.keys(READERS[model] || {})) delete rest[k];
    const told = env?.DB ? toldGone.get(env.DB) || new Set() : null;
    if (told && !told.has(model)) {
      told.add(model);
      toldGone.set(env.DB, told);
      await tellGone(env, model, stand).catch(() => told.delete(model));
    }
    return env.AI.run(stand, { ...rest, ...settings }, gateway);
  }
}

/** Once for each retired reader (spend_state 'ai-readers'): the log, and Slack */
async function tellGone(env, model, stand) {
  console.error('[readers] Cloudflare retired', model, 'and', stand, 'reads in its place');
  const { readState, writeState } = await import('./_mercury.js');
  const st = await readState(env.DB, 'ai-readers');
  if (st.gone?.[model]) return;
  await writeState(env.DB, 'ai-readers', { gone: { ...(st.gone || {}), [model]: { at: new Date().toISOString(), stand } } });
  if (!env.SLACK_BOT_TOKEN) return;
  const [{ slackIssue }, { slackCard }] = await Promise.all([import('./_broadcast-notify.js'), import('./_slack-cards.js')]);
  const card = slackCard({
    icon: '🔎', title: 'Cloudflare retired one of the site’s picture readers',
    lead: `${model} no longer answers, so ${stand} reads in its place. Checks, receipts, box labels and scoresheets go on being read.`,
    fix: 'Nothing to do now. Tell Peter, so he can pick a lasting new reader (READERS in functions/api/_ai.js).',
  });
  await slackIssue(env, `readers:gone:${model}`, card, { title: 'Picture readers', kind: 'attention' });
}
