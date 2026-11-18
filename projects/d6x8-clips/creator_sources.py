"""Creator-owned YouTube reference recognition (no audiovisual downloading)."""
import re
from urllib.parse import parse_qs, urlparse

VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")

def creator_video_reference(url: str):
    """Recognize YouTube video/live/shorts URLs without contacting YouTube.

    Returns a safe identifier and canonical watch URL, or None. References
    identify the creator's upload; video bytes must be supplied separately.
    """
    try:
        parsed = urlparse(url.strip())
        if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port not in (None, 443):
            return None
        host = (parsed.hostname or "").lower()
        host = host.removeprefix("www.").removeprefix("m.")
        pieces = [s for s in parsed.path.split("/") if s]
        video_id = None
        kind = "video"
        if host == "youtu.be" and len(pieces) == 1:
            video_id = pieces[0]
        elif host == "youtube.com":
            if parsed.path == "/watch":
                ids = parse_qs(parsed.query).get("v", [])
                video_id = ids[0] if len(ids) == 1 else None
            elif len(pieces) == 2 and pieces[0] in ("live", "shorts"):
                kind = "live" if pieces[0] == "live" else "shorts"
                video_id = pieces[1]
        if not video_id or not VIDEO_ID.fullmatch(video_id):
            return None
        return {"service": "youtube", "kind": kind, "video_id": video_id,
                "watch_url": f"https://www.youtube.com/watch?v={video_id}"}
    except ValueError:
        return None
