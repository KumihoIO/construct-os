#!/usr/bin/env python3
"""Bootstrap for Construct Operator MCP Server.

Uses the shared kumiho-memory venv so the operator doesn't maintain
its own duplicate gRPC connection.  Installs operator-specific deps
(mcp, httpx, claude-agent-sdk) into the shared venv on first run.
"""
import os
import sys
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


def _requirements_hash() -> str:
    """Return the contents of requirements.txt for change detection."""
    try:
        return REQUIREMENTS.read_text(encoding="utf-8").strip()
    except Exception:
        return ""


def ensure_deps():
    python = VENV_DIR / "bin" / "python3"
    if not python.exists():
        # Shared venv doesn't exist yet — the kumiho-memory runner
        # normally creates it.  Create a minimal one here as fallback.
        print("[operator] Creating shared venv...", file=sys.stderr)
        import venv
        venv.create(str(VENV_DIR), with_pip=True)
        subprocess.run(
            [str(python), "-m", "pip", "install", "-q", "--upgrade", "pip"],
            stdout=sys.stderr, stderr=sys.stderr,
        )

    current_hash = _requirements_hash()
    marker_hash = ""
    if OPERATOR_MARKER.exists():
        try:
            marker_hash = OPERATOR_MARKER.read_text(encoding="utf-8").strip()
        except Exception:
            pass

    if marker_hash != current_hash:
        print("[operator] Installing operator deps into shared venv...", file=sys.stderr)
        subprocess.run(
            [str(python), "-m", "pip", "install", "-q",
             "--disable-pip-version-check", "-r", str(REQUIREMENTS)],
            stdout=sys.stderr, stderr=sys.stderr, check=True,
        )
        OPERATOR_MARKER.write_text(current_hash, encoding="utf-8")

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
