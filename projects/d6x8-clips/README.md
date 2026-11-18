# DroxionClips — Windows Local MVP

A **non-AI**, local-first gaming highlight generator. Upload your own footage or provide a **direct HTTPS .mp4 link** to video you own or have permission to process. It uses audio energy and motion to propose five highlights and renders vertical 9:16 clips with five gaming overlay styles.

## Start on Windows

1. Install Python 3.11+ and FFmpeg (`winget install --id Gyan.FFmpeg -e`).
2. Run `START_WINDOWS.bat` in this directory.
3. Open **http://127.0.0.1:8769**.
4. Upload a video or paste a **direct public HTTPS .mp4** video file link, choose a theme, click **Create 5 Clips**, then download your MP4s.

Manual start: `python -m pip install -r requirements.txt` then `python -m uvicorn app:app --host 127.0.0.1 --port 8769`.

## Supported

- Five highlight *candidates* from audio energy and movement (not gameplay comprehension).
- Five vertical MP4s, approximately 720x1280, with blurred backdrop and template graphics.
- Optional manual captions with bundled Bebas Neue, Montserrat, Poppins, Oswald and Anton fonts. Font licenses are included in `static/fonts/`.
- Local files, 850 MB max, 12 seconds–45 minutes duration. Rendering uses local CPU, storage and electricity.
- Direct public HTTPS MP4, M4V or MOV links. Upload the file if the link redirects.
- No AI model, API fees, or cloud rendering fees.

## Not included

- YouTube or Twitch watch-page link ingestion, creator accounts, Stripe billing, production hosting, cloud scaling, automatic transcription or guaranteed creator earnings.
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
