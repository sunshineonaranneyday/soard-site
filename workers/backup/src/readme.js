/** The READ ME FIRST at the top of each backup home: what's there and how to put it back, for whoever needs it */

export const README_NAME = 'READ ME FIRST - how to restore.txt';
export const README_VERSION = 5;

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
                       ${databases.map((d) => `${d.label} (Cloudflare D1 "${d.name}")`).join(', ')}.
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
  Nights/              One short summary per night.
  Restore drills/      Every week (and after any drill that didn't pass, until one does) the backup restores that
                       run's database copies into a spare database and checks every table, byte for byte, and
                       opens a few files and the code. The reports are here.

THE KEY

Everything except this file, the nights, the drill reports and the database manifests is encrypted with age
(https://age-encryption.org). To open it you need SOARD's backup key: the line that starts with
AGE-SECRET-KEY-PQ-1 on the printed recovery sheet. Its check code is ${fingerprint}; the sheet shows the same
code, so you can tell it's the right one. Without the key these files can't be opened by anyone.

  1. Install age, version 1.3 or newer: https://github.com/FiloSottile/age (on a Mac: brew install age).
  2. Type the key into a file named key.txt, all on one line, with no spaces.
  3. Open any file:   age -d -i key.txt "the file.age" > "the file"

PUT THE DATABASE BACK

  1. Download the night's copy and its manifest from Database/<name>/<year>/.
  2. age -d -i key.txt "2026-11-14 soard-db.sql.gz.age" | gunzip > restore.sql
  3. Make a new, EMPTY D1 database in Cloudflare, then run:
       npx wrangler d1 execute <its name> --remote --file restore.sql
     (For a copy on a computer instead: sqlite3 restored.sqlite < restore.sql)
  4. Point the website at it: in the website's code, wrangler.toml, set database_id under DB to the new database's id.
  The website's own tool does steps 2 and 3's checking for you: in its code (github.com/sunshineonaranneyday/
  soard-site), with Node 22.13 or newer: cd workers/backup, npm ci --omit=dev, then
       node scripts/restore.mjs database <the downloaded folder> --key key.txt --check
  It checks the copy is the one its manifest names, opens it, writes restore.sql, builds it on the computer and
  compares every table with the manifest.

PUT THE CODE BACK

  From the month's full copy, then each later night's copy of that month, oldest first:
${CODE_STEPS.map((s) => `     ${s}`).join('\n')}
  (repeat the last three lines for each later night). The folder named site then holds the code as it was.

PUT FILES BACK

  Open that night's list:  age -d -i key.txt "<night> files.json.gz.age" | gunzip > files.json
  Each entry says where a file came from (source and key) and the name of its copy here (path).
  Or let the tool open a whole folder and name everything as it was:
       node scripts/restore.mjs files <folder> --key key.txt --list "<night> files.json.gz.age"
  Photos go back into Cloudflare Images under their own image id (the website finds them by it), videos into
  Stream (the website keeps their new ids), and R2 files into their bucket under their original key.

WHERE TO LOOK

  The website admin: Automations, then Hosting, then Backup shows every night, the drills, and anything wrong.
`;
}
