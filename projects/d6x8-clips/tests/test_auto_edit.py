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
