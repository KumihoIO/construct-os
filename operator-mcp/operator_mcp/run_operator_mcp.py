#!/usr/bin/env python3
"""Bootstrap for Construct Operator MCP Server.

Uses the shared kumiho-memory venv so the operator doesn't maintain
its own duplicate gRPC connection.  Installs operator-specific deps
(mcp, httpx, claude-agent-sdk) into the shared venv on first run.
"""
import os
import sys
import time
import subprocess
import pathlib

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
REQUIREMENTS = SCRIPT_DIR / "requirements.txt"

# Shared venv — same one kumiho-memory MCP server uses.
_XDG = os.getenv("XDG_CACHE_HOME", "").strip()
SHARED_VENV = pathlib.Path(_XDG) / "kumiho-claude" if _XDG else pathlib.Path.home() / ".cache" / "kumiho-claude"
VENV_DIR = SHARED_VENV / "venv"

# Marker so we only pip-install operator deps once per requirements hash.
OPERATOR_MARKER = SHARED_VENV / ".operator-deps-installed.txt"

# Cross-process install lock — atomic O_CREAT|O_EXCL works on POSIX + Windows.
INSTALL_LOCK = SHARED_VENV / ".operator-install.lock"


def _acquire_install_lock(timeout: float = 90.0) -> bool:
    """Atomically create the install lock. Wait if another process holds it.

    Returns True once we've acquired the lock and should install.
    If the lock is stale (held longer than `timeout`), break it and retry.
    """
    deadline = time.monotonic() + timeout
    INSTALL_LOCK.parent.mkdir(parents=True, exist_ok=True)
    while True:
        try:
            fd = os.open(str(INSTALL_LOCK), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            try:
                os.write(fd, f"{os.getpid()}".encode())
            finally:
                os.close(fd)
            return True
        except FileExistsError:
            if time.monotonic() >= deadline:
                # Stale lock — break it and give one short retry window.
                try:
                    INSTALL_LOCK.unlink()
                except FileNotFoundError:
                    pass
                deadline = time.monotonic() + 5.0
                continue
            time.sleep(0.5)


def _release_install_lock() -> None:
    try:
        INSTALL_LOCK.unlink()
    except FileNotFoundError:
        pass


def _read_marker_hash() -> str:
    if not OPERATOR_MARKER.exists():
        return ""
    try:
        return OPERATOR_MARKER.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def _requirements_hash() -> str:
    """Return the contents of requirements.txt for change detection."""
    try:
        return REQUIREMENTS.read_text(encoding="utf-8").strip()
    except Exception:
        return ""


def _venv_python(venv_dir: pathlib.Path) -> pathlib.Path:
    """Return the path to the venv's Python interpreter, platform-aware.

    Windows venvs put executables under Scripts/ with a .exe suffix; POSIX
    (Linux, macOS, BSD) under bin/. Hardcoding the POSIX layout caused the
    existence check to fail on Windows even when the shared venv had been
    created by the kumiho-memory sidecar — leading the operator to attempt
    a re-create that then failed with PermissionError on the locked
    python.exe.
    """
    if sys.platform == "win32":
        return venv_dir / "Scripts" / "python.exe"
    return venv_dir / "bin" / "python3"


def ensure_deps():
    python = _venv_python(VENV_DIR)
    if not python.exists():
        # Shared venv doesn't exist yet — the kumiho-memory runner
        # normally creates it.  We may be racing it on first install,
        # so wait briefly before falling back to creating one ourselves.
        for _ in range(20):  # up to ~2 seconds
            if python.exists():
                break
            time.sleep(0.1)

    if not python.exists():
        print("[operator] Creating shared venv...", file=sys.stderr)
        try:
            import venv
            venv.create(str(VENV_DIR), with_pip=True)
        except (PermissionError, OSError) as e:
            # Likely racing with another process or python.exe is locked
            # by a running kumiho-memory. Re-check; if it now exists we
            # can proceed.
            if not python.exists():
                print(f"[operator] venv creation failed: {e}", file=sys.stderr)
                print(
                    f"[operator] If this persists, delete {VENV_DIR} and retry.",
                    file=sys.stderr,
                )
                raise
        subprocess.run(
            [str(python), "-m", "pip", "install", "-q", "--upgrade", "pip"],
            stdout=sys.stderr, stderr=sys.stderr,
        )

    current_hash = _requirements_hash()
    marker_hash = _read_marker_hash()
    if marker_hash == current_hash:
        return str(python)  # already up-to-date

    # Install needed. Acquire lock + recheck marker (another process may
    # have just finished installing while we waited).
    _acquire_install_lock(timeout=90.0)
    try:
        marker_hash = _read_marker_hash()
        if marker_hash == current_hash:
            return str(python)

        print("[operator] Installing operator deps into shared venv...", file=sys.stderr)
        try:
            subprocess.run(
                [str(python), "-m", "pip", "install", "-q",
                 "--disable-pip-version-check", "-r", str(REQUIREMENTS)],
                stdout=sys.stderr, stderr=sys.stderr, check=True,
            )
        except subprocess.CalledProcessError:
            # On Windows, pywin32 / mfc140u.dll lock contention is the most
            # common cause when other Construct sidecars (kumiho-memory) are
            # running. Surface actionable steps.
            if sys.platform == "win32":
                print(
                    "\n[operator] pip install failed. On Windows this is usually a DLL\n"
                    "    lock from another running process (kumiho-memory holds pywin32).\n"
                    "    Try:\n"
                    "      1. Stop the gateway (Ctrl+C in its terminal).\n"
                    "      2. In Task Manager, kill any leftover `python.exe` processes\n"
                    "         under your user account.\n"
                    f"      3. Optionally delete {SHARED_VENV} to start fresh.\n"
                    "      4. Re-run scripts\\install-sidecars.bat, then start the gateway again.\n",
                    file=sys.stderr,
                )
            raise

        OPERATOR_MARKER.write_text(current_hash, encoding="utf-8")
    finally:
        _release_install_lock()

    return str(python)


def main():
    python = ensure_deps()
    # Run as package module so relative imports work
    parent_dir = str(SCRIPT_DIR.parent)
    env = os.environ.copy()
    env["PYTHONPATH"] = parent_dir + (os.pathsep + env.get("PYTHONPATH", ""))
    os.execve(python, [python, "-m", "operator_mcp"] + sys.argv[1:], env)


if __name__ == "__main__":
    main()
