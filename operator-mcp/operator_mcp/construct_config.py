"""Read Construct-level config values from ~/.construct/config.toml.

Exposes the two Kumiho project names used across the operator + gateway:

  * harness_project — operational namespace (Workflows, AgentPool, Teams,
    Sessions, ...). Must match the gateway's `[kumiho].harness_project`.
  * memory_project  — user / cognitive namespace (Skills, personal memory,
    cross-session recall). Must match the gateway's `[kumiho].memory_project`.

Both helpers cache after first read; pass `force_reload=True` to re-read.
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
_DEFAULT_MEMORY = "CognitiveMemory"

_cached_harness: str | None = None
_cached_memory: str | None = None


def _read_kumiho_section() -> dict:
    """Return the [kumiho] section from config.toml as a dict.

    Returns an empty dict on any read / parse error so callers can fall
    back to defaults.
    """
    if tomllib is None:
        return {}
    try:
        with open(_CONFIG_PATH, "rb") as f:
            config = tomllib.load(f)
    except FileNotFoundError:
        return {}
    except Exception as exc:
        _log(f"construct_config: error reading config: {exc}")
        return {}
    return config.get("kumiho", {}) or {}


def harness_project(*, force_reload: bool = False) -> str:
    """Return the Kumiho harness project name from config (default 'Construct').

    Reads `[kumiho].harness_project` from ~/.construct/config.toml. Cached
    after first read; pass `force_reload=True` to re-read from disk.
    """
    global _cached_harness
    if _cached_harness is not None and not force_reload:
        return _cached_harness

    kumiho = _read_kumiho_section()
    value = kumiho.get("harness_project")
    if isinstance(value, str) and value.strip():
        _cached_harness = value.strip()
    else:
        _cached_harness = _DEFAULT_HARNESS
    return _cached_harness


def memory_project(*, force_reload: bool = False) -> str:
    """Return the Kumiho memory project name from config (default 'CognitiveMemory').

    Reads `[kumiho].memory_project` from ~/.construct/config.toml. Falls back
    to the `KUMIHO_MEMORY_PROJECT` environment variable, then to the
    'CognitiveMemory' default.

    Cached after first read; pass `force_reload=True` to re-read from disk.
    """
    global _cached_memory
    if _cached_memory is not None and not force_reload:
        return _cached_memory

    kumiho = _read_kumiho_section()
    value = kumiho.get("memory_project")
    if isinstance(value, str) and value.strip():
        _cached_memory = value.strip()
        return _cached_memory

    env_value = os.environ.get("KUMIHO_MEMORY_PROJECT")
    if isinstance(env_value, str) and env_value.strip():
        _cached_memory = env_value.strip()
        return _cached_memory

    _cached_memory = _DEFAULT_MEMORY
    return _cached_memory
