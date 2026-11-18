"""Secure cloud beta smoke and URL/caption/selection validation."""
import io
import os
import secrets
import shutil
import subprocess
import time
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import cloud_app as cloud

@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(cloud, "SECRET", "example-beta-password-testing-1234")
    monkeypatch.setattr(cloud, "SESSION_SECRET", "testing-session-secret-over-32-characters-123")
    monkeypatch.setattr(cloud, "WORKSPACE", tmp_path)
    with TestClient(cloud.app, base_url="https://testserver") as c:
        yield c

def sign_in(client):
    response = client.post("/login",data={"password":cloud.SECRET},follow_redirects=False)
    assert response.status_code == 303
    assert response.cookies.get(cloud.COOKIE)

def test_requires_login_and_contains_original_website(client):
    assert client.get("/").status_code == 200
    assert "/login" in str(client.get("/").url)
    assert client.get("/api/jobs/"+("a"*32)).status_code == 401
    assert client.post("/api/jobs",data={"rights":"true"}).status_code == 401
    sign_in(client)
    response=client.get("/")
    assert response.status_code == 200
    assert "DroxionClips" in response.text
    assert 'id="rights"' in response.text
    assert 'cloud.js' in response.text
    assert 'cloud.css' in response.text
    assert 'id="obsStart"' not in response.text
    assert 'id="captionFont"' in response.text
    assert 'id="captionToggle"' in response.text

def test_wrong_password_and_cross_origin(client):
    assert client.post("/login",data={"password":"wrong"}).status_code == 401
    sign_in(client)
    assert client.post("/api/jobs",headers={"Origin":"https://other-site.example"},
                    data={"rights":"true","url":"https://example.com/file.mp4"}).status_code == 403

def test_youtube_reference_rejected_without_uploaded_footage(client):
    sign_in(client)
    response=client.post("/api/jobs",data={"rights":"true","url":"https://youtu.be/dQw4w9WgXcQ"})
    assert response.status_code == 400
    assert "original" in response.json()["detail"].lower()
    response=client.post("/api/jobs",data={"rights":"true","url":"https://www.youtube.com/live/dQw4w9WgXcQ"})
    assert response.status_code == 400

def test_consent_font_and_missing_video(client):
    sign_in(client)
    assert client.post("/api/jobs",data={"url":"https://youtu.be/dQw4w9WgXcQ"}).status_code==400
    assert client.post("/api/jobs",data={"rights":"true","caption_font":"notreal"},
                    files={"video":("gameplay.mp4",b"not a video","video/mp4")}).status_code==400
    assert client.post("/api/jobs",data={"rights":"true"}).status_code==400
    assert client.post("/api/jobs",data={"rights":"true","url":"https://example.com/youtube"}).status_code==400

def test_downloads_require_login_and_selection_is_valid(client,tmp_path):
    job_id="a"*32
    path=tmp_path/job_id
    path.mkdir()
    for i in range(1,6):
        (path / f"D6X8_Highlight_{i:02d}.mp4").write_bytes(b"video "+str(i).encode())
    cloud.jobs[job_id]={"status":"done","progress":100,"message":"complete","clips":[]}
    assert client.get(f"/api/jobs/{job_id}/selected.zip").status_code==401
    sign_in(client)
    assert client.get(f"/api/jobs/{job_id}/selected.zip?clips=0,6").status_code==400
    response=client.get(f"/api/jobs/{job_id}/selected.zip?clips=1,3,5")
    assert response.status_code==200
    with zipfile.ZipFile(io.BytesIO(response.content)) as z:
        assert z.namelist()==["DroxionClips_01.mp4","DroxionClips_03.mp4","DroxionClips_05.mp4"]
    response=client.get(f"/api/jobs/{job_id}/files/D6X8_Highlight_01.mp4?download=true")
    assert response.status_code==200
    assert response.headers["content-disposition"].startswith("attachment")
    cloud.jobs.pop(job_id,None)

def test_web_beta_does_not_expose_obs_upload_endpoints(client):
    sign_in(client)
    assert client.post("/api/obs/start",json={"directory":"/tmp"}).status_code==404
    assert client.get("/api/obs/status").status_code==404

def test_health_does_not_expose_password(client):
    data=client.get("/api/health").json()
    assert data["status"]=="ok"
    assert "password" not in repr(data).lower()
