"""Private local downloader and client for the existing DroxionClips upload API."""
import argparse
from contextlib import closing
import http.client
import importlib.util
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import uuid
from urllib.parse import urlsplit
from urllib.request import getproxies, proxy_bypass

from creator_sources import creator_video_reference

HOST = "droxionclips-editor-beta.onrender.com"
JOBS = "/api/public/jobs"
MAX_BYTES = 1024**3
FONTS = ("bebasneue", "montserrat", "poppins", "oswald", "anton")


def api_connection(timeout):
    proxy_url = getproxies().get("https")
    if proxy_url and not proxy_bypass(HOST):
        proxy = urlsplit(proxy_url)
        if proxy.scheme != "http" or not proxy.hostname or proxy.username:
            raise RuntimeError("This helper supports direct connections and unauthenticated HTTP proxies.")
        conn = http.client.HTTPSConnection(proxy.hostname, proxy.port or 80, timeout=timeout)
        conn.set_tunnel(HOST, 443)
        return conn
    return http.client.HTTPSConnection(HOST, timeout=timeout)


def api_json(connection):
    response = connection.getresponse()
    body = response.read(128 * 1024)
    try:
        data = json.loads(body)
    except (ValueError, UnicodeError):
        raise RuntimeError(f"DroxionClips returned HTTP {response.status}.") from None
    if response.status >= 400:
        detail = data.get("detail")
        raise RuntimeError(detail if isinstance(detail, str) else f"DroxionClips returned HTTP {response.status}.")
    return data


def upload(path, count, caption, font):
    size = path.stat().st_size
    if not 0 < size <= MAX_BYTES:
        raise RuntimeError("Choose a non-empty video no larger than 1 GiB.")
    extensions = {".mp4", ".mov", ".m4v", ".mkv", ".webm"}
    extension = path.suffix.lower()
    if extension not in extensions:
        raise RuntimeError("Choose an MP4, MOV, M4V, MKV or WebM recording.")
    boundary = uuid.uuid4().hex
    fields = {"rights": "true", "clip_count": str(count), "captions": str(bool(caption)).lower(),
              "caption_text": caption, "caption_font": font}
    prefix = "".join(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'
                     for key, value in fields.items())
    prefix += (f'--{boundary}\r\nContent-Disposition: form-data; name="video"; '
               f'filename="recording{extension}"\r\nContent-Type: application/octet-stream\r\n\r\n')
    head = prefix.encode()
    tail = f"\r\n--{boundary}--\r\n".encode()
    print(f"Uploading {path.name} to DroxionClips…", flush=True)
    with path.open("rb") as source, closing(api_connection(120)) as conn:
        conn.putrequest("POST", JOBS)
        conn.putheader("Origin", f"https://{HOST}")
        conn.putheader("Content-Type", f"multipart/form-data; boundary={boundary}")
        conn.putheader("Content-Length", str(len(head) + size + len(tail)))
        conn.endheaders()
        conn.send(head)
        while chunk := source.read(1024 * 1024):
            conn.send(chunk)
        conn.send(tail)
        job = api_json(conn).get("job_id", "")
    if not re.fullmatch(r"[a-f0-9]{32}", job):
        raise RuntimeError("DroxionClips did not return a valid job ID.")
    return job


def get_clips(job, requested, folder):
    deadline = time.monotonic() + 3600
    previous = None
    while time.monotonic() < deadline:
        with closing(api_connection(30)) as conn:
            conn.request("GET", f"{JOBS}/{job}")
            result = api_json(conn)
        message = result.get("message", "")
        if message != previous:
            print(message, flush=True)
            previous = message
        if result.get("status") == "error":
            raise RuntimeError(message or "DroxionClips could not render the recording.")
        if result.get("status") == "done":
            break
        time.sleep(4)
    else:
        raise RuntimeError(f"Timed out waiting for DroxionClips job {job}.")
    expected = {f"{JOBS}/{job}/files/D6X8_Highlight_{n:02d}.mp4" for n in range(1, requested + 1)}
    urls = [clip["url"] for clip in result.get("clips", [])]
    if len(urls) != requested or set(urls) != expected:
        raise RuntimeError("DroxionClips returned unexpected clip files.")
    for url in sorted(urls):
        target = folder / url.rsplit("/", 1)[-1]
        partial = target.with_suffix(".part")
        try:
            with closing(api_connection(90)) as conn:
                conn.request("GET", url + "?download=true")
                response = conn.getresponse()
                if response.status != 200 or response.getheader("Content-Type", "").split(";")[0] != "video/mp4":
                    raise RuntimeError(f"Clip download failed (HTTP {response.status}).")
                with partial.open("wb") as output:
                    shutil.copyfileobj(response, output, 1024 * 1024)
                size = response.getheader("Content-Length")
                if size is not None and partial.stat().st_size != int(size):
                    raise RuntimeError("Clip download was incomplete.")
            partial.replace(target)
        finally:
            partial.unlink(missing_ok=True)


def download_video(reference, folder, ffmpeg_location):
    ffmpeg = ffmpeg_location or shutil.which("ffmpeg")
    executable = shutil.which("yt-dlp")
    if not executable and not importlib.util.find_spec("yt_dlp"):
        raise RuntimeError("yt-dlp was not found. Install it or run this from the Windows setup where it worked.")
    if not ffmpeg or not Path(ffmpeg).exists():
        raise RuntimeError("FFmpeg was not found. Run with --ffmpeg-location followed by ffmpeg.exe or its bin folder.")
    command = [executable] if executable else [sys.executable, "-m", "yt_dlp"]
    target = folder / "source.mp4"
    command += [
        "--no-playlist", "--ffmpeg-location", str(ffmpeg), "--merge-output-format", "mp4",
        "--max-filesize", str(MAX_BYTES), "--socket-timeout", "20", "--retries", "2",
        "--match-filter", "live_status!=is_live & live_status!=is_upcoming & live_status!=post_live & duration<=10800",
        "-f", "bv[ext=mp4][vcodec^=avc][height<=1080]+ba[ext=m4a]/b[ext=mp4][height<=1080]",
        "-o", str(target.with_suffix(".%(ext)s")), "--", reference["watch_url"],
    ]
    if node := shutil.which("node"):
        position = 1 if executable else 3
        command[position:position] = ["--js-runtimes", f"node:{node}"]
    print("Downloading and merging the video on this PC…", flush=True)
    try:
        subprocess.run(command, check=True, timeout=1800)
    except subprocess.CalledProcessError:
        raise RuntimeError("The local download failed. See the yt-dlp message above.") from None
    if not target.is_file():
        raise RuntimeError("No playable MP4 was downloaded. Try a finished recording within the size and duration limits.")
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ffmpeg-location", help="FFmpeg executable or its bin folder, if not on PATH")
    parser.add_argument("--output", type=Path, default=Path.home() / "Downloads" / "DroxionClips",
                        help="Parent folder for each job and its downloaded MP4s")
    args = parser.parse_args()
    try:
        if input("Do you own this recording or have permission to edit and upload it? [y/N] ").strip().lower() != "y":
            return 0
        source = input("Paste a YouTube link or a local video file path: ").strip().strip('"')
        reference = creator_video_reference(source)
        local = Path(source).expanduser() if not reference else None
        if local is not None and not local.is_file():
            raise RuntimeError("Enter a valid YouTube link or an existing local video file.")
        count = input("Number of clips [1–5, default 3]: ").strip() or "3"
        if count not in ("1", "2", "3", "4", "5"):
            raise RuntimeError("Choose a clip count from 1 to 5.")
        caption = input("Caption text (leave blank for no caption): ").strip()
        if len(caption) > 65:
            raise RuntimeError("Captions can contain up to 65 characters.")
        font = FONTS[0]
        if caption:
            print("Fonts: " + ", ".join(FONTS))
            font = input(f"Font [{font}]: ").strip().lower() or font
            if font not in FONTS:
                raise RuntimeError("Choose a font from the list.")
        folder = args.output.expanduser().resolve() / time.strftime("%Y%m%d-%H%M%S")
        folder.mkdir(parents=True, exist_ok=False)
        print(f"Job files: {folder}", flush=True)
        path = local if local is not None else download_video(reference, folder, args.ffmpeg_location)
        job = upload(path, int(count), caption, font)
        print(f"DroxionClips job: {job}", flush=True)
        get_clips(job, int(count), folder)
        print(f"Finished. Open your MP4 clips in {folder}")
        return 0
    except (OSError, RuntimeError, subprocess.SubprocessError, http.client.HTTPException) as error:
        print(f"Stopped: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
