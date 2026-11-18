"""Secure single-operator web beta for DroxionClips.

This intentionally does NOT scrape YouTube or expose the OBS file watcher.
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
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from creator_sources import creator_video_reference
from app import (
    HERE, THEMES, CAPTION_FONTS, PinnedHTTPSConnection,
    direct_video_address, duration_of, audio_energy, motion_energy,
    render, select_highlights,
)

SECRET = os.environ.get("DROXIONCLIPS_BETA_PASSWORD", "")
SESSION_SECRET = os.environ.get("DROXIONCLIPS_SESSION_SECRET", "")
MAX_BYTES = 120 * 1024 * 1024
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
site.mount("/static", StaticFiles(directory=HERE / "static"), name="static")
app = site
jobs = {}
guard = threading.BoundedSemaphore(1)
lock = threading.RLock()
login_attempts = {}
FILE_PATTERN = re.compile(r"D6X8_Highlight_0[1-5]\.mp4")
JOB_PATTERN = re.compile(r"[a-f0-9]{32}")

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

def require_same_origin(request: Request):
    """Browser CSRF defense; SameSite cookie and same-host Origin required."""
    origin = request.headers.get("origin")
    if origin:
        parsed = urlparse(origin)
        if parsed.hostname != request.url.hostname or parsed.port not in (None, request.url.port):
            raise HTTPException(403, "Open the DroxionClips studio directly to submit.")
        if parsed.scheme not in ("https", "http"):
            raise HTTPException(403, "Invalid request origin.")
    if request.headers.get("sec-fetch-site") == "cross-site":
        raise HTTPException(403, "Cross-site requests are not allowed.")

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

def download_direct_limited(url: str, target: Path):
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
            if header and header.isdecimal() and int(header) > MAX_BYTES:
                raise ValueError("The video is too large for this beta (120 MB maximum).")
            total = 0
            with target.open("wb") as out:
                while part := response.read1(256 * 1024):
                    total += len(part)
                    if total > MAX_BYTES:
                        raise ValueError("The video is too large for this beta (120 MB maximum).")
                    if time.monotonic() > deadline:
                        raise ValueError("The direct video download timed out. Upload the video instead.")
                    out.write(part)
    except (OSError, http.client.HTTPException) as error:
        raise ValueError("Unable to read that direct video URL. Upload the recording instead.") from error
    finally:
        conn.close()

def process(job_id, source, template, caption_text, caption_font, source_url):
    folder = source.parent
    try:
        update(job_id, status="processing", progress=10, message="Opening gameplay video")
        if source_url:
            download_direct_limited(source_url, source)
        length = duration_of(source)
        if not 12 <= length <= MAX_DURATION:
            raise ValueError("Choose a recording between 12 seconds and 10 minutes.")
        update(job_id, progress=26, message="Measuring motion and audio activity")
        picks = select_highlights(audio_energy(source, length), motion_energy(source, length), length)
        clips = []
        for i, clip in enumerate(picks, 1):
            name = f"D6X8_Highlight_{i:02d}.mp4"
            render(source, folder / name, clip["start"], clip["end"], template, i, caption_text, caption_font)
            clips.append({**clip, "number": i, "url": f"/api/jobs/{job_id}/files/{name}"})
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
    if request.method == "POST" and request.url.path == "/api/jobs":
        if not authorized(request):
            return JSONResponse({"detail": "Sign in to the private beta first."}, status_code=401)
        if request.headers.get("content-length", "").isdigit():
            if int(request.headers["content-length"]) > MAX_BYTES + 1024 * 1024:
                return JSONResponse({"detail": "Upload limit: 120 MB."}, status_code=413)
        else:
            return JSONResponse({"detail": "Upload size is required."}, status_code=411)
    response = await call_next(request)
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

@site.get("/api/jobs/{job_id}")
def job_status(job_id: str, request: Request):
    require_auth(request)
    if not JOB_PATTERN.fullmatch(job_id):
        raise HTTPException(404, "Job not found.")
    with lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(404, "Job not found or expired.")
        return {k:v for k,v in job.items() if k != "created"}

@site.get("/api/jobs/{job_id}/files/{filename}")
def clip_file(job_id: str, filename: str, request: Request, download: bool=False):
    require_auth(request)
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
    require_auth(request)
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
