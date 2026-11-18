# Reveal day runbook

For the crew holding the phone, and for the office. Keep this short and keep it printed.

## Before reveal day (office, 5 minutes, any day ahead)

1. In **JobTread**, give the job's Reveal task its date and time and set **Reveal Date Confirmed** to Yes. Within seconds the site puts up the countdown, the reminder signup and the share page, and the reminders and emails follow. Nothing is scheduled in the admin. Admin → Reveals → Now shows it, plus every upcoming reveal with what has gone out for it. To move or cancel a reveal, change it in JobTread. The kid page must be published, and the job name must carry the kid's name and year, like "Max Sample (2026)".
   **Rehearsing the whole path:** create a JobTread job at the office location named `TEST` plus a kid's name and year, like `TEST Isla Example (2026)`. Give it a Reveal task and a Construction group with a Demo task, then mark Demo complete (that starts construction, which sends the tentative invite), confirm, move the date and un-confirm as you would for real. Everything runs: invites (to the test guests only, titled TEST), the countdown (marked Rehearsal in the admin, invisible on the public site), and reminders under the current Settings (to the test address only). A real confirmed reveal always takes the slot first. Close the job when done; its invite is cancelled.
2. Facebook → Live Producer → schedule a live video for the same time using the **persistent stream key**. (Not needed once the Live Video API is approved.)
3. Reveals → Now shows the **Go / no-go** for the scheduled reveal: fix anything it lists (each item has its own button). If the reveal is tomorrow, the site re-checks by itself in the morning and alerts if anything is off.
4. Sound check, before the first reveal and whenever the phone or mic changes: put the phone on the **rehearsal** profile (Admin → Broadcast → Settings → Phones → rehearsal QR), open Admin → Broadcast → Now → **Start mic check**, and talk normally. The verdict should read "Sound is good", with speech between −24 and −12 dB on both meters. Nothing in a rehearsal reaches the public.

## Reveal day (crew, 30 seconds)

1. Charge the phone. Plug in the wireless mic receiver. Put the phone on the gimbal.
2. Open **Larix Broadcaster**. Check the audio meter moves when someone talks.
3. Tap the red **record** button. You are live everywhere: the site, Facebook, YouTube.
   - **Don't start early.** The moment the phone connects, the site, Facebook and YouTube show the camera, setup and all. Until then the live page shows the kid's photo and the countdown, with the build's partners scrolling under it, and it turns into the video the moment the phone connects (everyone on the page is brought up to it). Check picture and sound beforehand on the rehearsal profile instead. Connecting more than 30 minutes early holds the "we're live" email to the list.
4. When the reveal is done, tap stop. The site switches to the replay on its own, saves the recording, adds it to the kid's page, emails the people who asked, and posts the reveal to Instagram as a Reel about 15 to 30 minutes later.

If the phone goes live from the Facebook app instead, nothing extra is needed. Put the kid's name in the first line of the Facebook post ("Remi and Nico's reveal!"). A few hours after it ends, the site saves the replay to Stream, puts it on that kid's page, and redeploys.

## If something goes wrong

- **Larix shows "connecting" forever**: weak signal. Tap stop, switch to the **Weak signal** profile (scanned earlier), tap record again. Cellular hotspots from a second phone also work.
- **The stream dropped for a moment**: keep going. The site waits 45 seconds, Stream waits 30, and the recording stays in one piece.
- **Lost the phone profile**: open the admin on any phone → Broadcast → Settings → Phones → scan the QR again.
- **Facebook didn't go live**: Live Producer → the scheduled post → Go Live. Everything else keeps running.
- **Nothing works**: go live from the Facebook app the old way, and the office puts up the emergency banner in Broadcast → Now → "Stream down? Put up the emergency banner".

## Audio

Bluetooth microphones are the usual cause of bad audio. Phones take Bluetooth mic input over the hands-free profile, which is low bandwidth and drops in a house full of phones and Wi-Fi.

Use a wireless mic with its own receiver that plugs into the phone's port: DJI Mic Mini or Mic 2, or a Rode Wireless Micro or Wireless GO II. They appear to the phone as a wired mic and Larix picks them up automatically. If a Bluetooth mic is the only option: pair it before opening Larix, select it under Larix → Settings → Audio, and confirm the meter moves.

## Larix settings worth turning on (once per phone)

- Settings → Connectivity → **Adaptive bitrate: Ladder ascend**. Weak signal lowers quality instead of dropping.
- Settings → Video → **Background streaming** on, so a notification doesn't stop the stream.
- Shoot **vertical**. In Larix, set the video orientation to portrait (Settings → Video) and lock the phone's rotation so it never flips mid-reveal. If the picture on Admin → Broadcast shows people lying on their side, this setting is off (Nov 17 2026 test: the phone sent 1920×1080 held upright, and the site, Facebook and YouTube all showed it sideways).
- **No overlays.** The "starting soon" screen was retired on Nov 17 2026. If a phone still has its **Web page** layer (Settings → Overlays, address `…/live/slate/`) or its **Image** layer (`…/starting-soon.png`), delete it. Left on, it now shows nothing (the address answers an empty, see-through page, and the image is gone), but it has no reason to be there.

## Sharing the reveal and messages for the family (office)

- **One link for everyone:** `sunshineonaranneyday.com/live`. It always shows the reveal that is coming up, live, or on replay, with that kid's name and photo. The family invite QR code in Admin → Broadcast → Now opens the same page; print it once and reuse it for every family. For Facebook posts, use the kid's own link (`/live/<kid>`), which the reminders already do.
- **Messages:** viewers can leave a note for the family on the live page. Each one is checked automatically before it shows. During the reveal, keep Admin → Broadcast → Now open: anything in **Waiting for review** needs a person (it appears there only if the automatic check was unavailable), and **Hide** takes any message down within a second. The switch at the top of the Messages card turns messages off.
- **After the reveal:** Messages → **Keepsake** makes a print-ready page of every message. Print it or save it as a PDF for the family. History keeps it for every past reveal.
