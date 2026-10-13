"""
Auto-start for the real print bridge (`tools/rptbridge/bin/RptBridge.exe`).

On Windows, when that exe exists and the operator has not pointed the app at their own bridge, the backend:
  * launches it hidden on 127.0.0.1 with a key (RPT_BRIDGE_KEY if set, else generated for this run),
  * restarts it if it exits (with a growing delay, so a crash loop cannot spin the CPU),
  * stops it when the backend shuts down,
and tells `rpt_bridge` which URL/key to use. The key travels in the child's environment, never on its command line.

No exe (or not Windows, or RPT_BRIDGE_AUTOSTART=0, or an explicit RPT_BRIDGE_URL) -> nothing is launched and the
client keeps using the configured URL, i.e. CRYSTAL_SERVICE_URL / the mock bridge (`print_service/mock_bridge.py`).
Switches: RPT_BRIDGE_URL (external bridge, no autostart), RPT_BRIDGE_KEY, RPT_BRIDGE_AUTOSTART=0, RPT_FOLDER.
"""
from __future__ import annotations

import logging
import os
import secrets
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

from app.core.config import get_settings
from app.print import rpt_bridge
from app.print.rpt_registry import _rpt_dir

log = logging.getLogger("rpt_bridge_manager")

_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
EXE = _BACKEND_DIR / "tools" / "rptbridge" / "bin" / "RptBridge.exe"
_ENV_FILE = _BACKEND_DIR / ".env"
_RUNTIME_DB = _BACKEND_DIR / "runtime_db_settings.json"

_stop = threading.Event()
_thread: threading.Thread | None = None
_proc: subprocess.Popen | None = None
_lock = threading.Lock()


def _autostart_enabled() -> bool:
    return os.environ.get("RPT_BRIDGE_AUTOSTART", "1").strip().lower() not in ("0", "false", "no", "off")


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def should_autostart() -> tuple[bool, str]:
    """(yes/no, reason) — the reason is logged so the operator can see why the real bridge is not in use."""
    settings = get_settings()
    if sys.platform != "win32":
        return False, "not Windows"
    if not _autostart_enabled():
        return False, "RPT_BRIDGE_AUTOSTART=0"
    if settings.rpt_bridge_url:
        return False, "RPT_BRIDGE_URL is set (external bridge)"
    if not EXE.exists():
        return False, f"{EXE.name} not built (run tools/rptbridge/build.cmd)"
    return True, "ok"


def _launch(port: int, key: str) -> subprocess.Popen:
    cmd = [str(EXE), "--port", str(port), "--env", str(_ENV_FILE), "--settings", str(_RUNTIME_DB), "--rpts", str(_rpt_dir().resolve())]
    env = {**os.environ, "RPT_BRIDGE_KEY": key}
    return subprocess.Popen(
        cmd,
        env=env,
        cwd=str(EXE.parent),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )


def _supervise(port: int, key: str) -> None:
    global _proc
    delay = 1.0
    while not _stop.is_set():
        started = time.monotonic()
        try:
            with _lock:
                _proc = _launch(port, key)
            log.info("print bridge started (pid %s) on 127.0.0.1:%s", _proc.pid, port)
            while not _stop.is_set() and _proc.poll() is None:
                time.sleep(0.5)
            if _stop.is_set():
                break
            log.warning("print bridge exited with code %s; restarting in %.0fs", _proc.returncode, delay)
        except Exception:  # noqa: BLE001
            log.exception("could not start the print bridge; retrying in %.0fs", delay)
        if time.monotonic() - started > 60:
            delay = 1.0  # it ran a while: the next failure is a fresh incident
        if _stop.wait(delay):
            break
        delay = min(delay * 2, 30.0)


def start() -> None:
    """Call once at backend startup. Safe to call when auto-start does not apply."""
    global _thread
    ok, reason = should_autostart()
    if not ok:
        log.info("print bridge not auto-started: %s", reason)
        print(f"[print] bridge not auto-started: {reason}")
        return
    port = _free_port()
    key = get_settings().rpt_bridge_key or secrets.token_urlsafe(32)
    rpt_bridge.set_runtime(f"http://127.0.0.1:{port}", key)
    _stop.clear()
    _thread = threading.Thread(target=_supervise, args=(port, key), name="rpt-bridge-supervisor", daemon=True)
    _thread.start()
    print(f"[print] real Crystal bridge starting on 127.0.0.1:{port}")


def stop() -> None:
    """Call at backend shutdown: stop supervising and end the child process."""
    global _thread
    _stop.set()
    with _lock:
        proc = _proc
    if proc is not None and proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
    if _thread is not None:
        _thread.join(timeout=3)
        _thread = None
    rpt_bridge.set_runtime(None, None)


def restart() -> None:
    """Re-launch the child so it re-reads the database settings (call after the Database Settings panel saves)."""
    with _lock:
        proc = _proc
    if proc is not None and proc.poll() is None:
        proc.terminate()  # the supervisor notices the exit and starts a fresh one
