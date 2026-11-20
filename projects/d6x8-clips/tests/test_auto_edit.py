"""Tests for automated montage plan and safe public editor mode validation."""
import numpy as np
import pytest
from fastapi.testclient import TestClient
from auto_edit import AUTO_TEMPLATES, plan_auto_edit
import cloud_app as cloud


@pytest.mark.parametrize("template", list(AUTO_TEMPLATES))
def test_auto_edit_produces_ordered_nonoverlapping_cuts(template):
    n = 140
    audio = np.zeros(n)
    motion = np.zeros(n)
    for t in (12, 36, 65, 96, 125):
        audio[t:t+3] = 0.95
        motion[t:t+3] = 0.8
    cuts = plan_auto_edit(audio, motion, n, template)
    assert cuts
    assert len(cuts) <= AUTO_TEMPLATES[template]["segments"]
    for i, cut in enumerate(cuts):
        assert 0 <= cut["start"] < cut["end"] <= n
        if i:
            assert cuts[i-1]["end"] <= cut["start"]


def test_invalid_template_rejected():
    with pytest.raises(ValueError, match="template"):
        plan_auto_edit(np.zeros(30), np.zeros(30), 30, "../secret")


def test_editor_modes_are_present():
    with TestClient(cloud.site) as client:
        response = client.get("/")
        assert response.status_code == 200
        assert 'id="editMode"' in response.text
        assert 'id="autoTemplate"' in response.text
        assert 'id="clipCount"' in response.text


def test_public_invalid_auto_edit_template_returns_400(monkeypatch):
    monkeypatch.setattr(cloud, "PUBLIC_TRIAL_ENABLED", True)
    with TestClient(cloud.site) as client:
        response = client.post("/api/public/jobs", data={
            "mode": "auto", "auto_template": "../../etc/passwd",
            "rights": "true",
        }, headers={"Origin": "https://droxion.com"})
        assert response.status_code == 400


def test_public_invalid_mode_returns_400(monkeypatch):
    monkeypatch.setattr(cloud, "PUBLIC_TRIAL_ENABLED", True)
    with TestClient(cloud.site) as client:
        response = client.post("/api/public/jobs", data={
            "mode": "anything", "rights": "true"
        }, headers={"Origin": "https://droxion.com"})
        assert response.status_code == 400


def test_real_auto_edit_mp4_export(tmp_path):
    """Validate one real multi-cut montage and MP4 file, without network dependencies."""
    import subprocess
    import shutil
    from auto_edit import render_auto_edit
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        pytest.skip("FFmpeg required")
    source = tmp_path / "source.mp4"
    output = tmp_path / "Droxion_Auto_Edit.mp4"
    subprocess.run([
        "ffmpeg", "-y", "-v", "error",
        "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=10",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=22050",
        "-t", "4", "-c:v", "libx264", "-preset", "ultrafast",
        "-pix_fmt", "yuv420p", "-c:a", "aac", str(source),
    ], check=True, timeout=30)
    meta = render_auto_edit(
        source, output, [{"start":0, "end":1}, {"start":2, "end":3}],
        "cinematic",
    )
    assert output.stat().st_size > 1000
    assert meta["duration"] == 2
    dims = subprocess.check_output([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height", "-of", "csv=s=x:p=0",
        str(output)
    ], text=True, timeout=30).strip()
    assert dims == "720x1280"
