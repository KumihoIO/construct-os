# Operator Handoff Skill

**Pattern:** Full-context task transfer between agents.

When work needs to move from one agent to another — different expertise, fresh context, or a different phase of the project — use a structured handoff that gives the receiving agent everything it needs.

## When to Use
- Switching from investigation to implementation
- Handing reviewed code to a different coder for fixes
- Transferring between providers (Claude investigated, Codex implements)
- Agent context is stale or bloated — fresh start with focused brief

## Handoff Prompt Structure

The receiving agent has **zero context**. Your handoff prompt must be a complete, self-contained briefing.

### Required Sections

```markdown
## Task
<What needs to be done — one paragraph>

## Qualifiers
<Critical behavioral constraints:>
- Investigate only (DO NOT edit files) / Fix the issue / Refactor / Add feature
- Preserve existing behavior / Breaking changes acceptable
- Scope: only these files / entire module / cross-cutting

## Relevant Files
<List the specific files the agent needs to read/modify>
- path/to/file.ts — what's relevant about it
- path/to/other.rs — why this matters

## Current State
<What has been done so far, what the codebase looks like now>

## What Was Tried
<Previous approaches and why they didn't work — prevents the new agent from repeating failures>

## Key Decisions
<Architectural or design decisions already made that must be preserved>

## Acceptance Criteria
<Concrete, verifiable conditions for success>
1. Tests pass: `cargo test`
2. No new warnings from `cargo clippy`
3. API contract unchanged

## Constraints
<Guardrails>
- Do not modify the public API
- Keep backward compatibility with v2 clients
- Budget: stay under $X
```

### Task Qualifiers Are Critical

The most common handoff failure is ambiguity about what the agent should DO:
- "Investigate this bug" vs "Fix this bug" — completely different behaviors
- "Refactor for clarity" vs "Optimize for performance" — opposite trade-offs
- "Add error handling" vs "Report what error handling is missing" — one edits, one doesn't

Always be explicit. If the user said "look into this", hand off with "investigate only — DO NOT edit files."

## Execution

```
create_agent(
    title="<role>-<scope>",
    agent_type="<provider based on task>",
    cwd="<repo root>",
    initial_prompt="<complete handoff brief>"
)
```

After spawning:
- Post the agent ID and task summary to the coordination room
- Don't wait by default — let the agent work while you coordinate other work
- Check in via `get_agent_activity` when you need a status update

## Provider Selection for Handoffs

| From → To | When |
|-----------|------|
| Claude → Codex | Investigation complete, now implement |
| Codex → Claude | Implementation done, now review |
| Claude → Claude | Architect hands off to a focused investigator |
| Any → Fresh | Context is bloated, need a clean start |

## Guidelines

- **Err on the side of too much context.** An over-briefed agent wastes a few tokens reading; an under-briefed agent wastes a whole turn going in the wrong direction.
- **Include what was tried.** The #1 cause of handoff loops is the new agent repeating a failed approach.
- **One task per handoff.** Don't bundle "fix the bug AND refactor the module" — two separate agents.
