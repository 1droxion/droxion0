# D6X8 Clips — Windows Local MVP

A **non-AI**, local-first gaming highlight generator. Upload your own footage or provide a **direct HTTPS .mp4 link** to video you own or have permission to process. It uses audio energy and motion to propose five highlights and renders vertical 9:16 clips with five gaming overlay styles.

## Start on Windows

1. Install Python 3.11+ and FFmpeg (`winget install --id Gyan.FFmpeg -e`).
2. Run `START_WINDOWS.bat` in this directory.
3. Open **http://127.0.0.1:8768**.
4. Upload a video or paste a **direct public HTTPS .mp4** video file link, choose a theme, click **Generate 5 clips**, then download your MP4s.

Manual start: `python -m pip install -r requirements.txt` then `python -m uvicorn app:app --host 127.0.0.1 --port 8768`.

## Supported

- Five highlight *candidates* from audio energy and movement (not gameplay comprehension).
- Five vertical MP4s, approximately 720x1280, with blurred backdrop and template graphics.
- Local files, 850 MB max, 12 seconds–45 minutes duration. Rendering uses local CPU, storage and electricity.
- Direct public HTTPS MP4 links only, no redirect following.
- No AI model, API fees, or cloud rendering fees.

## Not included

- YouTube or Twitch watch-page link ingestion, creator accounts, Stripe billing, production hosting, cloud scaling, captions or guaranteed creator earnings.
- **$9.99/month is only a proposed price; this prototype does not collect money.**
- Automatic peak detection cannot promise the truly *best* five moments.
- Never expose this local server publicly without authentication, rate limiting, storage lifecycle controls, SSRF protections, and a security review.

Outputs are saved in `workspace/`. Delete completed job folders when no longer needed.

## Project status

This repository folder is an isolated GitHub source version; it is **not a live service**. It intentionally doesn't touch other applications in this repository.
