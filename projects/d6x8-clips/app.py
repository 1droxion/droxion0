"""DroxionClips: local-only highlight tool, no customer accounts or billing."""
import http.client
import ipaddress
import json
import math
import re
import shutil
import socket
import subprocess
import threading
import time
import uuid
from pathlib import Path
from PIL import ImageFont
from pydantic import BaseModel
from creator_sources import creator_video_reference
from obs_watch import RecordingWatcher, safe_recordings_directory
from urllib.parse import urlparse, urlunsplit

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

HERE = Path(__file__).resolve().parent
WORKSPACE = HERE / "workspace"
WORKSPACE.mkdir(exist_ok=True)
MAX_BYTES = 850 * 1024 * 1024
MAX_DURATION = 2700
RETENTION = 24 * 60 * 60
LOCAL_HOSTS = ("localhost", "127.0.0.1", "[::1]", "testserver")
VIDEO_INPUT = ["-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,matroska,webm"]
THEMES = {
    "neon": ("0xD1FF35", "NEON RUSH"),
    "electric": ("0x00DFFF", "ELECTRIC"),
    "fire": ("0xFF693E", "FIRE MODE"),
    "royal": ("0xDAAE6B", "ROYAL"),
    "clean": ("0xFFFFFF", "CLEAN CUT"),
}
CAPTION_FONTS = {name: name for name in ("bebasneue", "montserrat", "poppins", "oswald", "anton")}
# Existing callers can still request the previous font identifiers.
CAPTION_FONTS.update(impact="anton", arial="montserrat", trebuchet="poppins",
                     georgia="montserrat", consolas="oswald")
app = FastAPI(title="DroxionClips", docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(LOCAL_HOSTS))
app.mount("/static", StaticFiles(directory=HERE / "static"), name="static")
jobs = {}
lock = threading.Lock()
processing = threading.BoundedSemaphore(1)


@app.middleware("http")
async def guard_upload(request: Request, call_next):
    if request.method == "POST" and request.url.path in ("/api/jobs", "/api/obs/start", "/api/obs/stop"):
        origin = request.headers.get("origin")
        if origin and origin != f"{request.url.scheme}://{request.headers['host']}":
            return JSONResponse({"detail": "Open the local studio to submit footage."}, 403)
        length = request.headers.get("content-length", "")
        if not length.isascii() or not length.isdecimal() or len(length) > 12:
            return JSONResponse({"detail": "A valid upload size is required."}, 411)
        if int(length) > MAX_BYTES + 1024 * 1024:
            return JSONResponse({"detail": "Maximum video size is 850 MB."}, 413)
        if request.url.path != "/api/jobs":
            if not request.headers.get("content-type", "").startswith("application/json"):
                return JSONResponse({"detail": "Send a JSON request from the local studio."}, 415)
            return await call_next(request)
        if not processing.acquire(blocking=False):
            return JSONResponse({"detail": "A clip job is running. Wait for it to finish."}, 409)
        try:
            return await call_next(request)
        finally:
            if not getattr(request.state, "worker_started", False):
                processing.release()
    return await call_next(request)


def cmd(args, timeout=900, cwd=None):
    return subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          timeout=timeout, check=True, cwd=cwd).stdout

def duration_of(path):
    result = cmd(["ffprobe", "-v", "error", *VIDEO_INPUT, "-select_streams", "v:0", "-show_entries", "format=duration:stream=width,height",
                  "-of", "json", str(path)], 30)
    probe = json.loads(result)
    streams = probe.get("streams", [])
    if not streams:
        raise ValueError("Choose a supported file containing a video track.")
    width, height = streams[0]["width"], streams[0]["height"]
    if max(width, height) > 4096 or width * height > 4096 * 2304:
        raise ValueError("Video resolution exceeds the 4K limit.")
    return float(probe["format"]["duration"])

def audio_energy(path, duration):
    n = math.ceil(duration)
    try:
        data = cmd(["ffmpeg", "-v", "error", *VIDEO_INPUT, "-i", str(path), "-t", str(duration), "-vn", "-ac", "1",
                    "-ar", "8000", "-f", "s16le", "pipe:1"])
        samples = np.frombuffer(data, dtype="<i2").astype(np.float32) / 32768
        usable = len(samples) // 8000 * 8000
        out = np.zeros(n)
        if usable:
            blocks = samples[:usable].reshape(-1, 8000)
            rms = np.sqrt(np.mean(blocks**2, axis=1) + 1e-8)
            db = 20 * np.log10(np.maximum(rms, 1e-5))
            out[:min(n, len(db))] = np.clip((db[:n] + 52) / 42, 0, 1)[:n]
        return out
    except (subprocess.SubprocessError, ValueError):
        return np.zeros(n)

def motion_energy(path, duration):
    n = math.ceil(duration)
    try:
        data = cmd(["ffmpeg", "-v", "error", "-filter_threads", "1", *VIDEO_INPUT, "-i", str(path), "-t", str(duration), "-an",
                    "-vf", "fps=1,scale=96:54,format=gray", "-f", "rawvideo", "pipe:1"])
        frame_size = 96 * 54
        count = len(data) // frame_size
        out = np.zeros(n)
        if count > 1:
            frames = np.frombuffer(data[:count * frame_size], dtype=np.uint8).reshape(count, frame_size)
            diffs = np.abs(frames[1:].astype(np.int16) - frames[:-1].astype(np.int16)).mean(axis=1)
            end = min(n - 1, len(diffs))
            out[1:end+1] = np.clip(diffs[:end] / 40.0, 0, 1)
        return out
    except (subprocess.SubprocessError, ValueError):
        return np.zeros(n)

def select_highlights(audio, motion, duration, count=5):
    if duration < 12:
        raise ValueError("Please upload a video of at least 12 seconds.")
    raw = np.clip(0.68 * audio + 0.32 * motion, 0, 1)
    n = len(raw)
    clip_len = min(22, max(2, int(duration / (count * 1.5))))
    clip_len = min(clip_len, max(2, int(duration // count)))
    smooth = np.convolve(raw, np.ones(max(2,clip_len//2))/max(2,clip_len//2), mode="same")
    selected = []
    if duration >= count * (clip_len + 2):
        for peak in np.argsort(-smooth, kind="stable"):
            start = max(0., min(duration - clip_len, float(peak - clip_len * .42)))
            end = start + clip_len
            if any(start < b + 1 and end > a - 1 for a, b in selected):
                continue
            selected.append((start, end))
            if len(selected) == count:
                break
    if len(selected) < count:
        # A clustered set of strong peaks can leave no space for five clips.
        # Search each of five disjoint time ranges in that case.
        selected = []
        for i in range(count):
            low = duration * i / count
            high = duration * (i + 1) / count
            options = range(math.ceil(low), math.floor(high - clip_len) + 1)
            start = max(options, key=lambda t: smooth[min(n - 1, int(t + clip_len / 2))], default=low)
            selected.append((start, min(high, start + clip_len)))
    found = [{"start":round(a,2),"end":round(b,2),
              "score":round(float(np.mean(raw[int(a):max(int(a)+1,int(b))])),3)}
             for a,b in selected[:count]]
    return sorted(found,key=lambda x:-x["score"])

def render(source, target, start, end, theme, index, caption_text="", caption_font="impact", caption_color="#FFFFFF"):
    """Render a 9:16 video with optional manually entered text burned into each clip."""
    color, label = THEMES[theme]
    if not re.fullmatch(r"#[0-9A-Fa-f]{6}", caption_color):
        raise ValueError("Invalid caption color.")
    ff_color = "0x" + caption_color[1:]
    overlays = [
        f"drawbox=x=0:y=0:w=iw:h=15:color={color}:t=fill",
        f"drawbox=x=0:y=1265:w=iw:h=15:color={color}:t=fill",
        f"drawtext=text='{label}':fontsize=35:fontcolor=white:x=44:y=142",
        f"drawtext=text='HIGHLIGHT {index:02d}':fontsize=30:fontcolor=white:x=40:y=1156",
    ]
    base_font = HERE / "static/fonts/bebasneue.ttf"
    shutil.copyfile(base_font, target.parent / "overlay-font.ttf")
    overlays = [item.replace("drawtext=", "drawtext=fontfile=overlay-font.ttf:")
                for item in overlays]
    if caption_text:
        # textfile avoids injecting user-provided text into FFmpeg's filter syntax.
        (target.parent / "caption.txt").write_text(caption_text, encoding="utf-8")
        family = CAPTION_FONTS[caption_font]
        shutil.copyfile(HERE / f"static/fonts/{family}.ttf", target.parent / "caption-font.ttf")
        # Scale long captions by measured glyph width so they fit inside 9:16.
        font = ImageFont.truetype(str(target.parent / "caption-font.ttf"), 57)
        size = min(57, int(620 * 57 / max(1, font.getlength(caption_text))))
        overlays.append(
            "drawtext=fontfile=caption-font.ttf:textfile=caption.txt:expansion=none:"
            f"fontsize={size}:fontcolor={ff_color}:borderw=3:bordercolor=black:"
            "box=1:boxcolor=black@0.65:boxborderw=16:"
            "x=(w-text_w)/2:y=1040"
        )
    filt = (
        "[0:v]split=2[bg][fg];"
        "[bg]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,boxblur=25:3[blur];"
        "[fg]scale=704:880:force_original_aspect_ratio=decrease[game];"
        "[blur][game]overlay=(W-w)/2:(H-h)/2[stage];"
        "[stage]" + ",".join(overlays) + "[v]"
    )
    cmd(["ffmpeg", "-y", "-v", "error", "-filter_complex_threads", "2", *VIDEO_INPUT, "-ss", str(start), "-i", str(source),
         "-t", str(max(1,end-start)), "-filter_complex", filt, "-map", "[v]",
         "-map", "0:a:0?", "-threads", "4", "-c:v", "libx264", "-preset", "veryfast", "-crf", "24",
         "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-b:a", "128k",
         "-movflags", "+faststart", str(target)], cwd=target.parent)

def direct_video_address(url):
    try:
        parsed = urlparse(url)
        if (parsed.scheme != "https" or parsed.port not in (None, 443)
                or parsed.username or parsed.password or not parsed.hostname
                or not re.search(r"\.(mp4|m4v|mov)$", parsed.path, re.I)):
            return None
        addresses = socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)
        if not addresses or not all(ipaddress.ip_address(entry[4][0]).is_global for entry in addresses):
            return None
        return parsed, addresses[0][4][0]
    except (OSError, ValueError):
        return None


def is_public_https_mp4(url):
    return direct_video_address(url) is not None


class PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, hostname, address):
        super().__init__(hostname, timeout=15)
        self._create_connection = lambda _, timeout, source: socket.create_connection(
            (address, 443), timeout, source
        )


def download_direct(url, dest):
    endpoint = direct_video_address(url)
    if not endpoint:
        raise ValueError("Use a direct public HTTPS MP4, M4V or MOV link, or upload the video instead.")
    parsed, address = endpoint
    path = urlunsplit(("", "", parsed.path, parsed.query, ""))
    connection = PinnedHTTPSConnection(parsed.hostname, address)
    deadline = time.monotonic() + 180
    try:
        connection.request("GET", path, headers={"Accept-Encoding": "identity"})
        with connection.getresponse() as response:
            if response.status != 200:
                raise ValueError("Could not open that direct video link. Upload the video instead.")
            total = 0
            with dest.open("wb") as output:
                while part := response.read1(256 * 1024):
                    total += len(part)
                    if total > MAX_BYTES:
                        raise ValueError("Video exceeds the 850 MB limit.")
                    if time.monotonic() > deadline:
                        raise ValueError("Video download timed out. Upload the video instead.")
                    output.write(part)
    except (OSError, http.client.HTTPException) as error:
        raise ValueError("Could not download that video. Upload the video instead.") from error
    finally:
        connection.close()


def expire_exports():
    cutoff = time.time() - RETENTION
    for folder in WORKSPACE.iterdir():
        if folder.is_dir() and re.fullmatch(r"[a-f0-9]{12,32}", folder.name):
            if folder.stat().st_mtime < cutoff:
                with lock:
                    jobs.pop(folder.name, None)
                shutil.rmtree(folder, ignore_errors=True)


def update(job_id, **fields):
    with lock:
        jobs[job_id].update(fields)

def process(job_id, source, theme, caption_text="", caption_font="impact", link=None):
    folder=source.parent
    try:
        update(job_id,status="processing",message="Reading video",progress=10)
        if link:
            download_direct(link, source)
        seconds=duration_of(source)
        if not 12<=seconds<=MAX_DURATION:
            raise ValueError("Video must be 12 seconds to 45 minutes long.")
        update(job_id,message="Finding reactions and motion",progress=25)
        picks=select_highlights(audio_energy(source,seconds),motion_energy(source,seconds),seconds)
        if len(picks)!=5:
            raise ValueError("Could not identify five clips.")
        clips=[]
        for i,clip in enumerate(picks,1):
            filename=f"D6X8_Highlight_{i:02d}.mp4"
            render(source,folder/filename,clip["start"],clip["end"],theme,i,caption_text,caption_font)
            clips.append({**clip,"number":i,"url":f"/api/jobs/{job_id}/files/{filename}"})
            update(job_id,message=f"Rendering {i} of 5",progress=30+i*13,clips=list(clips))
        update(job_id,status="done",progress=100,message="Five clips ready",clips=clips)
    except ValueError as error:
        update(job_id, status="error", message=str(error), clips=[])
    except (subprocess.SubprocessError, OSError, KeyError):
        update(job_id, status="error", message="Could not read or render this video. Check FFmpeg and try a supported video file.", clips=[])
    finally:
        try:
            if jobs[job_id]["status"] != "done":
                shutil.rmtree(folder, ignore_errors=True)
            else:
                for name in ("source.mp4", "caption.txt", "overlay-font.ttf", "caption-font.ttf"):
                    (folder / name).unlink(missing_ok=True)
        finally:
            processing.release()

@app.post("/api/jobs")
async def new_job(request: Request, video: UploadFile | None=File(default=None),
                  url: str | None=Form(default=None), template: str=Form(default="neon"),
                  captions: bool=Form(default=False), caption_text: str=Form(default=""),
                  caption_font: str=Form(default="impact")):
    youtube_ref = creator_video_reference(url) if url else None
    if youtube_ref:
        if not video:
            raise HTTPException(400, "This YouTube link identifies a video only. Upload your own original recording to create clips.")
    elif bool(video) == bool(url and url.strip()):
        raise HTTPException(400, "Choose a recording or direct video file link.")
    if template not in THEMES:
        raise HTTPException(400,"Invalid template.")
    if caption_font not in CAPTION_FONTS:
        raise HTTPException(400,"Invalid caption font.")
    if captions:
        caption_text = caption_text.strip()
        if not caption_text or len(caption_text) > 65 or len(caption_text.splitlines()) != 1:
            raise HTTPException(400,"Enter one caption line (1–65 characters).")
    else:
        caption_text = ""
    if url and not youtube_ref:
        try:
            parsed = urlparse(url.strip())
            if parsed.scheme != "https" or not parsed.hostname or not re.search(r"\.(mp4|m4v|mov)$", parsed.path, re.I):
                raise ValueError
        except ValueError:
            raise HTTPException(400, "Use a direct HTTPS MP4, M4V or MOV link, or upload the video instead.")
    expire_exports()
    job_id=uuid.uuid4().hex
    folder=WORKSPACE/job_id
    folder.mkdir(parents=True,exist_ok=True)
    source=folder/"source.mp4"
    if video:
        if not (video.filename or "").lower().endswith((".mp4",".mov",".mkv",".webm",".m4v")):
            shutil.rmtree(folder,ignore_errors=True)
            raise HTTPException(400,"Unsupported video format.")
        amount=0
        try:
            with open(source,"wb") as output:
                while part:=await video.read(1024*1024):
                    amount+=len(part)
                    if amount>MAX_BYTES:
                        raise HTTPException(413,"Maximum video size is 850 MB.")
                    output.write(part)
        except Exception:
            shutil.rmtree(folder,ignore_errors=True)
            raise
        finally:
            await video.close()
    with lock:
        jobs[job_id]={"status":"queued","progress":0,"message":"Queued","clips":[],
                      "video_reference": youtube_ref}
    worker = threading.Thread(
        target=process,
        args=(job_id, source, template, caption_text, caption_font,
              None if youtube_ref else (url.strip() if url else None)),
        daemon=True,
    )
    worker.start()
    request.state.worker_started = True
    return {"job_id":job_id}

class OBSWatchSettings(BaseModel):
    directory: str
    source_url: str = ""
    template: str = "neon"
    captions: bool = False
    caption_text: str = ""
    caption_font: str = "bebasneue"


def completed_obs_recording(source: Path, options: dict):
    """Queue one finished, creator-recorded OBS file. No stream downloading."""
    if not processing.acquire(blocking=False):
        return None
    folder = None
    try:
        expire_exports()
        job_id = uuid.uuid4().hex
        folder = WORKSPACE / job_id
        folder.mkdir(parents=True, exist_ok=False)
        target = folder / "source.mp4"
        # Copy only previously checked, directly contained recordings.
        if source.is_symlink() or source.stat().st_size > MAX_BYTES:
            raise ValueError("OBS recording must be a normal file under 850 MB.")
        with source.open("rb") as inp, target.open("wb") as out:
            shutil.copyfileobj(inp, out, length=1024 * 1024)
        with lock:
            jobs[job_id] = {"status": "queued", "progress": 0, "message": "OBS recording queued",
                            "clips": [], "video_reference": options.get("youtube_reference")}
        worker = threading.Thread(
            target=process,
            args=(job_id, target, options["template"], options["caption_text"], options["caption_font"], None),
            daemon=True)
        worker.start()
        return job_id
    except Exception:
        if folder:
            shutil.rmtree(folder, ignore_errors=True)
        processing.release()
        raise


obs_watcher = RecordingWatcher(completed_obs_recording)


@app.post("/api/obs/start")
def start_obs_watching(settings: OBSWatchSettings):
    if settings.template not in THEMES or settings.caption_font not in CAPTION_FONTS:
        raise HTTPException(400, "Invalid style or font.")
    caption_text = settings.caption_text.strip() if settings.captions else ""
    if settings.captions and (not caption_text or len(caption_text) > 65 or len(caption_text.splitlines()) != 1):
        raise HTTPException(400, "Enter one caption line (1–65 characters).")
    yt_ref = creator_video_reference(settings.source_url) if settings.source_url else None
    if settings.source_url and not yt_ref:
        raise HTTPException(400, "Use a valid YouTube watch or live link, or leave the reference empty.")
    try:
        directory = safe_recordings_directory(settings.directory)
        return obs_watcher.start(str(directory), {
            "template": settings.template, "caption_text": caption_text,
            "caption_font": settings.caption_font, "youtube_reference": yt_ref,
        })
    except (ValueError, OSError) as error:
        raise HTTPException(400, str(error)) from error


@app.post("/api/obs/stop")
def stop_obs_watching():
    return obs_watcher.stop()


@app.get("/api/obs/status")
def obs_watching_status():
    return obs_watcher.status()


@app.get("/api/jobs/{job_id}")
def job_info(job_id: str):
    if job_id not in jobs:
        raise HTTPException(404,"Job not found.")
    return jobs[job_id]

@app.get("/api/jobs/{job_id}/files/{filename}")
def download(job_id: str, filename: str, download: bool = False):
    if job_id not in jobs or jobs[job_id]["status"]!="done" or not re.fullmatch(r"D6X8_Highlight_0[1-5]\.mp4",filename):
        raise HTTPException(404,"Clip not found.")
    target=WORKSPACE/job_id/filename
    if not target.is_file():
        raise HTTPException(404,"Clip missing.")
    return FileResponse(target, media_type="video/mp4", filename=filename,
                        content_disposition_type="attachment" if download else "inline",
                        headers={"Cache-Control": "private, no-store"})

@app.get("/api/health")
def health():
    return {"status":"ok","mode":"local","ai":False}

@app.get("/",response_class=HTMLResponse)
def homepage():
    return (HERE/"index.html").read_text(encoding="utf-8")
