"""Paste-first public trial: no-login, bounded usage, and rights checks."""
import time
from pathlib import Path
from fastapi.testclient import TestClient
import pytest
import cloud_app as cloud

ORIGIN = {"Origin": "https://droxion.com"}
@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(cloud, "PUBLIC_TRIAL_ENABLED", True)
    monkeypatch.setattr(cloud, "PUBLIC_YOUTUBE_ENABLED", True)
    monkeypatch.setattr(cloud, "WORKSPACE", tmp_path)
    monkeypatch.setattr(cloud, "public_usage", {"day":"","total":0,"ip":{}})
    with TestClient(cloud.app, base_url="https://testserver") as c:
        yield c

def test_private_stays_private(client):
    assert client.get("/api/jobs/" + "a"*32).status_code == 401
    assert client.post("/api/jobs",data={"rights":"true"},headers=ORIGIN).status_code == 401

def test_public_rejects_live_youtube_without_recording(client):
    res = client.post("/api/public/jobs",
        data={"rights":"true","url":"https://www.youtube.com/live/dQw4w9WgXcQ"},
        headers=ORIGIN)
    assert res.status_code == 400
    assert "YouTube" in res.json()["detail"]
    assert cloud.public_usage["total"] == 0

def test_public_rejects_invalid_or_unauthorized(client):
    assert client.post("/api/public/jobs",data={"url":"https://example.com/game.mp4"},headers=ORIGIN).status_code == 400
    assert client.post("/api/public/jobs",data={"rights":"true","url":"https://example.com/stream"},headers=ORIGIN).status_code == 400
    assert client.post("/api/public/jobs",data={"rights":"true","url":"https://example.com/file.mp4"},headers={"Origin":"https://evil.example"}).status_code == 403
    assert client.post("/api/public/jobs",data={"rights":"true","caption_font":"fake"},headers=ORIGIN).status_code == 400

def test_public_form_accepts_cors_preflight(client):
    response=client.options("/api/public/jobs",headers={
        "Origin":"https://droxion.com","Access-Control-Request-Method":"POST"})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://droxion.com"

def test_public_job_status_and_selected_zip(client, tmp_path):
    job_id="b"*32
    path=tmp_path/job_id
    path.mkdir()
    for n in range(1,6):
        (path/f"D6X8_Highlight_{n:02d}.mp4").write_bytes(b"video")
    cloud.jobs[job_id]={"status":"done","progress":100,"public":True,"clips":[]}
    try:
        response=client.get(f"/api/public/jobs/{job_id}",headers=ORIGIN)
        assert response.status_code == 200
        response=client.get(f"/api/public/jobs/{job_id}/selected.zip?clips=1,3",headers=ORIGIN)
        assert response.status_code == 200
        assert response.headers["content-type"]=="application/zip"
        assert client.get(f"/api/public/jobs/{job_id}/files/../../etc/passwd").status_code in (400,404)
    finally:
        cloud.jobs.pop(job_id,None)

def test_oversized_upload_returns_readable_cors_error(client):
    response = client.post(
        "/api/public/jobs",
        headers={"Origin":"https://droxion.com", "Content-Length":str(cloud.PUBLIC_MAX_BYTES + 2 * 1024**2)},
        data={"rights":"true","url":"https://example.com/game.mp4"}
    )
    assert response.status_code == 413
    assert response.headers.get("access-control-allow-origin") == "https://droxion.com"
    assert "upload limit" in response.json()["detail"].lower()


def test_public_disabled_by_default(client,monkeypatch):
    monkeypatch.setattr(cloud, "PUBLIC_TRIAL_ENABLED", False)
    response=client.post("/api/public/jobs",
        data={"rights":"true","url":"https://example.com/game.mp4"},headers=ORIGIN)
    assert response.status_code == 503


@pytest.mark.parametrize("from_youtube", [False, True])
def test_public_editor_generates_five_mp4s(client, tmp_path, monkeypatch, from_youtube):
    """Actual form upload, background job, rendered outputs and selected ZIP."""
    import shutil
    import subprocess
    import json
    import zipfile
    import io
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        pytest.skip("FFmpeg required")
    footage = tmp_path / "test.mp4"
    subprocess.run([
        "ffmpeg", "-y", "-v", "error",
        "-f", "lavfi", "-i", "color=c=blue:size=160x90:rate=1",
        "-t", "503" if from_youtube else "10800", "-c:v", "libx264", "-preset", "ultrafast",
        "-pix_fmt", "yuv420p", str(footage)
    ], check=True, timeout=30)
    data = {"rights": "true", "template": "neon", "captions": "false", "caption_font": "anton"}
    if from_youtube:
        def import_fixture(url, target, limit, max_duration):
            assert url == "https://www.youtube.com/watch?v=ha-JqYDn2kA"
            assert (limit, max_duration) == (cloud.PUBLIC_YOUTUBE_MAX_BYTES, cloud.PUBLIC_YOUTUBE_MAX_DURATION)
            shutil.copyfile(footage, target)

        monkeypatch.setattr(cloud, "download_youtube", import_fixture)
        data["url"] = "https://youtu.be/ha-JqYDn2kA?si=test"
        response = client.post("/api/public/jobs", headers=ORIGIN, data=data)
    else:
        response = client.post("/api/public/jobs", headers=ORIGIN, data=data,
                               files={"video": ("test.mp4", footage.read_bytes(), "video/mp4")})
    assert response.status_code == 200, response.text
    job_id = response.json()["job_id"]
    deadline = time.monotonic() + 170
    try:
        while time.monotonic() < deadline:
            job_response = client.get(f"/api/public/jobs/{job_id}", headers=ORIGIN)
            assert job_response.status_code == 200, job_response.text
            job = job_response.json()
            if job["status"] == "done":
                assert len(job["clips"]) == 5
                assert all(30 <= round(item["end"] - item["start"], 2) <= 35
                           for item in job["clips"])
                for index in range(1,6):
                    mp4 = client.get(
                        f"/api/public/jobs/{job_id}/files/D6X8_Highlight_{index:02d}.mp4",
                        headers=ORIGIN)
                    assert mp4.status_code == 200
                    assert len(mp4.content) > 1000
                    exported = tmp_path / f"export-{index}.mp4"
                    exported.write_bytes(mp4.content)
                    probe = subprocess.check_output([
                        "ffprobe", "-v", "error", "-show_entries", "format=duration",
                        "-of", "json", str(exported),
                    ], timeout=15)
                    assert 30 <= float(json.loads(probe)["format"]["duration"]) <= 35.1
                zip_response = client.get(
                    f"/api/public/jobs/{job_id}/selected.zip?clips=2,4",
                    headers=ORIGIN)
                assert zip_response.status_code == 200
                with zipfile.ZipFile(io.BytesIO(zip_response.content)) as bundle:
                    assert bundle.namelist() == ["DroxionClips_02.mp4","DroxionClips_04.mp4"]
                return
            if job["status"] == "error":
                pytest.fail(f"Render failed: {job['message']}")
            time.sleep(1)
        pytest.fail("Public render did not complete")
    finally:
        cloud.jobs.pop(job_id, None)
