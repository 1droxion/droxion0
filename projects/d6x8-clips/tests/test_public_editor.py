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
    monkeypatch.setattr(cloud, "WORKSPACE", tmp_path)
    monkeypatch.setattr(cloud, "public_usage", {"day":"","total":0,"ip":{}})
    with TestClient(cloud.app, base_url="https://testserver") as c:
        yield c

def test_private_stays_private(client):
    assert client.get("/api/jobs/" + "a"*32).status_code == 401
    assert client.post("/api/jobs",data={"rights":"true"},headers=ORIGIN).status_code == 401

def test_public_rejects_unsupported_youtube_without_recording(client):
    res = client.post("/api/public/jobs",
        data={"rights":"true","url":"https://youtu.be/dQw4w9WgXcQ"},
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
        headers={"Origin":"https://droxion.com", "Content-Length":str(60 * 1024 * 1024)},
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
