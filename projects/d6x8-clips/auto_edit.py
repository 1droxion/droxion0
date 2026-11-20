"""Template-driven automatic montage editing for DroxionClips.

This MVP selects cuts based on audio/motion and assembles a single reel.
It deliberately does not pretend to transcribe speech or insert stock assets.
Those features need a separate ASR and licensed-media pipeline.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

from app import render, select_highlights

AUTO_TEMPLATES = {
    "gaming": {"segments": 4, "seconds": 5, "themes": ("neon", "electric", "fire"), "zoom": True},
    "talking": {"segments": 3, "seconds": 8, "themes": ("clean",), "zoom": False},
    "cinematic": {"segments": 3, "seconds": 8, "themes": ("royal", "clean"), "zoom": True},
    "meme": {"segments": 5, "seconds": 4, "themes": ("fire", "electric", "neon"), "zoom": True},
}


def plan_auto_edit(audio, motion, duration: float, template: str):
    """Return best chronological nonoverlapping cuts for an edit template."""
    if template not in AUTO_TEMPLATES:
        raise ValueError("Unknown auto-edit template.")
    if duration < 12:
        raise ValueError("Use a video at least 12 seconds long.")
    cfg = AUTO_TEMPLATES[template]
    count = min(cfg["segments"], max(1, int(duration // 6)))
    seconds = min(cfg["seconds"], max(2, int(duration // count) - 1))
    cuts = select_highlights(audio, motion, duration, count=count, clip_seconds=seconds)
    return sorted(cuts, key=lambda cut: cut["start"])


def render_auto_edit(source: Path, target: Path, cuts, template: str,
                     caption_text: str = "", caption_font: str = "bebasneue",
                     caption_color: str = "#FFFFFF"):
    """Render timeline parts, then losslessly concatenate into one 9:16 MP4."""
    if template not in AUTO_TEMPLATES:
        raise ValueError("Unknown auto-edit template.")
    if not cuts:
        raise ValueError("No video moments were selected.")
    cfg = AUTO_TEMPLATES[template]
    parts = []
    manifest = target.parent / "auto-edit-concat.txt"
    try:
        for i, cut in enumerate(cuts, 1):
            part = target.parent / f"auto-edit-part-{i:02d}.mp4"
            theme = cfg["themes"][(i - 1) % len(cfg["themes"])]
            render(source, part, cut["start"], cut["end"], theme, i,
                   caption_text, caption_font, caption_color,
                   auto_zoom=(cfg["zoom"] and i % 2 == 1))
            parts.append(part)
        # Only fixed server-generated filenames are written into this manifest.
        manifest.write_text("".join(f"file '{part.name}'\n" for part in parts), encoding="utf-8")
        result = subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "1",
             "-i", manifest.name, "-c", "copy", "-movflags", "+faststart", target.name],
            cwd=target.parent, capture_output=True, text=True, timeout=180,
        )
        if result.returncode != 0 or not target.exists() or target.stat().st_size == 0:
            raise ValueError("The automatic montage could not be assembled.")
        return {"duration": round(sum(c["end"] - c["start"] for c in cuts), 2),
                "cuts": cuts, "template": template}
    finally:
        manifest.unlink(missing_ok=True)
        for part in parts:
            part.unlink(missing_ok=True)
