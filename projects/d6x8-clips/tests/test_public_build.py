"""Ensure public marketing build never exposes nonfunctional clipping UI."""
from pathlib import Path
import shutil
import subprocess

import pytest

ROOT=Path(__file__).resolve().parents[1]

@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js required for public static build")
def test_public_build_is_safe_and_complete():
    subprocess.run(["node", "build_public.mjs"], cwd=ROOT, check=True, timeout=30)
    output=ROOT/"public-dist"
    page=(output/"index.html").read_text(encoding="utf-8")
    assert 'DroxionClips' in page
    assert 'Download Windows beta' in page
    assert 'id="form"' not in page
    assert 'id="obsStart"' not in page
    assert 'No payments are collected.' in page
    assert 'Open Online Editor (Private Beta)' in page
    assert (output/"static"/"hero.webp").stat().st_size > 0
    assert (output/"static"/"studio.css").stat().st_size > 0
    assert (output/"static"/"public.js").stat().st_size > 0
