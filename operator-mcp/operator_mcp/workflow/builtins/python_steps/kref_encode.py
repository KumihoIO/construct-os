#!/usr/bin/env python3
"""URL-safe encode/decode of Kumiho krefs for embedding in trackable links.

Used by the cold-outreach + click-tracking workflows: when a workflow
needs to mint a tracked URL outside the email step's auto-rewrite
(e.g. for a button in a separate transactional message), it can
explicitly encode a kref with this script and interpolate the result
into wherever it needs to land.

Protocol: this is a Python step (see PythonStepConfig in
operator_mcp/workflow/schema.py). Reads a JSON object on stdin and
writes a JSON object on stdout.

This script is intentionally **standalone** — no imports beyond the
stdlib — so it runs from any Python interpreter the workflow picks,
without requiring operator_mcp to be on its sys.path. The same codec
lives in ``operator_mcp.tracking`` for code paths that import directly
(the email step's link rewriter, future gateway click handler). If
you change the encoding, change both copies — they have to round-trip
with each other.

Input shape::

    {
      "args": {
        "op": "encode" | "decode",
        "kref": "<full kref>",            # required for op=encode
        "encoded": "<urlsafe-b64 token>", # required for op=decode
        "secret": "<optional HMAC secret>"
      },
      "context": { ... }   # ignored
    }

Output shape::

    encode → {"encoded": "<urlsafe-b64 string>", "kref": "<input kref>"}
    decode → {"kref": "<decoded kref>",         "verified": true|false}
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import sys


def _urlsafe_b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _urlsafe_b64decode(token: str) -> bytes:
    pad = (-len(token)) % 4
    return base64.urlsafe_b64decode(token + ("=" * pad))


def encode(kref: str, secret: str | None) -> str:
    body = kref.encode("utf-8")
    if not secret:
        return _urlsafe_b64encode(body)
    sig = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).digest()[:8]
    return _urlsafe_b64encode(body + b":" + sig)


def decode(token: str, secret: str | None) -> tuple[str, bool]:
    raw = _urlsafe_b64decode(token)
    if not secret:
        return raw.decode("utf-8"), False
    if b":" not in raw:
        return raw.decode("utf-8"), False
    body, sig = raw.rsplit(b":", 1)
    expected = hmac.new(
        secret.encode("utf-8"), body, hashlib.sha256
    ).digest()[:8]
    return body.decode("utf-8"), hmac.compare_digest(sig, expected)


def main() -> int:
    payload = json.load(sys.stdin)
    args = payload.get("args") or {}
    op = (args.get("op") or "encode").lower()
    secret = args.get("secret") or None

    if op == "encode":
        kref = args.get("kref")
        if not kref:
            json.dump({"error": "kref is required for op=encode"}, sys.stdout)
            return 1
        json.dump({"encoded": encode(kref, secret), "kref": kref}, sys.stdout)
        return 0

    if op == "decode":
        token = args.get("encoded")
        if not token:
            json.dump(
                {"error": "encoded is required for op=decode"}, sys.stdout
            )
            return 1
        try:
            kref, verified = decode(token, secret)
        except Exception as exc:  # noqa: BLE001
            json.dump({"error": f"decode failed: {exc}"}, sys.stdout)
            return 1
        json.dump({"kref": kref, "verified": verified}, sys.stdout)
        return 0

    json.dump(
        {"error": f"unknown op '{op}' — expected 'encode' or 'decode'"},
        sys.stdout,
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
