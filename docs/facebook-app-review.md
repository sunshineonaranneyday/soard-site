# Facebook App Review package

The Facebook app the site uses is "Sunshine on a Ranney Day" in developers.facebook.com, app id 3077726055757497 (named "Live URL" until Nov 21 2026, when Peter had it renamed before the App Review; the rename left the token and its permissions as they were). It belongs to the business portfolio "Sunshine on a Ranney Day / Sunny and Ranney" (193121635659663), whose Business Verification shows Verified.

## Why it's needed (Nov 21 2026)

The app is in Development mode. Meta shows what a Development-mode app creates only to people with a role on the app, so the Facebook lives the site posted for Dylan (Nov 18) and Max (Nov 20) were hidden from the public: logged out, both say "This content isn't available" while an ordinary Page video loads, someone without a role on the app saw a blank screen, and Facebook counted 4 and 3 views on a Page with 107K followers. Peter, as an admin, sees them under Past live videos.

Switching the app to Live mode would make them public, but none of its permissions has Advanced Access (App Review → submissions listed all 13 as "Not submitted" on Nov 21), and Meta warns that going Live too early can make an app unusable even for people with a role on it. In July, in Live mode, Facebook refused `POST /{page-id}/live_videos` with error #10. So the order is: App Review for Advanced Access, then Live mode.

Peter's decisions (Nov 21): submit the App Review (he presses Submit himself); keep the site's automatic Facebook post until it's approved; if it isn't approved a few days before the first December reveal, switch to the persistent-key backup below, after he sees the steps.

## The submission (prepared Nov 21 2026, not yet submitted)

developers.facebook.com → the app → Review → App Review: submission 3077732302423539, filled in and saved as a draft. Only Peter presses **Submit for review**.

- Verification, App settings and Data handling: complete.
- Allowed usage: every item has its description, the screen recording and the agreement. Waiting on Meta, not on us: the "API test calls" counter for read_insights, pages_read_user_content and pages_manage_engagement (the site made those calls on Nov 21 with the new token; Meta says up to 24 hours to show, and a test is valid for 30 days). The other nine items are complete.
- Reviewer instructions: the text below; "Is Facebook Login integrated on this platform?" answered No (the website has no Facebook Login; the Page admin granted access once with Facebook Login for Business). Facebook required a platform first, so App settings → Basic now has a Website platform with Site URL https://sunshineonaranneyday.com/.
- Data handling, as Peter answered on Nov 21: data processors Yes, Cloudflare, Inc. (IT solutions and services, including cloud storage and processing; United States of America); responsible entity Sunshine on a Ranney Day Incorporated, United States of America; national-security requests in the past 12 months: No; policies for public-authority requests: None of the above.

When every Allowed usage item shows a green tick, Submit for review unlocks.

## What is requested

Requested for Advanced Access, each with the description below and the screen recording. Times point into the recording.

- **Live Video API** (feature):
  > Sunshine on a Ranney Day is a 501(c)(3) nonprofit that builds free dream bedrooms and accessible bathrooms for children with special needs, and shows each child seeing their finished room live on our own Facebook Page. We use the Live Video API only to broadcast these room reveals on our own Page: when our crew's camera phone starts streaming to our server, the server creates the live video on our Page (POST /{page-id}/live_videos, status LIVE_NOW, with the child's name as the title and their story as the description), sends our stream to the returned RTMPS URL, checks the stream's health while live, and ends the live video when the phone stops (end_live_video) so the replay stays on our Page. Staff don't have to set up the post by hand during a fast, emotional event. Screen recording: steps 2 to 4 (0:29 to 1:07).
- **publish_video**:
  > Our server publishes the live video of each room reveal to our own Facebook Page through the Live Video API when our crew's camera phone starts streaming, and ends it when the phone stops so the replay stays on the Page. Only our own Page and our own videos. Screen recording: steps 2 and 3 (0:29 to 0:53).
- **pages_manage_posts**:
  > For each room reveal our server creates the live video post on our own Page (POST /{page-id}/live_videos with the child's name as the title and their story as the description) and ends it when the broadcast is over (end_live_video). After the reveal it also posts the reveal moment as a Reel on our own Page (POST /{page-id}/video_reels). We never post to or edit anyone else's Page. Screen recording: steps 2 to 4 (0:29 to 1:07).
- **pages_manage_engagement**:
  > Right after our server starts a live reveal on our own Page, it posts the Page's own first comment on that live video: "Watch on our website too, and leave a message for the family:" with the link to the child's page on our website (POST /{video-id}/comments). It is one comment per live video, from our Page, on our Page's own post. We never comment on other people's content or reply to people automatically. Screen recording: steps 4 and 5 (0:53 to 1:15).
- **pages_read_user_content**:
  > Facebook requires pages_read_user_content for our Page to post its own first comment on its own live video (see pages_manage_engagement). We also read the comment count of our own live video for our staff-only History page. We don't read, store or show the content of other people's comments. Screen recording: steps 4 (0:53) and 6 (1:15).
- **read_insights**:
  > After a reveal our server reads the lifetime totals of that one live video on our own Page (GET /{video-id}/video_insights: total views and average watch time) and shows them in our staff-only admin beside our website's own numbers, so staff can see how each reveal did and plan the next one. Only our own Page's videos, only totals, never data about individual people; seen only by our staff. Screen recording: step 6 (1:15).
- **pages_read_engagement**:
  > Our server reads our own Page's name and link, its recent videos (to find the live video, its permalink and whether it is live) and the video's reaction and comment counts. We use them in our staff-only admin and to link visitors from our website to the Facebook post. Only our own Page. Screen recording: steps 1, 3 and 6.
- **pages_show_list**:
  > A Page admin connected our Page to the app once with Facebook Login for Business. pages_show_list lets the app find our Page among the Pages that admin manages (GET /me/accounts) to get the Page token our server uses. We use it only for our own Page. Screen recording: step 1 (0:14).
- **business_management**:
  > Our Facebook Page and Instagram account are managed in our verified business portfolio (Sunshine on a Ranney Day), and our admin's access to them comes through that portfolio. The app uses it only to act on those two assets of ours; it doesn't read or change any other business assets. Screen recording: step 1 (0:14).
- **instagram_basic**:
  > Our Instagram professional account (@sunshineonaranneyday) is linked to our Page. The app reads only its id and username (GET /{page-id}?fields=instagram_business_account{id,username}) to post the reveal Reel to it and link to it from our admin. Only our own account. Screen recording: step 7 (1:28).
- **instagram_content_publish**:
  > When the replay of a reveal is ready, our server cuts out the moment the child sees their room and publishes it as a Reel on our own Instagram account (POST /{ig-user-id}/media with media_type REELS, then /media_publish). Only our own account and our own videos. Screen recording: step 8 (1:36).
- **public_profile** (granted to every app):
  > Granted with Facebook Login for Business when our Page admin connected our Page. We don't use or store any profile data.

Taken out of the submission: Business Asset User Profile Access (the site doesn't use it).

## Screen recording

`soard-app-review-screencast.mp4`, 2:07, 1920×1080, kept at `~/Downloads/soard-app-review-screencast.mp4` (not in the repo). Real screens from Max's reveal (Nov 20), each with a caption naming what it shows and the permission; the admin's sidebar (staff name and email) is cropped out, and the phone setup codes (stream keys) are never shown.

0:00 who we are · 0:14 step 1, the Page connected (Reveals → Settings → Facebook) · 0:29 step 2, reveal day: the server creates and ends the live video (Reveals → Now) · 0:44 step 3, the lives on our Page · 0:53 step 4, the post and the Page's first comment · 1:07 step 5, where the link goes (the child's live page) · 1:15 step 6, Facebook numbers in History · 1:28 step 7, our Instagram account (Reveals → Settings → Instagram) · 1:36 step 8, the Reel · 1:47 only our own Page and account.

To remake it, take the same screens in a signed-in Chrome, then render each with its caption at 1920×1080 in headless Chrome and join them with ffmpeg (concat, libx264, yuv420p).

## Reviewer instructions (paste)

> This app is used only by the staff of Sunshine on a Ranney Day, a 501(c)(3) nonprofit, for our own Facebook Page (facebook.com/SunshineOnaRanneyDay) and our own Instagram professional account (@sunshineonaranneyday). There is no public login and no other users: our server holds a Page access token that our Page admin granted with Facebook Login for Business, and our staff run each reveal from our admin at sunshineonaranneyday.com/admin, which is behind Cloudflare Access single sign-on for our staff, so we can't issue a reviewer login. The screen recording shows every requested permission in use on our real reveal of November 20, 2026. Our privacy policy is at sunshineonaranneyday.com/privacy-policy/ (data deletion: section 09).

## After approval

1. developers.facebook.com → the app → Publish → switch to Live.
2. Logged out (or as someone without a role on the app), open Max's video (facebook.com/SunshineOnaRanneyDay/videos/1696905131784130/). It should play.
3. Admin → Reveals → Settings → Facebook: the connection test should still say every permission automatic mode needs is granted; run the go/no-go (facebookToken and facebookComment ok).

## Backup if it isn't approved in time: the persistent key

A persistent stream key is already saved (Reveals → Settings → Facebook → Persistent stream key, Active). Posts made by a person in Live Producer are public whatever the app's mode. Before the first December reveal, if the review is still pending, and only after Peter has seen these steps: choose "Persistent stream key" under "How the live post gets made" and save; on reveal day, when the phone starts, someone at the office opens Live Producer on the SOARD Page, sees the preview, adds the title and clicks Go live (no scheduled or upcoming post), then pastes the link comment as the Page. In this mode the site doesn't comment and the crew text for a failed comment doesn't fire.

## If it is rejected

Rejections usually cite an unclear screen recording or a permission not shown in use. Each permission is judged on its own, so fix the cited item and resubmit that one; there is no cooldown. The alternative that needs no review is a multistreaming service (Restream, StreamYard) whose own Facebook app already holds approval, at a monthly fee.

## Instagram Reels

The site posts every reveal to Instagram as a Reel on its own (functions/api/_broadcast-reel.js). That uses the same Facebook app and the same page token, with two more permissions.

Requested in the same submission: `instagram_basic` and `instagram_content_publish` (see What is requested). Instagram posts the app made in Development mode were public all along (the Reel shows logged out); only the Facebook lives were hidden. The Facebook Reel the site now also posts on the Page (Nov 21) goes through this app too, so it is hidden from the public the same way until the app is Live.

**Regenerate the page token** (Peter; secrets live only in Cloudflare). Last done Nov 21 2026, with all 10 permissions below.

1. Link Instagram to the Page if it isn't: Instagram app → Settings → Account type and tools → switch to a professional account → Business, then Facebook Page settings → Linked accounts → Instagram → connect.
2. A permission the app doesn't have yet can't go on a token ("(#200) The permission(s) … are not available"). Add it first: developers.facebook.com → the "Sunshine on a Ranney Day" app (3077726055757497) → Use cases → Manage everything on your Page → Customize → **Add to App Review** on the permission. That only adds it to the app ("Ready for testing"); nothing is submitted. `pages_manage_engagement`, `pages_read_user_content` and `read_insights` were added this way on Nov 21 2026.
3. developers.facebook.com/tools/explorer → Meta App: "Sunshine on a Ranney Day" → User or Page: **Get User Access Token** → tick `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `publish_video`, `instagram_basic`, `instagram_content_publish`, `business_management`, `pages_manage_engagement` and `pages_read_user_content` (the Page's website-link comment on its live post), `read_insights` (Facebook viewer numbers after a reveal) → Generate → approve in the popup.
4. Access Token Tool (developers.facebook.com/tools/accesstoken) → **Extend Access Token** on that user token → copy the long-lived user token. (Or exchange it without the token in an address bar: POST `oauth/access_token` with `grant_type=fb_exchange_token`, the app id, the app secret from App settings → Basic, and the user token.)
5. In Graph Explorer, paste the long-lived token and run `GET /me/accounts`. Copy the `access_token` of the Sunshine on a Ranney Day page. Page tokens made from a long-lived user token do not expire.
6. Cloudflare dashboard → Workers & Pages → soard-site → Settings → Variables → edit `FB_PAGE_TOKEN` → paste → Save → redeploy (Publish to site in the admin, any push, or Retry deployment).
7. Admin → Broadcast → Settings → Instagram → **Test connection**. It should say "Linked Instagram: @sunshineonaranneyday. Ready to post." Facebook's Test connection should list the new scopes, and the go/no-go before a reveal checks the comment permissions.
