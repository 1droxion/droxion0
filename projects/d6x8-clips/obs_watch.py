"""Watch newly completed local OBS recordings; never fetch remote streams."""
from __future__ import annotations

import threading
import time
from pathlib import Path

EXTENSIONS = {".mp4", ".mkv", ".mov", ".m4v", ".webm"}
POLL_SECONDS = 2
STABLE_SECONDS = 12
MAX_RECORDING_BYTES = 850 * 1024 * 1024


def safe_recordings_directory(value: str) -> Path:
    """Require an explicit existing subfolder of the user's home."""
    root = Path.home().resolve()
    directory = Path(value).expanduser().resolve(strict=True)
    if not directory.is_dir() or directory == root or not directory.is_relative_to(root):
        raise ValueError("Choose a recording folder inside your Windows user folder.")
    return directory


class RecordingWatcher:
    def __init__(self, on_completed, *, poll_seconds=POLL_SECONDS, stable_seconds=STABLE_SECONDS):
        self.on_completed = on_completed
        self.poll_seconds = poll_seconds
        self.stable_seconds = stable_seconds
        self._lock = threading.RLock()
        self._stop = threading.Event()
        self._thread = None
        self._directory = None
        self._baseline = set()
        self._observations = {}
        self._processed = set()
        self._options = {}
        self._started_at = 0
        self._last_job = None
        self._last_error = None

    def start(self, folder: str, options=None):
        directory = safe_recordings_directory(folder)
        self.stop()
        with self._lock:
            self._directory = directory
            self._started_at = time.time()
            self._baseline = {p.name for p in directory.iterdir() if p.is_file()}
            self._observations = {}
            self._processed = set()
            self._options = dict(options or {})
            self._last_job = None
            self._last_error = None
            self._stop = threading.Event()
            self._thread = threading.Thread(target=self._loop, args=(self._stop,), daemon=True)
            self._thread.start()
        return self.status()

    def stop(self):
        with self._lock:
            event = self._stop
            thread = self._thread
            self._thread = None
            self._directory = None
            event.set()
        if thread and thread is not threading.current_thread():
            thread.join(timeout=5)
        return self.status()

    def status(self):
        with self._lock:
            return {"watching": bool(self._thread and self._thread.is_alive() and not self._stop.is_set()),
                    "directory": str(self._directory) if self._directory else None,
                    "last_job": self._last_job, "last_error": self._last_error,
                    "processed_count": len(self._processed)}

    def scan_once(self, now=None):
        """Inspect only new, directly contained completed recordings."""
        with self._lock:
            directory = self._directory
            if directory is None:
                return
            options = dict(self._options)
            now = time.time() if now is None else now
            try:
                entries = list(directory.iterdir())
            except OSError:
                self._last_error = "Cannot read the OBS recording folder."
                return
            for path in entries:
                if path.name in self._baseline or path.name in self._processed or path.is_symlink():
                    continue
                if path.suffix.lower() not in EXTENSIONS or not path.is_file():
                    continue
                try:
                    stat = path.stat()
                except OSError:
                    continue
                if stat.st_size > MAX_RECORDING_BYTES or stat.st_size == 0:
                    continue
                if stat.st_mtime < self._started_at - 2:
                    continue
                current = self._observations.get(path.name)
                if current is None or current[0] != stat.st_size or current[1] != stat.st_mtime_ns:
                    self._observations[path.name] = (stat.st_size, stat.st_mtime_ns, now)
                    continue
                if now - current[2] < self.stable_seconds or now - stat.st_mtime < self.stable_seconds:
                    continue
                # Don't hold the watcher lock while copying/processing.
                try:
                    accepted = self.on_completed(path, options)
                except (OSError, ValueError) as error:
                    self._last_error = str(error)[:200]
                    self._processed.add(path.name)
                    continue
                if accepted:
                    self._processed.add(path.name)
                    self._last_job = accepted

    def _loop(self, stop):
        while not stop.wait(self.poll_seconds):
            self.scan_once()
