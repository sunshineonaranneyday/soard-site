/**
 * /api/past-jobs-admin — past makeovers and community projects as closed JobTread jobs (Admin → Kids)
 * ===========================================================================
 * GET                                   → { success, rows, summary, imported, planned, first, queued, lastRun }  (D1 only)
 * POST { action: 'import', rows }       → loads the reviewed list (new rows added; rows not made yet take its dates)
 * POST { action: 'plan' }               → reads JobTread and the site again and saves each row's plan (JobTread is only read)
 * POST { action: 'checks' }             → QuickBooks' project setting and JobTread's active workflows (read only)
 * POST { action: 'answer', key, accountId | account: 'new' | clear } → a person's pick for a row with several customers
 * POST { action: 'first' }              → makes the first job alone, to check JobTread's workflows, QuickBooks and DataX
 * POST { action: 'rest' }               → queues every ready row; the application sweep makes a few each run
 *
 * See ./_past-jobs.js. Founders only (People → Team), like the Drive and mail readers; never cached.
 */

import { canRead } from './_mailbox.js';
import { checkImport, importRows, planAll, answerRow, makeFirst, queueRest, pastJobsStatus, readQuickBooks, readWorkflows } from './_past-jobs.js';

const headers = { 'Cache-Control': 'private, no-store' };
const reply = (body, status = 200) => Response.json(body, { status, headers });
const FOUNDERS_ONLY = 'Past jobs in JobTread are open only to the founders on People → Team';

export async function onRequestGet(context) {
  const { env } = context;
  try {
    if (!(await canRead(env, context.data?.userEmail || ''))) return reply({ success: false, error: FOUNDERS_ONLY }, 403);
    return reply({ success: true, ...(await pastJobsStatus(env.DB)) });
  } catch (err) {
    // 500, not 502: Cloudflare replaces 502 bodies with its own error page
    return reply({ success: false, error: err.message }, err.status || 500);
  }
}

export async function onRequestPost(context) {
  const { env } = context;
  const by = context.data?.userEmail || null;
  try {
    if (!(await canRead(env, by || ''))) return reply({ success: false, error: FOUNDERS_ONLY }, 403);
    const body = await context.request.json().catch(() => null);
    switch (body?.action) {
      case 'import': {
        const checked = checkImport(body);
        if (!checked.ok) return reply({ success: false, error: checked.error || checked.errors.slice(0, 5).join('; ') }, 400);
        return reply({ success: true, ...(await importRows(env.DB, checked.rows, { by })) });
      }
      case 'plan':
        return reply({ success: true, ...(await planAll(env)) });
      case 'checks': {
        const [quickbooks, workflows] = await Promise.all([readQuickBooks(env.JOBTREAD_GRANT_KEY), readWorkflows(env.JOBTREAD_GRANT_KEY)]);
        return reply({ success: true, quickbooks, workflows });
      }
      case 'answer': {
        const r = await answerRow(env.DB, body, { by });
        return r.ok ? reply({ success: true }) : reply({ success: false, error: r.error }, 400);
      }
      case 'first': {
        const r = await makeFirst(env, { by });
        return r.ok ? reply({ success: true, made: r.made }) : reply({ success: false, error: r.error, key: r.key || null }, 409);
      }
      case 'rest': {
        const r = await queueRest(env, { by });
        return r.ok ? reply({ success: true, queued: r.queued, summary: r.summary }) : reply({ success: false, error: r.error }, 409);
      }
      default:
        return reply({ success: false, error: 'Which action?' }, 400);
    }
  } catch (err) {
    return reply({ success: false, error: err.message }, err.status || 500);
  }
}
