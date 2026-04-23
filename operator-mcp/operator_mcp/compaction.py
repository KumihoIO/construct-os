"""Structured Context Compaction → Kumiho.

Provides a 9-section compact prompt template and stores the resulting
summary in Kumiho as a creative memory item for cross-session recall.

B1 from PLAN-harness-improvements.md.
"""
from __future__ import annotations

import os
import re
from datetime import datetime, timezone
from typing import Any

_MEMORY_PROJECT = os.environ.get("KUMIHO_MEMORY_PROJECT", "CognitiveMemory")

from ._log import _log

# ---------------------------------------------------------------------------
# 9-section compact prompt (adapted from Open Claude)
# ---------------------------------------------------------------------------

COMPACT_PROMPT = """\
Analyze the conversation so far and produce a structured summary.

<analysis>
Think through what matters for continuity. Consider:
- What is the user's core goal?
- What decisions have been made?
- What files/code have been modified?
- What is still pending?
- What errors or blockers were encountered?
</analysis>

Then produce a <summary> with exactly these 9 sections:

<summary>
## 1. Primary Request and Intent
What the user originally asked for and the underlying goal.

## 2. Key Technical Concepts
Domain-specific terms, patterns, and architectural decisions relevant to this work.

## 3. Files and Code Sections
List of files read, created, or modified — with the specific sections that matter.

## 4. Errors and Fixes
Problems encountered and how they were resolved.

## 5. Problem Solving
Approaches tried, trade-offs considered, and rationale for chosen solutions.

## 6. All User Messages (Condensed)
Key directives from the user, preserving intent and exact quotes where critical.

## 7. Pending Tasks
What remains to be done, in priority order.

## 8. Current Work
What was actively being worked on when compaction triggered.

## 9. Optional Next Step
Suggested immediate next action to resume seamlessly.
</summary>

IMPORTANT:
- Be thorough — this summary replaces the full conversation history.
- Include file paths and line numbers for code references.
- Preserve exact error messages and fix details.
- Keep user quotes verbatim when they convey intent.
"""


# ---------------------------------------------------------------------------
# Parse compacted output
# ---------------------------------------------------------------------------

def parse_compact_output(raw: str) -> str:
    """Extract the <summary> block from LLM compact output.

    Strips the <analysis> block (internal reasoning) and returns only
    the summary content.
    """
    # Remove analysis block
    cleaned = re.sub(r"<analysis>.*?</analysis>", "", raw, flags=re.DOTALL).strip()

    # Extract summary content
    match = re.search(r"<summary>(.*?)</summary>", cleaned, flags=re.DOTALL)
    if match:
        return match.group(1).strip()

    # Fallback: if no tags, return cleaned output
    return cleaned


# ---------------------------------------------------------------------------
# Build Kumiho capture payload
# ---------------------------------------------------------------------------

def build_compaction_capture(
    session_id: str,
    summary_text: str,
    source_krefs: list[str] | None = None,
) -> dict[str, Any]:
    """Build a Kumiho-compatible capture dict for a compaction summary.

    Returns a dict suitable for passing to kumiho_memory_reflect captures.
    """
    now = datetime.now(timezone.utc)
    date_str = now.strftime("%b %d")

    return {
        "type": "summary",
        "title": f"Session compaction on {date_str} — {session_id}",
        "content": summary_text,
        "tags": ["compact", "session-context", "audit"],
        "space_hint": f"{_MEMORY_PROJECT}/compactions/{session_id}",
        "source_krefs": source_krefs or [],
    }


# ---------------------------------------------------------------------------
# Token estimation (rough, for auto-trigger threshold)
# ---------------------------------------------------------------------------

def estimate_tokens(text: str) -> int:
    """Rough token estimate: ~4 chars per token for English text."""
    return len(text) // 4


# ---------------------------------------------------------------------------
# Auto-trigger check
# ---------------------------------------------------------------------------

DEFAULT_AUTO_COMPACT_THRESHOLD = 150_000  # tokens


def should_auto_compact(
    conversation_tokens: int,
    threshold: int = DEFAULT_AUTO_COMPACT_THRESHOLD,
) -> bool:
    """Check if conversation has exceeded the auto-compaction threshold."""
    return conversation_tokens >= threshold
