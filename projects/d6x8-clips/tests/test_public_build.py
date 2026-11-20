"""Ensure the public Droxion site includes functional Auto Edit and Clips controls."""
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
    assert 'id="editMode"' in page
    assert 'id="autoTemplate"' in page
    assert 'id="clipCount"' in page
    assert 'id="rightsCheck"' in page
    assert 'id="obsStart"' not in page
    assert (output/"editor.js").is_file()
    assert (output/"editor.css").is_file()
    assert (output/"static"/"hero.webp").stat().st_size > 0
    assert (output/"static"/"studio.css").stat().st_size > 0
