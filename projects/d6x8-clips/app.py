"""DroxionClips: local-only highlight tool, no customer accounts or billing."""
import ipaddress
import json
import math
import re
import shutil
import socket
import subprocess
import threading
import uuid
from pathlib import Path
from urllib.parse import urlparse

import numpy as np
import requests
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse

HERE = Path(__file__).resolve().parent
WORKSPACE = HERE / "workspace"
WORKSPACE.mkdir(exist_ok=True)
MAX_BYTES = 850 * 1024 * 1024
MAX_DURATION = 2700
THEMES = {
    "neon": ("0xD1FF35", "NEON RUSH"),
    "electric": ("0x00DFFF", "ELECTRIC"),
    "fire": ("0xFF693E", "FIRE MODE"),
    "royal": ("0xDAAE6B", "ROYAL"),
    "clean": ("0xFFFFFF", "CLEAN CUT"),
}
CAPTION_FONTS = {
    "impact": "Impact",
    "arial": "Arial",
    "trebuchet": "Trebuchet MS",
    "georgia": "Georgia",
    "consolas": "Consolas",
}
app = FastAPI(title="DroxionClips", docs_url=None, redoc_url=None)
jobs = {}
lock = threading.Lock()

def cmd(args, timeout=900, cwd=None):
    return subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          timeout=timeout, check=True, cwd=cwd).stdout

def duration_of(path):
    result = cmd(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                  "-of", "json", str(path)], 30)
    return float(json.loads(result)["format"]["duration"])

def audio_energy(path, duration):
    n = math.ceil(duration)
    try:
        data = cmd(["ffmpeg", "-v", "error", "-i", str(path), "-vn", "-ac", "1",
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
        data = cmd(["ffmpeg", "-v", "error", "-i", str(path), "-an",
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
    # Guaranteed five nonoverlapping candidates for short and longer inputs.
    if duration < count * (clip_len + 2):
        for i in range(count):
            low = duration * i / count
            high = duration * (i+1) / count
            upper = max(low, high-clip_len)
            options = np.arange(math.ceil(low), math.floor(upper)+1)
            start = float(max(options, key=lambda t: smooth[min(n-1, int(t+clip_len/2))])) if len(options) else low
            selected.append((start, min(duration, start+clip_len)))
    else:
        for peak in np.argsort(-smooth):
            start = max(0., min(duration-clip_len, float(peak-clip_len*.42)))
            end = start+clip_len
            if any(start < b+1 and end > a-1 for a,b in selected):
                continue
            selected.append((start,end))
            if len(selected)==count:
                break
        for i in range(count*6):
            if len(selected)==count:
                break
            start = max(0., min(duration-clip_len, (duration-clip_len)*(i+.5)/(count*6)))
            end=start+clip_len
            if not any(start < b+.2 and end > a-.2 for a,b in selected):
                selected.append((start,end))
    found = [{"start":round(a,2),"end":round(b,2),
              "score":round(float(np.mean(raw[int(a):max(int(a)+1,int(b))])),3)}
             for a,b in selected[:count]]
    return sorted(found,key=lambda x:-x["score"])

def render(source, target, start, end, theme, index, caption_text="", caption_font="impact"):
    """Render a 9:16 video with optional manually entered text burned into each clip."""
    color, label = THEMES[theme]
    overlays = [
        f"drawbox=x=0:y=0:w=iw:h=15:color={color}:t=fill",
        f"drawbox=x=0:y=1265:w=iw:h=15:color={color}:t=fill",
        f"drawtext=text='{label}':fontsize=35:fontcolor=white:x=44:y=142",
        f"drawtext=text='HIGHLIGHT {index:02d}':fontsize=30:fontcolor=white:x=40:y=1156",
    ]
    if caption_text:
        # textfile avoids injecting user-provided text into FFmpeg's filter syntax.
        (target.parent / "caption.txt").write_text(caption_text, encoding="utf-8")
        family = CAPTION_FONTS[caption_font]
        overlays.append(
            f"drawtext=font='{family}':textfile=caption.txt:expansion=none:"
            "fontsize=57:fontcolor=white:borderw=3:bordercolor=black:"
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
    cmd(["ffmpeg", "-y", "-v", "error", "-ss", str(start), "-i", str(source),
         "-t", str(max(1,end-start)), "-filter_complex", filt, "-map", "[v]",
         "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "24",
         "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-b:a", "128k",
         "-movflags", "+faststart", str(target)], cwd=target.parent)

def is_public_https_mp4(url):
    u = urlparse(url)
    if u.scheme!="https" or u.port not in (None,443) or u.username or u.password or not u.hostname:
        return False
    if not re.search(r"\.(mp4|m4v|mov)$", u.path, re.I):
        return False
    try:
        addresses=socket.getaddrinfo(u.hostname,443,type=socket.SOCK_STREAM)
        return bool(addresses) and all(ipaddress.ip_address(item[4][0]).is_global for item in addresses)
    except (socket.gaierror,ValueError):
        return False

def download_direct(url, dest):
    if not is_public_https_mp4(url):
        raise ValueError("Only direct public HTTPS MP4 video links are supported (not YouTube or Twitch pages).")
    with requests.get(url,stream=True,timeout=(10,60),allow_redirects=False) as response:
        if 300<=response.status_code<400:
            raise ValueError("Redirected video links are not supported.")
        response.raise_for_status()
        size=0
        with open(dest,"wb") as output:
            for part in response.iter_content(256*1024):
                size+=len(part)
                if size>MAX_BYTES:
                    raise ValueError("Video exceeds 850 MB limit.")
                if part:
                    output.write(part)

def update(job_id, **fields):
    with lock:
        jobs[job_id].update(fields)

def process(job_id, source, link, theme, caption_text="", caption_font="impact"):
    folder=source.parent
    try:
        update(job_id,status="processing",message="Reading video",progress=10)
        if link:
            download_direct(link,source)
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
    except Exception as error:
        update(job_id,status="error",message=str(error)[:250])
    finally:
        source.unlink(missing_ok=True)

@app.post("/api/jobs")
async def new_job(video: UploadFile | None=File(default=None),
                  url: str | None=Form(default=None), template: str=Form(default="neon"),
                  captions: bool=Form(default=False), caption_text: str=Form(default=""),
                  caption_font: str=Form(default="impact")):
    if bool(video)==bool(url and url.strip()):
        raise HTTPException(400,"Choose a file or direct MP4 link.")
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
    job_id=uuid.uuid4().hex[:12]
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
        jobs[job_id]={"status":"queued","progress":0,"message":"Queued","clips":[]}
    threading.Thread(target=process,args=(job_id,source,url.strip() if url else None,template,caption_text,caption_font),daemon=True).start()
    return {"job_id":job_id}

@app.get("/api/jobs/{job_id}")
def job_info(job_id: str):
    if job_id not in jobs:
        raise HTTPException(404,"Job not found.")
    return jobs[job_id]

@app.get("/api/jobs/{job_id}/files/{filename}")
def download(job_id: str,filename: str):
    if job_id not in jobs or jobs[job_id]["status"]!="done" or not re.fullmatch(r"D6X8_Highlight_0[1-5]\.mp4",filename):
        raise HTTPException(404,"Clip not found.")
    target=WORKSPACE/job_id/filename
    if not target.is_file():
        raise HTTPException(404,"Clip missing.")
    return FileResponse(target,media_type="video/mp4",filename=filename)

@app.get("/api/health")
def health():
    return {"status":"ok","mode":"local","ai":False}

@app.get("/",response_class=HTMLResponse)
def homepage():
    return (HERE/"index.html").read_text(encoding="utf-8")
