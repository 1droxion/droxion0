# DroxionClips — Windows Local MVP

A **non-AI**, local-first gaming highlight generator. Upload your own footage or provide a **direct HTTPS .mp4 link** to video you own or have permission to process. It uses audio energy and motion to propose five highlights and renders vertical 9:16 clips with five gaming overlay styles.

## Start on Windows

1. Install Python 3.11+ and FFmpeg (`winget install --id Gyan.FFmpeg -e`).
2. Run `START_WINDOWS.bat` in this directory.
3. Open **http://127.0.0.1:8769**.
4. Upload your video, use a direct public HTTPS MP4 link, or paste a YouTube reference **alongside your own original recording**. Choose a style and click **Create 5 Clips**.
5. For livestreams, use the **OBS recordings folder** panel to watch new completed replay-buffer clips or video files while this app is running.

Manual start: `python -m pip install -r requirements.txt` then `python -m uvicorn app:app --host 127.0.0.1 --port 8769`.

## Supported

- Five highlight *candidates* from audio energy and movement (not gameplay comprehension).
- Five vertical MP4s, approximately 720x1280, with blurred backdrop and template graphics.
- Optional manual captions with bundled Bebas Neue, Montserrat, Poppins, Oswald and Anton fonts. Font licenses are included in `static/fonts/`.
- Local files, 850 MB max, 12 seconds–45 minutes duration. Rendering uses local CPU, storage and electricity.
- Direct public HTTPS MP4, M4V or MOV links. Upload the file if the link redirects.
- YouTube watch/live/shorts link recognition as an optional **reference only**; YouTube content is not downloaded. You must upload your own video recording.
- Local OBS replay/recording directory monitoring, with explicit start/stop, stability checks and auto-generation of five clips for each new saved recording (within the usual 12-second–45-minute and 850 MB limits).
- No AI model, API fees, or cloud rendering fees.

## Not included

- Direct downloading from YouTube or Twitch watch pages, capturing a live YouTube feed, automatic speech transcription, creator accounts, Stripe billing, production hosting, cloud scaling, or guaranteed creator earnings.
- **$9.99/month is only a proposed price; this prototype does not collect money.**
- Automatic peak detection cannot promise the truly *best* five moments.
- Never expose this local server publicly without authentication, rate limiting, storage lifecycle controls, SSRF protections, and a security review.

Outputs are saved in `workspace/`. Outputs older than 24 hours are removed when a new job starts.

## Project status

This repository folder is an isolated GitHub source version; it is **not a live service**. It intentionally doesn't touch other applications in this repository.

## Checks

From this directory, install the development requirements and run `python -m pytest -q`.
With the local studio running, install Chromium with `python -m playwright install chromium --only-shell`
and run `python tests/browser_check.py` to test eight viewport widths, render a real upload,
play the first export, and download its MP4.

## OBS live-stream workflow

1. In OBS, configure **Settings → Output → Recording Path** under your Windows user folder (for example, `C:\Users\you\Videos\OBS`). You can also enable Replay Buffer and bind **Save Replay** to a hotkey.
2. Open **DroxionClips → Clip your OBS replay recordings** and paste the exact existing folder path. Optionally paste your own YouTube live URL in the video-link field as a reference.
3. Select a clip template and optional manual caption. Click **Start watching**.
4. While you stream, save a **new replay** through OBS, or stop a segmented local recording. The watcher ignores pre-existing files, waits until file size is unchanged for roughly 12 seconds, and then queues the clip job.
5. Click **View latest OBS clips** to view/download the five rendered highlights. Click **Stop** to stop the watcher.

The watcher processes **completed local files only**, not an active live stream. A long, actively growing single recording will not be processed until it stops changing. Use OBS Replay Buffer or short recording segments for during-stream highlights. The app can process only one video job at a time. Keep the server running on your computer and do not expose it publicly. New exports are removed according to the existing 24-hour cleanup policy.

YouTube URLs are reference metadata, not audiovisual input. To obtain footage you own, use the original local OBS file or YouTube Studio's creator download options where available. Don't download other people's videos without appropriate rights.

## Private online web beta (separate from the static public landing site)

The web beta is served by `cloud_app:app` and is **not a public paid service**. It is designed for one beta tester at a time and must be protected with a strong password.

- 120 MB uploaded video maximum, 12 seconds–10 minutes maximum duration.
- Five actual FFmpeg 9:16 MP4 highlight candidates, five styles, optional manually entered caption and licensed fonts.
- Preview and download each clip or check boxes 1–5 and download only those selected as a ZIP.
- Supports uploaded gameplay files and direct public HTTPS MP4/MOV links. YouTube video, Shorts and live links are reference metadata **only**: supply your own original recording. No YouTube stream scraping or downloads.
- No cloud-based OBS folder access; OBS watcher remains local-only.
- One render at a time; generated files and memory are ephemeral on Render. No subscription or customer accounts.
- Access requires `DROXIONCLIPS_BETA_PASSWORD` (14+ characters) and `DROXIONCLIPS_SESSION_SECRET` (32+ random characters).
- To run directly, `uvicorn cloud_app:app --host 127.0.0.1 --port 8773` after installing FFmpeg and Python requirements. Deployment uses `Dockerfile.web`.
- Original recording is deleted when rendering ends. Generated clips are kept temporarily and expire on cleanup; download your clips promptly.

Do **not** move `droxion.com`, `clips.droxion.com` or customer billing to this backend yet. The web beta needs traffic controls, monitoring, durable job storage, scalable queues, and a proper customer authentication system before public launch.

## Public long-recording editor

Open `/long-clips` on the web editor service when the public trial is enabled.

- Upload a recording or paste a direct public HTTPS MP4/M4V/MOV file URL. The limit is three hours and 1 GiB.
- Recordings of at least 2:30 produce five 30–35 second vertical highlights. Shorter recordings produce shorter clips.
- Preview clips and download individual MP4s or a ZIP of selected clips.
- Optional captions burn in the single line and font that you choose. Automatic transcription is separate.
- YouTube watch links require the experimental `DROXIONCLIPS_YOUTUBE_ENABLED=1` flag and a compatible upstream stream. Keep the flag off when upstream downloads fail.
- The public queue accepts one active render per process. Existing daily public-trial job limits apply.
