"""Regression checks for the non-AI local highlight generator."""
import math
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import app, is_public_https_mp4, select_highlights, render, THEMES

def assert_valid_clips(clips, duration):
    assert len(clips) == 5
    for item in clips:
        assert math.isfinite(item["start"]) and math.isfinite(item["end"])
        assert 0 <= item["start"] < item["end"] <= duration
    chronological = sorted(clips, key=lambda c: c["start"])
    assert all(a["end"] <= b["start"] for a, b in zip(chronological, chronological[1:]))

def test_selects_five_spaced_highlights():
    seconds = 200
    audio = np.zeros(seconds)
    motion = np.zeros(seconds)
    for peak in (20, 55, 90, 135, 170):
        audio[peak-3:peak+3] = 0.9
        motion[peak-4:peak+4] = 0.6
    assert_valid_clips(select_highlights(audio, motion, seconds), seconds)

@pytest.mark.parametrize("seconds", [12, 15, 28, 60, 180])
def test_five_clips_on_quiet_and_short_videos(seconds):
    assert_valid_clips(
        select_highlights(np.zeros(seconds), np.zeros(seconds), seconds), seconds
    )

def test_rejects_too_short_videos():
    with pytest.raises(ValueError):
        select_highlights(np.zeros(10), np.zeros(10), 10)

def test_five_templates_and_health():
    assert len(THEMES) == 5
    client = TestClient(app)
    assert client.get("/api/health").json() == {
        "status": "ok", "mode": "local", "ai": False
    }
    page = client.get("/")
    assert page.status_code == 200
    assert "Generate 5 Clips" in page.text

def test_local_urls_and_video_watch_pages_are_rejected():
    for url in (
        "http://example.com/video.mp4",
        "https://localhost/video.mp4",
        "https://127.0.0.1/video.mp4",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "file:///etc/passwd",
    ):
        assert not is_public_https_mp4(url)

@pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="FFmpeg is required for real MP4 rendering",
)
def test_renders_a_real_vertical_mp4(tmp_path: Path):
    source = tmp_path / "source.mp4"
    target = tmp_path / "clip.mp4"
    subprocess.run([
        "ffmpeg", "-y", "-v", "error", "-f", "lavfi",
        "-i", "testsrc2=size=160x90:rate=10", "-t", "3",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", str(source),
    ], check=True, timeout=60)
    render(source, target, 0, 2, "neon", 1)
    assert target.exists()
    assert target.stat().st_size > 1000
    dimensions = subprocess.run([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height", "-of", "csv=s=x:p=0", str(target),
    ], capture_output=True, text=True, check=True, timeout=30)
    assert dimensions.stdout.strip() == "720x1280"

def test_droxionclips_responsive_ui_and_caption_controls():
    client = TestClient(app)
    page = client.get("/")
    assert page.status_code == 200
    assert 'DroxionClips' in page.text
    assert 'name="viewport"' in page.text
    assert 'Caption font' in page.text
    assert 'id="capOn"' in page.text
    assert 'id="capOff"' in page.text
    assert 'aria-live="polite"' in page.text
    assert 'These are examples, not earnings testimonials' in page.text
    assert 'No real customer reviews' in page.text


def test_invalid_caption_settings_are_rejected():
    from io import BytesIO
    client = TestClient(app)
    def submit(**data):
        return client.post("/api/jobs", files={
            "video": ("example.mp4", BytesIO(b"not a video"), "video/mp4")
        }, data={"template": "neon", **data})
    assert submit(captions="true", caption_font="unknown", caption_text="Hello").status_code == 400
    assert submit(captions="true", caption_font="impact", caption_text="").status_code == 400
    assert submit(captions="true", caption_font="impact", caption_text="X" * 66).status_code == 400


@pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="FFmpeg is required for caption overlay test",
)
def test_renders_manual_caption_and_font(tmp_path: Path):
    source = tmp_path / "gameplay.mp4"
    target = tmp_path / "captioned.mp4"
    subprocess.run([
        "ffmpeg", "-y", "-v", "error", "-f", "lavfi",
        "-i", "testsrc2=size=160x90:rate=10", "-t", "3",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", str(source)
    ], check=True, timeout=60)
    render(source, target, 0, 2, "electric", 1, "CLUTCH: 5/5!", "arial")
    assert target.exists() and target.stat().st_size > 1000
    assert (tmp_path / "caption.txt").read_text(encoding="utf-8") == "CLUTCH: 5/5!"
