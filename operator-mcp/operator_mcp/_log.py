"""Shared logging helper — everything to stderr, never stdout."""
from __future__ import annotations

import sys


def _log(msg: str) -> None:
    print(f"[operator] {msg}", file=sys.stderr, flush=True)
