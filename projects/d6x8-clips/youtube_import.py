"""Import completed YouTube videos into the worker's temporary job directory."""
import logging
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time

from creator_sources import creator_video_reference

MIN_CLIP_SECONDS = 30
MAX_CLIP_SECONDS = 35
HIGHLIGHT_COUNT = 5
MIN_SOURCE_SECONDS = MIN_CLIP_SECONDS * HIGHLIGHT_COUNT
LOGGER = logging.getLogger("uvicorn.error")
FORMAT_SELECTOR = (
    "bv[ext=mp4][vcodec^=avc][height<=1080][protocol=https]"
    "+ba[ext=m4a][protocol=https]/"
    "b[ext=mp4][vcodec^=avc][acodec^=mp4a][height<=1080][protocol=https]"
)


def require_tools():
    paths = {name: shutil.which(name) for name in ("ffmpeg", "ffprobe", "node")}
    if not all(paths.values()):
        raise RuntimeError("Worker requires FFmpeg, FFprobe and Node on PATH.")
    version = subprocess.check_output([sys.executable, "-m", "yt_dlp", "--version"],
                                      text=True, timeout=20).strip()
    ffmpeg_version = subprocess.check_output([paths["ffmpeg"], "-version"],
                                             text=True, timeout=10).splitlines()[0]
    node_version = subprocess.check_output([paths["node"], "--version"],
                                           text=True, timeout=10).strip()
    subprocess.check_call([paths["ffprobe"], "-version"], stdout=subprocess.DEVNULL, timeout=10)
    LOGGER.info("Video tools ready: yt-dlp %s, %s, Node %s", version, ffmpeg_version, node_version)
    return paths


def download_youtube(url, target, limit, max_duration, min_duration=MIN_SOURCE_SECONDS):
    reference = creator_video_reference(url)
    if reference is None:
        raise ValueError("Paste a valid YouTube watch or youtu.be link.")
    if reference["kind"] == "live":
        raise ValueError("Use the watch link for the finished livestream.")
    ffmpeg, node = shutil.which("ffmpeg"), shutil.which("node")
    if not ffmpeg or not node:
        raise ValueError("YouTube worker is missing FFmpeg or Node.")
    args = [
        sys.executable, "-m", "yt_dlp", "--ignore-config", "--no-playlist",
        "--use-extractors", "youtube", "--js-runtimes", f"node:{node}",
        "--ffmpeg-location", ffmpeg, "--merge-output-format", "mp4",
        "--no-cache-dir", "--socket-timeout", "15", "--retries", "2",
        "--extractor-retries", "1", "--no-progress", "--no-warnings",
        "--format", FORMAT_SELECTOR, "--max-filesize", str(limit),
        "--match-filter",
        f"live_status!=is_live & live_status!=is_upcoming & duration>={min_duration} & duration<={max_duration}",
        "--output", str(target.with_suffix(".%(ext)s")), "--", reference["watch_url"],
    ]
    # During merge the separate streams and output can briefly coexist.
    if shutil.disk_usage(target.parent).free < 2 * limit + 256 * 1024**2:
        raise ValueError("The worker is temporarily low on video storage.")
    deadline = time.monotonic() + 1200
    with tempfile.TemporaryFile() as log:
        with subprocess.Popen(args, stdout=log, stderr=log, start_new_session=True) as child:
            try:
                while child.poll() is None:
                    if time.monotonic() >= deadline:
                        raise ValueError("YouTube import exceeded 20 minutes.")
                    if sum(p.stat().st_size for p in target.parent.iterdir()
                           if p.is_file()) > 2 * limit:
                        raise ValueError("YouTube import exceeded the temporary file limit.")
                    time.sleep(1)
            finally:
                if child.poll() is None:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait()
            if child.returncode:
                log.seek(max(0, log.tell() - 8192))
                messages = log.read().decode(errors="replace").splitlines()
                detail = next((line.partition("ERROR: ")[2] for line in reversed(messages)
                               if "ERROR: " in line), "YouTube provided no compatible video stream.")
                detail = detail.split(" Use --cookies")[0].split(" See ")[0][:320]
                LOGGER.warning("YouTube import failed: %s", detail)
                raise ValueError(detail)
    if not target.is_file() or not target.stat().st_size:
        raise ValueError(f"YouTube returned no file within the {min_duration}–{max_duration} second duration and 1 GiB size limits.")
    if target.stat().st_size > limit:
        raise ValueError("The merged YouTube video exceeds 1 GiB.")
    with target.open("rb") as source:
        if source.read(8)[4:] != b"ftyp":
            raise ValueError("YouTube returned a response that is not a playable MP4.")
