#!/usr/bin/env python3
"""URL-safe encode/decode of Kumiho krefs for embedding in trackable links.

Used by the cold-outreach + click-tracking workflows: the email step
wraps every link with a redirect to `/track/c/<encoded_kref>?u=<dest>`,
and the click handler at the gateway decodes the kref to look up
which contact / campaign / send actually produced the click.

Protocol: this is a Python step (see PythonStepConfig in
operator_mcp/workflow/schema.py). It reads a JSON object on stdin and
writes a JSON object on stdout.

Input shape::

    {
      "args": {
        "op": "encode" | "decode",
        "kref": "<full kref>",            # required for op=encode
        "encoded": "<urlsafe-b64 token>", # required for op=decode
        "secret": "<optional HMAC secret to make tampering detectable>"
      },
      "context": { ... }   # ignored
    }

Output shape::

    encode → {"encoded": "<urlsafe-b64 string>", "kref": "<input kref>"}
    decode → {"kref": "<decoded kref>",         "verified": true|false}

The `verified` flag on decode is true only when the input includes a
secret AND the embedded HMAC matches. Without a secret the encoded form
is just URL-safe base64 (no integrity guarantee) — fine for non-
sensitive ref codes, but use a secret if a forged click could cost
something.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import sys


def _urlsafe_b64encode(raw: bytes) -> str:
    """Base64-url encode without padding (= chars are illegal in URL paths)."""
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _urlsafe_b64decode(token: str) -> bytes:
    """Base64-url decode, restoring the padding stripped during encode."""
    pad = (-len(token)) % 4
    return base64.urlsafe_b64decode(token + ("=" * pad))


def encode(kref: str, secret: str | None) -> str:
    """Encode a kref into a URL-safe token.

    Without ``secret``: the token is just b64url(kref). Anyone who knows
    the scheme can mint clicks that look real, but for analytics that's
    usually fine.

    With ``secret``: the token is b64url(kref || ":" || hmac_sha256[:8]).
    The 8-byte truncated HMAC is enough to catch tampering without
    bloating the URL.
    """
    body = kref.encode("utf-8")
    if not secret:
        return _urlsafe_b64encode(body)
    sig = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).digest()[:8]
    return _urlsafe_b64encode(body + b":" + sig)


def decode(token: str, secret: str | None) -> tuple[str, bool]:
    """Decode a token back into a kref and a verification flag."""
    raw = _urlsafe_b64decode(token)
    if not secret:
        return raw.decode("utf-8"), False
    # Body and 8-byte signature joined by a colon — the kref itself can
    # contain colons (kref://...) so we split on the LAST occurrence.
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
