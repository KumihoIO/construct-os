"""Click-tracking helpers — kref URL-safe codec and link rewriter.

The cold-outreach + click-tracking workflow embeds short tokens in
email links. The token wraps a Kumiho kref so a click can be traced
back to the contact / campaign / send revision that produced it.

This module is the single source of truth for that codec — both the
``kref_encode.py`` Python step (for explicit invocation from a
workflow) and the ``email:`` step (for automatic link rewriting when
``track_clicks`` is set) import from here. Future click-tracking
endpoints in the gateway should also delegate through here so the
encode and decode sides never drift.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import re
from urllib.parse import quote as _urlquote


def _urlsafe_b64encode(raw: bytes) -> str:
    """Base64-url encode without padding (= chars are illegal in URL paths)."""
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _urlsafe_b64decode(token: str) -> bytes:
    """Base64-url decode, restoring the padding stripped during encode."""
    pad = (-len(token)) % 4
    return base64.urlsafe_b64decode(token + ("=" * pad))


def encode_kref(kref: str, secret: str | None = None) -> str:
    """Encode a kref into a URL-safe token.

    Without ``secret`` the token is just b64url(kref) — fine for
    analytics where the worst case is "someone forges a fake click
    on a real ref code". With ``secret`` we append an 8-byte truncated
    HMAC-SHA256 so tampering is detectable on decode without bloating
    the URL.
    """
    body = kref.encode("utf-8")
    if not secret:
        return _urlsafe_b64encode(body)
    sig = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).digest()[:8]
    return _urlsafe_b64encode(body + b":" + sig)


def decode_kref(token: str, secret: str | None = None) -> tuple[str, bool]:
    """Decode a token back into a kref + verification flag.

    The flag is ``True`` only when ``secret`` is provided AND the
    embedded HMAC matches. Without a secret the flag is always
    ``False`` — caller decides whether that's acceptable.
    """
    raw = _urlsafe_b64decode(token)
    if not secret:
        return raw.decode("utf-8"), False
    if b":" not in raw:
        return raw.decode("utf-8"), False
    body, sig = raw.rsplit(b":", 1)
    expected = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).digest()[:8]
    return body.decode("utf-8"), hmac.compare_digest(sig, expected)


# ---------------------------------------------------------------------------
# Link rewriter — wraps URLs in email bodies with the click-tracking redirect
# ---------------------------------------------------------------------------

# Match http(s) URLs — same regex used in the email step's body rewriter.
# Conservative: stops at whitespace, < > " ' ) ] } and trailing punctuation.
# Does NOT try to handle Markdown link syntax — that's the workflow author's
# responsibility (use plain URLs in templates if you want auto-tracking).
_URL_RE = re.compile(r"https?://[^\s<>\"'\)\]\}]+")

# Trailing punctuation we strip off before wrapping, then put back. Keeps
# sentences readable: "Visit https://x.com." stays "Visit <wrapped>.".
_TRAILING_PUNCT = ".,;:!?)]}\"'"


def rewrite_links_with_tracker(
    body: str,
    *,
    encoded_kref: str,
    base_url: str,
) -> str:
    """Rewrite every http(s) URL in ``body`` to the click-tracker form.

    Each ``https://example.com/foo`` becomes
    ``<base_url>/track/c/<encoded_kref>?u=<urlquoted-original>``. The
    encoded kref is shared across all links in this body — a single
    click event per email send. If you need per-link granularity, encode
    multiple krefs upstream and rewrite manually.

    ``base_url`` should NOT have a trailing slash; this function handles
    the join. Empty/missing args raise ``ValueError`` so a misconfigured
    workflow fails loudly instead of sending raw URLs that look tracked
    but aren't.
    """
    if not encoded_kref:
        raise ValueError("encoded_kref is required for link rewriting")
    if not base_url:
        raise ValueError("base_url is required for link rewriting")
    base = base_url.rstrip("/")

    def _wrap(match: re.Match) -> str:
        url = match.group(0)
        # Peel trailing punctuation so it stays outside the wrapped link
        # (otherwise sentence-ending periods get URL-encoded into the dest).
        trailing = ""
        while url and url[-1] in _TRAILING_PUNCT:
            trailing = url[-1] + trailing
            url = url[:-1]
        if not url:
            return match.group(0)
        wrapped = f"{base}/track/c/{encoded_kref}?u={_urlquote(url, safe='')}"
        return wrapped + trailing

    return _URL_RE.sub(_wrap, body)
