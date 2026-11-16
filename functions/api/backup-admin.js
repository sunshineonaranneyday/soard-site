/**
 * Admin → Automations → Hosting → Backup: the backup Worker (soard-backup), through the BACKUP binding (_backup.js).
 *
 *   GET                                   → what the backup reports (backupFacts)
 *   POST { action: 'check' }              → checks every piece of its setup now
 *   POST { action: 'run' }                → starts a backup run now (refused while one is going)
 *   POST { action: 'recovery-sheet' }     → the backup key, to print: the backup itself records who asked and when
 *                                           (shown in the panel), and the admins are told in Slack
 *   POST { action: 'recovery-printed' }   → the sheet is printed and put away
 *
 * Not in _middleware's public list, so Access guards it, and changes must come from the admin itself.
 */
import { askBackup, backupFacts } from './_backup.js';
import { alertAdmins } from './_broadcast-notify.js';
import { readConfig } from './_broadcast.js';

const headers = { 'Cache-Control': 'private, no-store' };
const ok = (data) => Response.json({ success: true, ...data }, { headers });
// 500, not 502: Cloudflare replaces 502 bodies with its own error page
const fail = (error, status = 400) => Response.json({ success: false, error }, { status, headers });

export async function onRequestGet(context) {
  return ok(await backupFacts(context.env));
}

const ACTIONS = { check: 'check', run: 'run', 'recovery-sheet': 'recoverySheet', 'recovery-printed': 'recoveryPrinted' };

export async function onRequestPost(context) {
  const { env, request } = context;
  let body = {};
  try { body = await request.json(); } catch { return fail('Send JSON'); }
  const action = String(body.action || '');
  const method = ACTIONS[action];
  if (!method) return fail('Unknown action');
  const by = context.data?.userEmail || '';
  if (!by) return fail('Sign in to the admin first', 401);
  let result;
  try {
    result = await askBackup(env, method, action === 'check' ? undefined : { by });
  } catch (err) {
    return fail(err.message, 500);
  }
  if (action === 'recovery-sheet') {
    const note = alertAdmins(env, await readConfig(env.DB).catch(() => ({})), {
      level: 'info', icon: '🔑', title: 'The backup’s recovery key was opened',
      detail: `${by} opened the recovery sheet (the key that opens every backup) in Automations → Hosting → Backup to print it. If that wasn’t expected, say so in this channel.`,
    }).catch(() => {});
    if (typeof context.waitUntil === 'function') context.waitUntil(note); else await note;
  }
  return ok(result);
}
