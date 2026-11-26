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

## The site uses the same sign-in

The website signs in with the same client and refresh token, as Cloudflare Pages secrets `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` and `YOUTUBE_REFRESH_TOKEN` (`functions/api/_youtube-auth.js`), to make each reveal's own YouTube live (docs/live-broadcast.md → YouTube). After signing in again, update the Pages secret too, from the Keychain without showing it:

```bash
security find-generic-password -s soard-site -a YOUTUBE_REFRESH_TOKEN -w | npx wrangler pages secret put YOUTUBE_REFRESH_TOKEN --project-name soard-site
```

## Signing in again

If Google stops accepting the refresh token (a password change on the account, or the app removed at myaccount.google.com/permissions):

```bash
node scripts/youtube.mjs login --hint peter@soardcharity.com
```

Pick **Sunshine on a Ranney Day** (the brand account) when Google asks which account, tick Select all, Continue. A new client (if this one is deleted): create a Desktop app client in the project, then `pbpaste | node scripts/youtube.mjs set YOUTUBE_CLIENT_ID` and the same for `YOUTUBE_CLIENT_SECRET`.

An Internal app doesn't work here: the channel is a brand account, and Google refuses brand accounts for Internal apps (Error 403: org_internal).

## How the channel is kept (Peter's OK, Nov 25 2026)

- **Audience:** the channel and every video are "not made for kids" (families and donors watch). "Made for kids" turns off comments, the notification bell and "we're live" alerts, end screens and save-to-playlist. Set in Studio → Settings → Channel → Advanced settings, and per video with `status.selfDeclaredMadeForKids: false`.
- **Titles:** `<Name>'s <rooms> Reveal`, rooms from the kid's page: Dream Bedroom, Accessible Bathroom, Therapy Room, joined with "&" (all three: "Dream Bedroom, Bathroom & Therapy Room"). Year-in-review videos: `<year> Year in Review | Sunshine on a Ranney Day`. Titles of videos that already draw views stay as they are.
- **Descriptions:** the kid's story first (the site's summary, or what the video already had), then `<Name>'s story: https://sunshineonaranneyday.com/kids/<slug>/`, then the standard footer (the Upload defaults hold it): what SOARD builds, Donate, Apply, Watch reveals live, Subscribe, and three hashtags (#SunshineOnARanneyDay plus the room types). Category Nonprofits & Activism, language English.
- **Playlists:** Dream Bedroom Makeovers, Accessible Bathroom Makeovers, Therapy & Sensory Room Makeovers, Big Surprises: Braves, Hawks & Trae Young, Family Stories & Updates, Built with Our Partners, Community Projects, Our Story & Year in Review, Events: Gala, Golf & Big Wheels. A new reveal goes in its room playlists. The older playlists are private, not deleted.
- **Profile:** banner 2560×1440 with everything that matters inside the middle 1546×423; the circle logo without the tagline as the picture; the logo as the watermark for the whole video; trailer for visitors "Making Brighter Days Possible | A Year with SOARD"; Home shelves: Live now, Upcoming live streams, For You, Videos, Shorts, Popular, playlists.

## Thumbnails, end screens, captions (Peter's OK, Nov 25 2026: "Go, all three")

- **Thumbnails:** 1280×720. The kid's best photo from their page on the site (Cloudflare Images, cropped on the face), with the charcoal panel on the left: a yellow label ("Reveal Day", "Year in Review", "Community Project"…), the kid's first name big in white (Outfit 800), the room in yellow caps, and the circle logo top left. Videos without a kid page use a clean frame from the video. YouTube caps custom thumbnails at roughly 100 a day; past that Studio says "Daily custom thumbnail limit reached" and the API refuses too, so a big batch takes more than a day. The best performers get YouTube's own A/B test (Studio → the video → Thumbnail → A/B Testing) of the new design against the current one rather than a straight swap.
- **End screens:** every regular video: the template "1 video, 1 subscribe" (Video: Best for viewer, Subscribe) over the last 20 seconds. 4:3 videos don't offer that template; add Subscribe and Video (Best for viewer) with + Element. Shorts can't have end screens. Not available while a video is marked made for kids.
- **Captions:** English captions made from the video's own audio with whisper.cpp (`brew install whisper-cpp`, model ggml-medium.en, `-ml 42 -sow`, a prompt with the kid's name and "Sunshine on a Ranney Day" so names are spelled right), then uploaded in Studio → Languages → Upload manual → With timing, and published. Videos that are only music get none (YouTube's own [Music] captions cover them). The API's captions.insert costs 400 units a video, so Studio is the way.
- **Studio by script:** Studio has no API for end screens, A/B tests or the daily thumbnail cap, so these were done by driving a signed-in Chrome window. Keep that window visible while a script runs: Studio's menus don't draw in a minimized window.
