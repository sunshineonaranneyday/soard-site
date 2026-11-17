/** The READ ME FIRST at the top of each backup home: what's there and how to put it back, for whoever needs it */

export const README_NAME = 'READ ME FIRST - how to restore.txt';
export const README_VERSION = 7;

/** The commands that put the code back, exactly as the READ ME gives them (the tests run these very lines) */
export const CODE_STEPS = [
  'age -d -i key.txt "<the month\'s full copy>.bundle.age" > full.bundle',
  'git clone full.bundle site',
  'age -d -i key.txt "<a later night\'s copy>.bundle.age" > night.bundle',
  'git -C site fetch ../night.bundle "+refs/heads/*:refs/heads/*" "+refs/tags/*:refs/tags/*" --update-head-ok',
  'git -C site reset --hard',
];

export function readme({ fingerprint, databases, repos, home }) {
  return `READ ME FIRST: how to restore Sunshine on a Ranney Day's website and store from this backup

This ${home} holds a copy of everything SOARD keeps on Cloudflare. A program called soard-backup (a Cloudflare
Worker) adds to it every night by itself. Nothing here is ever changed or deleted by it: each night adds new files.
The same files are kept in two places: a Google shared drive (its name has "backup" in it) and a locked Backblaze
B2 bucket, where nobody can change or delete them during the lock. (In the drive the backup's account can't delete
anything, but a drive member could add a new version of a file, so if a file here ever won't open, take Backblaze's.)

WHAT IS HERE

  Database/            Each database, whole, as it was at one moment of the night, every value exact:
                       ${databases.map((d) => `${d.label} (Cloudflare D1 "${d.name}")`).join(', ')}, and any other
                       database made on the account later, under its own name.
                       Each night has the copy (.sql.gz.age) and a manifest (.json) listing every table,
                       its row count and a fingerprint of its rows. A copy someone asked for by hand during the
                       day has the time after the date (2026-11-14 1530).
  Cloudflare settings/ Domains and DNS records (zone files any DNS host can import), redirects and other rules,
                       the admin sign-in rules (Access), Pages and Workers settings, R2 buckets. No keys or passwords.
  Code/                The code with all its history, as git bundles: ${repos.join(', ')}.
                       The first copy each month is complete; other nights hold only what changed since.
  Files/               Every photo (Cloudflare Images), video (Stream) and file (R2), each named by a code, never by its
                       id or name, so nothing here says whose it is: each run's list in Files/Lists (encrypted)
                       says what each code is and where it came from.
  KV/                  Every KV namespace (a small key-value store a Worker uses), in parts, as the very file
                       \`wrangler kv bulk put\` takes back, with a manifest naming the file that holds each part.
  Vectorize/           Every Vectorize index (the store's product search), in parts, as the very file
                       \`wrangler vectorize insert\` takes back, with a manifest; copied whenever the index changes.
  Workers/             The code each Worker on the account runs, as Cloudflare holds it (one file of its modules),
                       with a .json naming its main module; copied whenever it changes, whether or not it's in a
                       repository.
  Nights/              One short summary per night. Each says what the account held that night and what was
                       copied; anything on the account that isn't copied is named in it, with why.
  Restore drills/      Every week (and after any drill that didn't pass, until one does) the backup restores that
                       run's database copies into a spare database and checks every table, byte for byte, and
                       opens a few files and the code. The reports are here.

WHAT ISN'T HERE, AND WHERE IT IS

  The domains          Registered at Cloudflare (Registrar) on the very account this backup copies. If the account is
                       lost, getting it back through Cloudflare's support comes first: the domains (and so the
                       website's address and staff email) can only be pointed anywhere from there. Cloudflare
                       doesn't let the backup's key read the registrations (it is the account's own key, so it
                       belongs to no one person, and Cloudflare's table of what such keys can use leaves Registrar
                       out), so see when each ends, and whether it renews, on Cloudflare: Domain Registration.
  Page rules           Cloudflare's older kind of rule, which the same table leaves out: the key can't read them.
                       Cloudflare is moving them into Rules, which are copied (each domain's redirects and the
                       rest). Make any new rule a Rule, not a page rule, and it is in the copy.
  Anything kept as a   Cloudflare never gives back the value of anything stored as a secret, so no backup can hold
  secret               it: the keys and passwords, and also some settings kept that way though they are not
                       passwords (email addresses the store's admin lets in, where alerts go, IDs). The settings copy
                       names every one; their values must be kept somewhere safe outside Cloudflare (a password
                       manager) to be put back. A setting kept as a plain variable is in the copy, value and all.
  Durable Objects      The working memory of a few Workers, which only that Worker can read. Each night's summary in
                       Nights/ names every one and where its data is kept instead (the live show's totals, for
                       one, are in the website's database).
  Logs                 Cloudflare's logs of what ran (Workers, AI Gateway): a record of the moment, not SOARD's own
                       records, which are all in the copies here.
  Anything else        If something is ever on the account that the backup can't copy, its nightly summary names it
                       and the admin is told.

THE KEY

Everything except this file, the nights, the drill reports, the manifests and the Workers' .json files is encrypted with age
(https://age-encryption.org). To open it you need SOARD's backup key: the line that starts with
AGE-SECRET-KEY-PQ-1 on the printed recovery sheet. Its check code is ${fingerprint}; the sheet shows the same
code, so you can tell it's the right one. Without the key these files can't be opened by anyone.

  1. Install age, version 1.3 or newer: https://github.com/FiloSottile/age (on a Mac: brew install age).
  2. Download the files you need into a folder on the computer that doesn't sync anywhere (Downloads, usually):
     never inside Google Drive's own folder, Dropbox, OneDrive or iCloud (on a Mac the Desktop and Documents folders
     often sync to iCloud). An opened file is plain, and must never go back into the drive.
  3. In that same folder, type the key into a file named key.txt, all on one line, with no spaces. Delete key.txt
     and the opened files once everything is back.
  4. Open any file:   age -d -i key.txt "the file.age" > "the file"

PUT THE DATABASE BACK

  1. Download the night's copy and its manifest from Database/<name>/<year>/.
  2. age -d -i key.txt "2026-11-14 soard-db.sql.gz.age" | gunzip > restore.sql
  3. Make a new, EMPTY D1 database in Cloudflare, then run:
       npx wrangler d1 execute <its name> --remote --file restore.sql
     (For a copy on a computer instead: sqlite3 restored.sqlite < restore.sql)
  4. Point the website at it: in the website's code, wrangler.toml, set database_id under DB to the new database's id.
  The website's own tool does steps 2 and 3's checking for you: in its code (github.com/sunshineonaranneyday/
  soard-site), with Node 22.13 or newer: cd workers/backup, npm ci, then
       node scripts/restore.mjs database "<the download folder>" --key "<the download folder>/key.txt" --check
  (always with the download folder's whole path: key.txt stays there, never in the code's folder)
  It checks the copy is the one its manifest names, opens it, writes restore.sql, builds it on the computer and
  compares every table with the manifest.

PUT THE CODE BACK

  From the month's full copy, then each later night's copy of that month, oldest first:
${CODE_STEPS.map((s) => `     ${s}`).join('\n')}
  (repeat the last three lines for each later night). The folder named site then holds the code as it was.

PUT A KV NAMESPACE BACK

  Uses the website's own tool: in its code (github.com/sunshineonaranneyday/soard-site, or Code/ here), with Node
  22.13 or newer: cd workers/backup, then npm ci (it brings the very wrangler these steps were checked with). Run
  these from that folder.
  1. Open the newest manifest in KV/<name>/: in the newest year's folder, the one written last (sort the folder by
     date; each also says when it was "written"). It names the file of each part, wherever it is, and its count of
     keys.
  2. Make the new namespace:   npx wrangler kv namespace create <name>      (it prints the new namespace's id)
  3. For each part the manifest names, one at a time:
       node scripts/restore.mjs kv "<the download folder>/<the part's file>" --key "<the download folder>/key.txt"
     It opens the part into a file beside it ending in " ready.json" (or several, " ready 1.json" and on, when it's
     more than Cloudflare takes at once), leaving out any key whose expiry has passed, and prints each file's name
     and the command that puts it in:
       npx wrangler kv bulk put "<that ready.json>" --namespace-id <the new namespace's id> --remote
     A key whose metadata isn't a JSON object (wrangler won't take one) goes into a file ending in " for the API.json"
     instead, and the tool prints the one command that sends it to Cloudflare's own API.
  4. Point the Worker that used it at the new namespace (the Cloudflare settings copy names its binding).

PUT A VECTORIZE INDEX BACK

  1. Open the newest manifest in Vectorize/<name>/: in the newest year's folder, the one written last (sort the
     folder by date; each also says when it was "written"). It names the index's dimensions and metric, its
     metadata indexes and every file of the copy (none, if the index was empty).
  2. Make the index:   npx wrangler vectorize create <name> --dimensions <its dimensions> --metric <its metric>
  3. Before any vector goes in, each metadata index the manifest names:
       npx wrangler vectorize create-metadata-index <name> --propertyName <its propertyName> --type <its indexType>
  4. For each part the manifest names, one at a time:
       age -d -i key.txt "<the part's file>" | gunzip > "part 1.ndjson"     (part 2.ndjson for the second, and so on)
       npx wrangler vectorize insert <name> --file "part 1.ndjson"

PUT A WORKER BACK

  A Worker whose code is in a repository (soard-backup and soard-live-hub are in the website's, under workers/) goes
  back from there, as its wrangler.toml says: npx wrangler deploy in its folder. For any other:
  1. In Workers/<name>/, take its newest code file (.age) and the .json beside it: the .json names its main module.
  2. age -d -i key.txt "<the code file>" > worker.code
  3. With the website's tool (see KV above):  node scripts/restore.mjs worker worker.code <a new folder>
     (writes each of its files into the folder, as it ran).
  4. In that folder write a wrangler.toml from the Cloudflare settings copy, then npx wrangler deploy:
       name, and main = the main module the .json names
       under workers, by its name: compatibility_date and compatibility_flags, limits (cpu_ms, subrequests),
         observability, placement, its schedules ([triggers] crons), and each binding (a plain variable with its
         value; a D1, R2, KV, service or Durable Object binding by its name; a workflow binding as a [[workflows]]
         block); workersDev there says workers_dev (enabled) and preview_urls (previews_enabled)
       its routes: under zones, each domain's workerRoutes, as routes = [{ pattern = "...", zone_name = "..." }]
       its own domains: under workerDomains, as routes = [{ pattern = "<the domain>", custom_domain = true }]
       each Durable Object it holds: under durableObjects (use_sqlite true means new_sqlite_classes in
         [[migrations]], false means new_classes)
     Its secrets (bindings of type secret_text) come from where each is kept (see WHAT ISN'T HERE), added with
     npx wrangler secret put <its name>.

PUT CLOUDFLARE'S SETTINGS BACK

  Open the night's settings copy:  age -d -i key.txt "<night> cloudflare-settings.json.age" > settings.json
  In the order that matters:
  1. The domains (registrar): the account has to be back first (see WHAT ISN'T HERE).
  2. DNS: for each domain, its "<domain> DNS records.txt" zone file: Cloudflare, the domain, DNS, Records, Import.
  3. Each domain's own rules (zones, rulesets) and email forwarding (emailRouting, emailRules, emailCatchAll); the
     account's rules (accountRulesets) and the lists they use (lists: the www redirect is one).
  4. The admin's sign-in (access: applications, policies, groups, sign-in methods).
  5. The R2 buckets (r2: their addresses, r2.dev, CORS, lifecycle rules), then their files (PUT FILES BACK).
  6. The Pages projects (pages: each one's repository, build and variables; pagesDomains: its own domains).
  7. Workers (PUT A WORKER BACK), KV, Vectorize, the databases.
  8. Stream's live input (stream.liveInputs: a new one gets new stream keys, so the broadcast's settings in the
     admin take them), then notifications (notifications: the webhook to the site and the policy that uses it),
     Turnstile (turnstile), Images variants and email destination addresses.

PUT FILES BACK

  Open that night's list:  age -d -i key.txt "<night> files.json.gz.age" | gunzip > files.json
  Each entry says where a file came from (source and key) and the name of its copy here (path).
  Or let the tool open a whole folder and name everything as it was:
       node scripts/restore.mjs files "<the download folder>" --key "<the download folder>/key.txt" --list "<the download folder>/<night> files.json.gz.age"
  Photos go back into Cloudflare Images under their own image id (the website finds them by it), videos into
  Stream (the website keeps their new ids), and R2 files into their bucket under their original key.

WHERE TO LOOK

  The website admin: Automations, then Hosting, then Backup shows every night, the drills, and anything wrong.
`;
}
