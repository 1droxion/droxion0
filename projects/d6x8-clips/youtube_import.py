"""Import a completed public YouTube video for the limited online trial."""
import subprocess
import sys

from creator_sources import creator_video_reference


MIN_CLIP_SECONDS = 30
MAX_CLIP_SECONDS = 35
HIGHLIGHT_COUNT = 5
MIN_SOURCE_SECONDS = MIN_CLIP_SECONDS * HIGHLIGHT_COUNT


def download_youtube(url, target, limit, max_duration):
    reference = creator_video_reference(url)
    if reference is None:
        raise ValueError("Paste a YouTube video or Shorts link.")
    if reference["kind"] == "live":
        raise ValueError("For a finished livestream, use its YouTube watch link or upload the OBS recording.")
    # Use a single MP4 stream with audio. Excluding segmented streams avoids
    # importing a live manifest or starting a separate FFmpeg download process.
    selector = "b[ext=mp4][protocol=https][height<=720][vcodec^=avc][acodec^=mp4a]"
    size = str(limit)
    try:
        subprocess.run([
            sys.executable, "-m", "yt_dlp", "--ignore-config", "--no-playlist",
            "--use-extractors", "youtube", "--js-runtimes", "node",
            "--no-cache-dir", "--socket-timeout", "10", "--retries", "0",
            "--extractor-retries", "0", "--no-part", "--quiet",
            "--format", selector, "--max-filesize", size,
            "--match-filter",
            f"live_status!=is_live & live_status!=is_upcoming & duration>={MIN_SOURCE_SECONDS} & duration<={max_duration}",
            "--output", str(target), "--", reference["watch_url"],
        ], timeout=75, check=True, capture_output=True)
    except subprocess.TimeoutExpired as error:
        raise ValueError("YouTube import timed out. Try again or upload your recording.") from error
    except (OSError, subprocess.CalledProcessError) as error:
        raise ValueError("YouTube didn't provide a downloadable video for this link. Check that it plays publicly, or upload your recording.") from error
    if not target.is_file() or target.stat().st_size == 0:
        raise ValueError(f"Import a completed YouTube video between 2 minutes 30 seconds and {max_duration // 60} minutes that fits the 50 MB limit.")
    with target.open("rb") as source:
        if source.read(8)[4:] != b"ftyp":
            raise ValueError("YouTube did not return a playable MP4 from this server. Upload the original recording instead.")
    if target.stat().st_size > limit:
        raise ValueError("The YouTube video exceeds the 50 MB online limit. Upload a shorter recording.")
