"""YouTube reference identification and OBS completed-file watcher coverage."""
import os
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from creator_sources import creator_video_reference
from obs_watch import RecordingWatcher


@pytest.mark.parametrize("raw,expected", [
    ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", ("video", "dQw4w9WgXcQ")),
    ("https://youtu.be/dQw4w9WgXcQ?t=20", ("video", "dQw4w9WgXcQ")),
    ("https://www.youtube.com/live/dQw4w9WgXcQ", ("live", "dQw4w9WgXcQ")),
    ("https://youtube.com/shorts/dQw4w9WgXcQ", ("shorts", "dQw4w9WgXcQ")),
])
def test_creator_link_reference(raw, expected):
    reference = creator_video_reference(raw)
    assert (reference["kind"], reference["video_id"]) == expected
    assert reference["watch_url"] == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"


@pytest.mark.parametrize("raw", [
    "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=invalid",
    "https://youtube.com/watch",
    "https://example.com/video.mp4",
    "file:///etc/passwd",
])
def test_rejects_untrusted_creator_links(raw):
    assert creator_video_reference(raw) is None


def test_youtube_reference_needs_recording():
    from app import app
    client = TestClient(app)
    response = client.post("/api/jobs", data={"url": "https://www.youtube.com/live/dQw4w9WgXcQ"})
    assert response.status_code == 400
    assert "Upload your own original recording" in response.json()["detail"]


def test_obs_watcher_waits_for_new_stable_file(tmp_path, monkeypatch):
    import obs_watch
    monkeypatch.setattr(obs_watch, "safe_recordings_directory", lambda value: tmp_path)
    accepted = []
    watcher = RecordingWatcher(lambda path, opts: accepted.append(path.name) or "job_1",
                               poll_seconds=999, stable_seconds=3)
    existing = tmp_path / "existing.mp4"
    existing.write_bytes(b"already here")
    watcher.start(str(tmp_path), {"template": "neon"})
    try:
        fresh = tmp_path / "new_replay.mkv"
        fresh.write_bytes(b"new recording")
        # First scan observes size and modification time.
        now = time.time() + 15
        watcher.scan_once(now=now)
        assert not accepted
        watcher.scan_once(now=now + 2)
        assert not accepted
        watcher.scan_once(now=now + 5)
        assert accepted == ["new_replay.mkv"]
        assert watcher.status()["last_job"] == "job_1"
        watcher.scan_once(now=now + 30)
        assert accepted == ["new_replay.mkv"]
    finally:
        watcher.stop()
    assert not watcher.status()["watching"]


def test_obs_endpoints_require_json_and_valid_folder():
    from app import app
    client = TestClient(app)
    assert client.post("/api/obs/start", data={"directory": "/invalid"}).status_code == 415
    assert client.post("/api/obs/start", json={"directory": "/path-that-does-not-exist"}).status_code == 400
    assert client.post("/api/obs/stop", json={}).status_code == 200
    assert client.get("/api/obs/status").json()["watching"] is False


def test_obs_ui_is_on_homepage():
    from app import app
    page = TestClient(app).get("/").text
    for term in ('id="obsFolder"', 'id="obsStart"', 'id="obsStop"', 'id="obsView"'):
        assert term in page
