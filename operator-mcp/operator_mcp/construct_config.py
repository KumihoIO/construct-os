"""Read Construct-level config values from ~/.construct/config.toml.

Currently exposes the harness project name used for Kumiho spaces
(workflows, runs, agent pool, teams, etc.). Must match the gateway's
`kumiho.harness_project` config value so operator writes and gateway
reads target the same Kumiho project.
"""
from __future__ import annotations

import os

try:
    import tomllib
except ImportError:
    try:
        import tomli as tomllib  # type: ignore[no-redef]
    except ImportError:
        tomllib = None  # type: ignore[assignment]

from ._log import _log

_CONFIG_PATH = os.path.expanduser("~/.construct/config.toml")
_DEFAULT_HARNESS = "Construct"

_cached_harness: str | None = None


def harness_project(*, force_reload: bool = False) -> str:
    """Return the Kumiho harness project name from config (default 'Construct').

    Reads `[kumiho].harness_project` from ~/.construct/config.toml. Cached
    after first read; pass `force_reload=True` to re-read from disk.
    """
    global _cached_harness
    if _cached_harness is not None and not force_reload:
        return _cached_harness

    if tomllib is None:
        _cached_harness = _DEFAULT_HARNESS
        return _cached_harness

    try:
        with open(_CONFIG_PATH, "rb") as f:
            config = tomllib.load(f)
    except FileNotFoundError:
        _cached_harness = _DEFAULT_HARNESS
        return _cached_harness
    except Exception as exc:
        _log(f"construct_config: error reading config: {exc}")
        _cached_harness = _DEFAULT_HARNESS
        return _cached_harness

    kumiho = config.get("kumiho", {}) or {}
    value = kumiho.get("harness_project")
    if isinstance(value, str) and value.strip():
        _cached_harness = value.strip()
    else:
        _cached_harness = _DEFAULT_HARNESS
    return _cached_harness
