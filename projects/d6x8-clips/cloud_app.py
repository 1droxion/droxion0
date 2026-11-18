"""Secure single-operator web beta for DroxionClips.

The online editor does not expose the local OBS file watcher.
The Render web beta is password protected, runs one short render at a time,
and deletes uploaded originals after processing.
"""
import hmac
import hashlib
import http.client
import io
import json
import os
import re
import secrets
import shutil
import threading
import time
import uuid
import zipfile
from pathlib import Path
from urllib.parse import urlparse, urlunsplit

from fastapi import FastAPI, Form, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from creator_sources import creator_video_reference
from youtube_import import HIGHLIGHT_COUNT, MAX_CLIP_SECONDS, MIN_SOURCE_SECONDS, download_youtube
from app import (
    HERE, THEMES, CAPTION_FONTS, PinnedHTTPSConnection,
    direct_video_address, duration_of, audio_energy, motion_energy,
    render, select_highlights,
)

SECRET = os.environ.get("DROXIONCLIPS_BETA_PASSWORD", "")
SESSION_SECRET = os.environ.get("DROXIONCLIPS_SESSION_SECRET", "")
MAX_BYTES = 120 * 1024 * 1024
PUBLIC_MAX_BYTES = 50 * 1024 * 1024
PUBLIC_MAX_DURATION = 300
PUBLIC_YOUTUBE_MAX_DURATION = 600
PUBLIC_DAILY_GLOBAL_CAP = 12
PUBLIC_DAILY_PER_IP_CAP = 2
PUBLIC_ORIGINS = ("https://droxion.com", "https://www.droxion.com", "https://clips.droxion.com")
PUBLIC_TRIAL_ENABLED = os.environ.get("DROXIONCLIPS_PUBLIC_TRIAL_ENABLED", "0") == "1"
MAX_DURATION = 600
RETENTION = 60 * 60
COOKIE = "droxionclips_beta"
WORKSPACE = Path(os.environ.get("DROXIONCLIPS_WORKDIR", "/tmp/droxionclips-beta")).resolve()
WORKSPACE.mkdir(parents=True, exist_ok=True)

site = FastAPI(title="DroxionClips Web Beta", docs_url=None, redoc_url=None, openapi_url=None)
site.add_middleware(TrustedHostMiddleware, allowed_hosts=[
    "*.onrender.com", "droxion.com", "*.droxion.com",
    "localhost", "127.0.0.1", "testserver",
])
site.add_middleware(
    CORSMiddleware, allow_origins=list(PUBLIC_ORIGINS),
    allow_methods=["GET", "POST"], allow_headers=["content-type"],
    allow_credentials=False,
)
site.mount("/static", StaticFiles(directory=HERE / "static"), name="static")
app = site
jobs = {}
guard = threading.BoundedSemaphore(1)
lock = threading.RLock()
login_attempts = {}
FILE_PATTERN = re.compile(r"D6X8_Highlight_0[1-5]\.mp4")
JOB_PATTERN = re.compile(r"[a-f0-9]{32}")
public_usage = {"day": "", "total": 0, "ip": {}}

def configured():
    return len(SECRET) >= 14 and len(SESSION_SECRET) >= 32

def authorized(request: Request) -> bool:
    if not configured():
        return False
    cookie = request.cookies.get(COOKIE, "")
    try:
        stamp_str, signature = cookie.split(".", 1)
        stamp = int(stamp_str)
    except (ValueError, TypeError):
        return False
    if stamp > int(time.time()) + 60 or int(time.time()) - stamp > 8 * 3600:
        return False
    expected = hmac.new(SESSION_SECRET.encode(), stamp_str.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(signature, expected)

def require_auth(request: Request):
    if not authorized(request):
        raise HTTPException(401, "Sign in to the private DroxionClips beta first.")

PUBLIC_ORIGIN = os.environ.get(
    "DROXIONCLIPS_PUBLIC_ORIGIN", "https://droxionclips-editor-beta.onrender.com"
).rstrip("/")

def require_same_origin(request: Request):
    """Reject cross-site writes, using the browser-facing origin behind Render.

    A proxy can rewrite ASGI's server/request URL, so comparing Origin to
    request.url.hostname can reject legitimate logins. Instead require the
    exact configured public HTTPS origin. Permit local/test origins only when
    the Host header is a loopback or test host.
    """
    if request.headers.get("sec-fetch-site", "").lower() == "cross-site":
        raise HTTPException(403, "Cross-site requests are not allowed.")
    origin = request.headers.get("origin")
    if not origin:
        return
    try:
        parsed = urlparse(origin)
        configured = urlparse(PUBLIC_ORIGIN)
        host_header = request.headers.get("host", "")
        request_host = urlparse("//" + host_header).hostname
        if (parsed.username or parsed.password or parsed.path not in ("", "/")
                or parsed.query or parsed.fragment or not parsed.hostname):
            raise ValueError("Invalid origin.")
        public_ok = (
            parsed.scheme == "https"
            and parsed.hostname.lower() == configured.hostname.lower()
            and parsed.port in (None, 443)
        )
        local_ok = (
            request_host in ("testserver", "localhost", "127.0.0.1")
            and parsed.hostname.lower() == request_host
            and parsed.scheme in ("http", "https")
            and parsed.port in (None, 80, 443, request.url.port)
        )
    except (ValueError, AttributeError):
        public_ok = local_ok = False
    if not (public_ok or local_ok):
        raise HTTPException(403, "Open the DroxionClips studio directly to submit.")

def clean_expired():
    deadline = time.time() - RETENTION
    for directory in WORKSPACE.iterdir():
        if directory.is_dir() and JOB_PATTERN.fullmatch(directory.name):
            if directory.stat().st_mtime < deadline:
                with lock:
                    jobs.pop(directory.name, None)
                shutil.rmtree(directory, ignore_errors=True)

def periodic_cleanup():
    """Remove old exported clips even when no new uploads arrive."""
    while True:
        time.sleep(900)
        try:
            clean_expired()
        except OSError:
            pass

threading.Thread(target=periodic_cleanup, daemon=True, name="clip-expiration").start()


def update(job_id: str, **data):
    with lock:
        if job_id in jobs:
            jobs[job_id].update(data)

def download_direct_limited(url: str, target: Path, limit: int = MAX_BYTES):
    endpoint = direct_video_address(url)
    if not endpoint:
        raise ValueError("Use a direct public HTTPS MP4/MOV video-file URL, or upload your recording.")
    parsed, address = endpoint
    conn = PinnedHTTPSConnection(parsed.hostname, address)
    path = urlunsplit(("", "", parsed.path, parsed.query, ""))
    deadline = time.monotonic() + 120
    try:
        conn.request("GET", path, headers={"Accept-Encoding": "identity"})
        with conn.getresponse() as response:
            if response.status != 200:
                raise ValueError("The direct file URL didn't return a video. Upload the file instead.")
            header = response.getheader("Content-Length")
            if header and header.isdecimal() and int(header) > limit:
                raise ValueError("The video is too large for this beta (120 MB maximum).")
            total = 0
            with target.open("wb") as out:
                while part := response.read1(256 * 1024):
                    total += len(part)
                    if total > limit:
                        raise ValueError("The video exceeds the maximum file size for this editing mode.")
                    if time.monotonic() > deadline:
                        raise ValueError("The direct video download timed out. Upload the video instead.")
                    out.write(part)
    except (OSError, http.client.HTTPException) as error:
        raise ValueError("Unable to read that direct video URL. Upload the recording instead.") from error
    finally:
        conn.close()

def process(job_id, source, template, caption_text, caption_font, source_url, public=False):
    folder = source.parent
    try:
        update(job_id, status="processing", progress=10, message="Opening gameplay video")
        youtube = bool(public and source_url and creator_video_reference(source_url))
        if youtube:
            update(job_id, progress=8, message="Importing YouTube video")
            download_youtube(source_url, source, PUBLIC_MAX_BYTES, PUBLIC_YOUTUBE_MAX_DURATION)
        elif source_url:
            download_direct_limited(source_url, source, PUBLIC_MAX_BYTES if public else MAX_BYTES)
        length = duration_of(source)
        max_duration = PUBLIC_YOUTUBE_MAX_DURATION if youtube else (PUBLIC_MAX_DURATION if public else MAX_DURATION)
        if youtube and length < MIN_SOURCE_SECONDS:
            raise ValueError("Use a video at least 2 minutes 30 seconds long for five 30–35 second clips.")
        if not 12 <= length <= max_duration:
            raise ValueError(f"Choose a video between 12 seconds and {max_duration // 60} minutes.")
        update(job_id, progress=26, message="Measuring motion and audio activity")
        seconds = min(MAX_CLIP_SECONDS, int(length // HIGHLIGHT_COUNT)) if youtube else None
        picks = select_highlights(audio_energy(source, length), motion_energy(source, length),
                                  length, count=HIGHLIGHT_COUNT, clip_seconds=seconds)
        clips = []
        for i, clip in enumerate(picks, 1):
            name = f"D6X8_Highlight_{i:02d}.mp4"
            render(source, folder / name, clip["start"], clip["end"], template, i, caption_text, caption_font)
            prefix = "/api/public/jobs" if public else "/api/jobs"
            clips.append({**clip, "number": i, "url": f"{prefix}/{job_id}/files/{name}"})
            update(job_id, progress=min(95, 28 + 13 * i), message=f"Rendering highlight {i} of 5", clips=list(clips))
        update(job_id, status="done", progress=100, message="Five clips ready — choose your favorites", clips=clips)
    except ValueError as error:
        update(job_id, status="error", message=str(error), clips=[])
    except Exception:
        update(job_id, status="error", message="This video could not be processed. Try an MP4 recording.", clips=[])
    finally:
        for file in ("source.mp4", "caption.txt", "overlay-font.ttf", "caption-font.ttf"):
            (folder / file).unlink(missing_ok=True)
        try:
            if jobs[job_id]["status"] == "error":
                shutil.rmtree(folder, ignore_errors=True)
        finally:
            guard.release()

@site.middleware("http")
async def limits_and_headers(request: Request, call_next):
    early = None
    if request.method == "POST" and request.url.path in ("/api/jobs", "/api/public/jobs"):
        is_public = request.url.path.startswith("/api/public/")
        if not is_public and not authorized(request):
            early = JSONResponse({"detail": "Sign in to the private beta first."}, status_code=401)
        elif request.headers.get("content-length", "").isdigit():
            maximum = PUBLIC_MAX_BYTES if is_public else MAX_BYTES
            if int(request.headers["content-length"]) > maximum + 1024 * 1024:
                early = JSONResponse({"detail": "The file exceeds the upload limit."}, status_code=413)
        else:
            early = JSONResponse({"detail": "Upload size is required."}, status_code=411)
    response = early if early is not None else await call_next(request)
    # Early rejection skips CORSMiddleware; return readable errors to our editor.
    if early is not None and request.url.path.startswith("/api/public/"):
        origin = request.headers.get("origin")
        if origin in PUBLIC_ORIGINS:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Vary"] = "Origin"
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-Robots-Tag"] = "noindex, nofollow"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response

def signin_html(message=""):
    error = '<p style="color:#ff9aa9">'+message+'</p>' if message else ""
    return ('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>DroxionClips · Private Beta</title>'
            '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px system-ui;background:radial-gradient(circle at 85% 20%,#4b1650,transparent 50%),#0b090e;color:#fff}'
            'main{width:min(90vw,450px);padding:32px;border:1px solid #b5e122;border-radius:20px;background:#17131e}'
            'h1{font-size:30px;letter-spacing:-.04em}h1 span{color:#d4ff00}p{color:#c9bed0;line-height:1.55}'
            'input{width:100%;box-sizing:border-box;padding:14px;border:1px solid #aaa;background:#0b090e;color:#fff;border-radius:10px;font-size:17px}'
            'button{margin-top:14px;width:100%;padding:15px;border:0;border-radius:10px;background:#d4ff00;color:#111;font-weight:900;font-size:16px;cursor:pointer}'
            'a{color:#d4ff00}</style><main><h1>Droxion<span>Clips</span></h1>'
            '<p>Private web beta. Sign in to generate and download five highlights from an authorized recording.</p>'
            + error + '<form action="/login" method="post"><label for="password">Beta password</label><input id="password" type="password" name="password" autocomplete="current-password" required>'
            '<button type="submit">Open Creator Studio</button></form>'
            '<p style="font-size:13px">No payment required. For your own content only. '
            '<a href="https://droxion.com/">Back to Droxion</a>.</p></main></html>')

@site.get("/api/health")
def health():
    return {"status": "ok", "service": "droxionclips-web-beta", "configured": configured()}

@site.get("/login", response_class=HTMLResponse)
def login_page(request: Request):
    if authorized(request):
        return RedirectResponse("/", status_code=303)
    return HTMLResponse(signin_html())

@site.post("/login")
async def login_submit(request: Request, password: str=Form(...)):
    require_same_origin(request)
    ip = request.client.host if request.client else "unknown"
    now = time.monotonic()
    with lock:
        attempts = [t for t in login_attempts.get(ip, []) if now - t < 900]
        if len(attempts) >= 10:
            return HTMLResponse(signin_html("Too many attempts. Try later."), status_code=429)
        if not configured() or not hmac.compare_digest(password, SECRET):
            attempts.append(now)
            login_attempts[ip] = attempts
            return HTMLResponse(signin_html("Incorrect beta password."), status_code=401)
        login_attempts.pop(ip, None)
    stamp = str(int(time.time()))
    signature = hmac.new(SESSION_SECRET.encode(), stamp.encode(), hashlib.sha256).hexdigest()
    response = RedirectResponse("/", status_code=303)
    response.set_cookie(COOKIE, stamp+"."+signature, max_age=8*3600,
                        httponly=True, secure=True, samesite="strict", path="/")
    return response

@site.post("/logout")
def logout(request: Request):
    require_same_origin(request)
    response = RedirectResponse("/login", status_code=303)
    response.delete_cookie(COOKIE)
    return response

@site.get("/", response_class=HTMLResponse)
def homepage(request: Request):
    if not authorized(request):
        return RedirectResponse("/login", status_code=303)
    html = (HERE / "index.html").read_text(encoding="utf-8")
    # OBS can only watch a folder on the creator's own computer.
    html = re.sub(r'<section id="obs".*?</section>', "", html, count=1, flags=re.S)
    html = html.replace('/static/studio.js', '/static/cloud.js')
    html = html.replace('<link rel="stylesheet" href="/static/studio.css">',
                        '<link rel="stylesheet" href="/static/studio.css"><link rel="stylesheet" href="/static/cloud.css">')
    html = html.replace('Direct public HTTPS MP4/MOV or your own YouTube video/live link. For YouTube, also upload the original recording — it is not downloaded from YouTube.',
        'Direct public HTTPS MP4/MOV file URL (auto-imported), or your own YouTube video/live link alongside your original uploaded recording.')
    html = html.replace('</form>', '<label class="rights-consent" for="rights"><input id="rights" type="checkbox" required> I own this recording or have permission to process it.</label></form>', 1)
    html = html.replace('850 MB max', '120 MB max')
    html = html.replace('No AI · Five clips · Real exports', 'Private beta · Five clips · Real exports')
    html = html.replace("</main>", '<div class="web-note">Secure private beta · Files are deleted after processing · 120 MB / 10 min maximum · YouTube watch links require your original file</div></main>')
    return HTMLResponse(html)

@site.post("/api/jobs")
async def submit_job(request: Request, video: UploadFile | None=File(default=None),
                     url: str | None=Form(default=None), template: str=Form(default="neon"),
                     captions: bool=Form(default=False), caption_text: str=Form(default=""),
                     caption_font: str=Form(default="bebasneue"),
                     rights: bool=Form(default=False)):
    require_auth(request)
    require_same_origin(request)
    if not rights:
        raise HTTPException(400, "Confirm you own or have permission to use this footage.")
    url = (url or "").strip()
    youtube = creator_video_reference(url) if url else None
    if youtube and not video:
        raise HTTPException(400, "YouTube link recognized. Please upload your original recording from YouTube Studio or OBS.")
    if not youtube and bool(video) == bool(url):
        raise HTTPException(400, "Choose a video upload or a direct public HTTPS MP4 file link.")
    if template not in THEMES or caption_font not in CAPTION_FONTS:
        raise HTTPException(400, "Choose a supported video style and font.")
    caption_text = caption_text.strip() if captions else ""
    if captions and (not caption_text or len(caption_text)>65 or len(caption_text.splitlines())!=1):
        raise HTTPException(400, "Enter one caption line of up to 65 characters.")
    if url and not youtube and not direct_video_address(url):
        raise HTTPException(400, "Use a direct public HTTPS .mp4/.mov file link, not a YouTube watch page.")
    if video and not (video.filename or "").lower().endswith((".mp4",".mov",".m4v",".mkv",".webm")):
        raise HTTPException(400, "Video format must be MP4, MOV, M4V, MKV or WebM.")
    if not guard.acquire(blocking=False):
        raise HTTPException(409, "Another video is processing. Please try after it finishes.")
    folder = None
    accepted = False
    try:
        clean_expired()
        job_id = uuid.uuid4().hex
        folder = WORKSPACE / job_id
        folder.mkdir(parents=True, exist_ok=False)
        source = folder / "source.mp4"
        if video:
            total = 0
            with source.open("wb") as output:
                while chunk := await video.read(1024 * 1024):
                    total += len(chunk)
                    if total > MAX_BYTES:
                        raise HTTPException(413, "Maximum video upload size is 120 MB.")
                    output.write(chunk)
            await video.close()
            if not total:
                raise HTTPException(400, "The uploaded recording was empty.")
        with lock:
            jobs[job_id] = {"status": "queued", "progress": 0, "message": "Queued",
                            "created": time.time(), "clips": [],
                            "video_reference": youtube}
        worker = threading.Thread(target=process, daemon=True,
                                  args=(job_id,source,template,caption_text,caption_font,
                                        "" if youtube else url))
        worker.start()
        accepted = True
        return {"job_id": job_id}
    finally:
        if not accepted:
            if folder:
                shutil.rmtree(folder, ignore_errors=True)
            guard.release()

def require_job_access(request: Request, job_id: str):
    """Public clip URLs act as 128-bit unguessable capability links."""
    if PUBLIC_TRIAL_ENABLED and JOB_PATTERN.fullmatch(job_id):
        with lock:
            job = jobs.get(job_id)
            if job and job.get("public"):
                return
    require_auth(request)


@site.get("/api/jobs/{job_id}")
def job_status(job_id: str, request: Request):
    require_job_access(request, job_id)
    if not JOB_PATTERN.fullmatch(job_id):
        raise HTTPException(404, "Job not found.")
    with lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(404, "Job not found or expired.")
        return {k:v for k,v in job.items() if k != "created"}

@site.get("/api/jobs/{job_id}/files/{filename}")
def clip_file(job_id: str, filename: str, request: Request, download: bool=False):
    require_job_access(request, job_id)
    if not JOB_PATTERN.fullmatch(job_id) or not FILE_PATTERN.fullmatch(filename):
        raise HTTPException(404, "Clip not found.")
    with lock:
        job = jobs.get(job_id)
        if not job or job["status"] != "done":
            raise HTTPException(404, "Clip not ready.")
    path = WORKSPACE / job_id / filename
    if not path.is_file():
        raise HTTPException(404, "Clip no longer available.")
    return FileResponse(path, media_type="video/mp4",
                        filename=filename,
                        content_disposition_type="attachment" if download else "inline")

@site.get("/api/jobs/{job_id}/selected.zip")
def selected_zip(job_id: str, request: Request, clips: str="1,2,3,4,5"):
    require_job_access(request, job_id)
    if not JOB_PATTERN.fullmatch(job_id):
        raise HTTPException(404, "Job not found.")
    if not re.fullmatch(r"[1-5](?:,[1-5]){0,4}", clips):
        raise HTTPException(400, "Select clip numbers 1 through 5.")
    selected = sorted(set(int(n) for n in clips.split(",")))
    with lock:
        job = jobs.get(job_id)
        if not job or job["status"] != "done":
            raise HTTPException(404, "Clips not ready.")
    folder = WORKSPACE / job_id
    archive = folder / ("DroxionClips_"+"-".join(map(str,selected))+".zip")
    if not archive.exists():
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_STORED) as bundle:
            for number in selected:
                filename = f"D6X8_Highlight_{number:02d}.mp4"
                path = folder / filename
                if not path.is_file():
                    raise HTTPException(404, "A selected clip is no longer available.")
                bundle.write(path, arcname=f"DroxionClips_{number:02d}.mp4")
    return FileResponse(archive, filename="DroxionClips_Selected.zip",
                        media_type="application/zip")


# Public trial uses an explicit global cap and per-IP cap; no unlimited rendering.
def check_public_trial(request: Request):
    if not PUBLIC_TRIAL_ENABLED:
        raise HTTPException(503, "Online clipping is temporarily unavailable.")
    origin = request.headers.get("origin", "")
    if origin not in PUBLIC_ORIGINS or request.headers.get("sec-fetch-site","").lower() == "cross-site":
        # It is normal that an approved public site appears as cross-site to the API
        # because this API uses an onrender.com hostname.
        if origin not in PUBLIC_ORIGINS:
            raise HTTPException(403, "Open the editor from droxion.com.")
    return request.client.host if request.client else "unknown"


def public_job_or_404(job_id: str):
    if not JOB_PATTERN.fullmatch(job_id):
        raise HTTPException(404, "Clip job not found.")
    with lock:
        job = jobs.get(job_id)
        if not job or not job.get("public"):
            raise HTTPException(404, "Clip job not found.")
    return job


@site.post("/api/public/jobs")
async def create_public_job(
    request: Request, video: UploadFile | None=File(default=None),
    url: str=Form(default=""), template: str=Form(default="neon"),
    captions: bool=Form(default=False), caption_text: str=Form(default=""),
    caption_font: str=Form(default="bebasneue"),
    rights: bool=Form(default=False)
):
    ip = check_public_trial(request)
    if not rights:
        raise HTTPException(400, "Confirm you own or have permission to use the footage.")
    url = (url or "").strip()
    yt = creator_video_reference(url) if url else None
    if yt and yt["kind"] == "live" and not video:
        raise HTTPException(400, "For a finished livestream, paste its YouTube watch link or upload the OBS recording.")
    if not yt and bool(video) == bool(url):
        raise HTTPException(400, "Paste a YouTube video link, a direct HTTPS MP4/MOV link, or upload your recording.")
    if url and not yt and not direct_video_address(url):
        raise HTTPException(400, "Use a YouTube video link or a direct public HTTPS MP4/MOV file link.")
    if template not in THEMES or caption_font not in CAPTION_FONTS:
        raise HTTPException(400, "Select a supported clip style and caption font.")
    caption_text = caption_text.strip() if captions else ""
    if captions and (not caption_text or len(caption_text)>65 or len(caption_text.splitlines())!=1):
        raise HTTPException(400, "Enter one caption line of up to 65 characters.")
    if video and not (video.filename or "").lower().endswith((".mp4",".mov",".m4v",".mkv",".webm")):
        raise HTTPException(400, "Supported files: MP4, MOV, M4V, MKV or WebM.")
    if video and video.size is not None and video.size > PUBLIC_MAX_BYTES:
        raise HTTPException(413, "Maximum online trial file size is 50 MB.")
    if not guard.acquire(blocking=False):
        raise HTTPException(409, "One video is processing. Try again shortly.")
    folder = None
    accepted = False
    try:
        day = time.strftime("%Y-%m-%d", time.gmtime())
        with lock:
            if public_usage["day"] != day:
                public_usage.update(day=day,total=0,ip={})
            if public_usage["total"] >= PUBLIC_DAILY_GLOBAL_CAP:
                raise HTTPException(429, "Today's free trial capacity has been reached.")
            if public_usage["ip"].get(ip,0) >= PUBLIC_DAILY_PER_IP_CAP:
                raise HTTPException(429, "You've reached today's two-video trial limit.")
        clean_expired()
        job_id = uuid.uuid4().hex
        folder = WORKSPACE / job_id
        folder.mkdir(parents=True, exist_ok=False)
        source = folder / "source.mp4"
        if video:
            total = 0
            with source.open("wb") as output:
                while chunk := await video.read(1024*1024):
                    total += len(chunk)
                    if total > PUBLIC_MAX_BYTES:
                        raise HTTPException(413, "Maximum online trial file size is 50 MB.")
                    output.write(chunk)
            await video.close()
            if total == 0:
                raise HTTPException(400, "Your uploaded video is empty.")
        with lock:
            # Re-check caps under lock after file has been uploaded.
            day = time.strftime("%Y-%m-%d", time.gmtime())
            if public_usage["day"] != day:
                public_usage.update(day=day,total=0,ip={})
            if public_usage["total"] >= PUBLIC_DAILY_GLOBAL_CAP or public_usage["ip"].get(ip,0) >= PUBLIC_DAILY_PER_IP_CAP:
                raise HTTPException(429, "Today's free trial limit has been reached.")
            public_usage["total"] += 1
            public_usage["ip"][ip] = public_usage["ip"].get(ip,0)+1
            jobs[job_id] = {"status":"queued","progress":0,"message":"Queued for clipping",
                            "created":time.time(),"clips":[],"public":True}
        threading.Thread(
            target=process, daemon=True,
            args=(job_id,source,template,caption_text,caption_font,"" if video else (yt["watch_url"] if yt else url),True),
        ).start()
        accepted = True
        return {"job_id":job_id}
    finally:
        if not accepted:
            if folder:
                shutil.rmtree(folder,ignore_errors=True)
            guard.release()


@site.get("/api/public/jobs/{job_id}")
def public_status(job_id: str, request: Request):
    public_job_or_404(job_id)
    return job_status(job_id,request)


@site.get("/api/public/jobs/{job_id}/files/{filename}")
def public_clip_file(job_id: str, filename: str, request: Request, download: bool=False):
    public_job_or_404(job_id)
    return clip_file(job_id,filename,request,download=download)


@site.get("/api/public/jobs/{job_id}/selected.zip")
def public_selected_zip(job_id: str, request: Request, clips: str="1,2,3,4,5"):
    public_job_or_404(job_id)
    return selected_zip(job_id,request,clips=clips)
