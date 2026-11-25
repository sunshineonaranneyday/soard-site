# YouTube channel API (scripts)

`scripts/youtube.mjs` manages the Sunshine on a Ranney Day channel (UC5TAYYt2ZHWG8Qb-ZNHZUCQ, @sunshineonaranneyday) through the YouTube Data API and YouTube Analytics, signed in as the channel itself. The site's own `YOUTUBE_API_KEY` (`functions/api/_youtube.js`) stays read-only and public; this is for running from a Mac.

What it can change: the channel's description, keywords, trailer, banner and sections; every video's title, description, tags, category and thumbnail; playlists. What it can't: the profile picture, the channel name, the handle and the links under the name. Those are YouTube Studio only (Customization → Profile).

## Where things are

- Google Cloud project **SOARD Website** (`soard-website`), signed in as peter@soardcharity.com. YouTube Data API v3 and YouTube Analytics API are on.
- Google Auth Platform: app "SOARD YouTube Tools", External, In production, not verified (Google shows "Google hasn't verified this app"; Advanced → Go to SOARD YouTube Tools). Up to 100 accounts may sign in, which is plenty.
- OAuth client "SOARD YouTube CLI (Mac)", type Desktop app.
- Keys in the login Keychain, service `soard-site`: `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`. Never in a file.

## Use

```bash
node scripts/youtube.mjs whoami
node scripts/youtube.mjs get videos part=snippet,status id=AuIwGnx5G30
node scripts/youtube.mjs put videos part=snippet --body video.json
node scripts/youtube.mjs analytics metrics=views,estimatedMinutesWatched dimensions=video sort=-estimatedMinutesWatched maxResults=25
node scripts/youtube.mjs banner banner.png
node scripts/youtube.mjs thumbnail <videoId> thumb.jpg
```

Quota: 10,000 units a day for the project. A read is 1, a video or playlist update 50, a thumbnail 50, a banner upload 50. Updating every video (about 220) takes two days of quota.

## Signing in again

If Google stops accepting the refresh token (a password change on the account, or the app removed at myaccount.google.com/permissions):

```bash
node scripts/youtube.mjs login --hint peter@soardcharity.com
```

Pick **Sunshine on a Ranney Day** (the brand account) when Google asks which account, tick Select all, Continue. A new client (if this one is deleted): create a Desktop app client in the project, then `pbpaste | node scripts/youtube.mjs set YOUTUBE_CLIENT_ID` and the same for `YOUTUBE_CLIENT_SECRET`.

An Internal app doesn't work here: the channel is a brand account, and Google refuses brand accounts for Internal apps (Error 403: org_internal).
