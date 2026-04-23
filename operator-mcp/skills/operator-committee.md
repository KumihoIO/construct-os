# Operator Committee Skill

**Pattern:** Dual high-reasoning agents plan in parallel, then coders execute.

Use this for hard problems where a single agent's plan might miss critical angles. Two reasoning agents analyze independently, you synthesize their insights, then hand off to implementation.

## When to Use
- Architecture decisions with significant trade-offs
- Root cause analysis for complex bugs
- Refactoring strategies for large codebases
- Any problem where "step back and think" beats "jump in and code"

## Committee Structure

### Phase 1 — Convene the Committee

Spawn two reasoning agents **simultaneously** with the same problem statement but different perspectives:

```
create_agent(
    title="committee-analyst-A",
    agent_type="claude",
    cwd="...",
    initial_prompt="<problem statement>\n\nAnalyze this problem thoroughly. Consider root causes, constraints, trade-offs, and risks. DO NOT edit, create, or delete any files."
)

create_agent(
    title="committee-analyst-B",
    agent_type="codex",
    cwd="...",
    initial_prompt="<problem statement>\n\nAnalyze this problem thoroughly. Focus on implementation feasibility, edge cases, and potential regressions. DO NOT edit, create, or delete any files."
)
```

**Critical: The NO_EDITS suffix.** Every committee prompt MUST end with:
> DO NOT edit, create, or delete any files.

The committee's job is to think, not to act.

### Phase 2 — Wait and Collect

```
wait_for_agent(agent_id=analyst_a)
wait_for_agent(agent_id=analyst_b)
activity_a = get_agent_activity(agent_id=analyst_a)
activity_b = get_agent_activity(agent_id=analyst_b)
```

**Trust the wait.** Committee agents doing deep analysis may take 15-30 minutes. This is expected. Do not interrupt or poll.

### Phase 3 — Synthesize

Compare the two analyses:
- **Agreement**: Strong signal — proceed with the shared recommendation
- **Partial overlap**: Synthesize the best elements from each
- **Divergence**: Dig deeper. Ask pointed follow-ups or escalate to user

**Think-harder framework**: Challenge the output 2-3 levels deep:
- "Why did both analysts recommend X?"
- "What assumption does this rely on?"
- "What happens if that assumption is wrong?"

### Phase 4 — Implement

Hand the synthesized plan to implementation agents:

```
create_agent(
    title="coder-<plan-step>",
    agent_type="codex",
    cwd="...",
    initial_prompt="Implement the following plan: <synthesized plan with acceptance criteria>"
)
```

### Phase 5 — Review Plan Drift

After implementation, verify the result matches the committee's intent:
- Spawn a reviewer to check alignment with the original plan
- The committee itself should NOT review implementation — keep planning and execution separate

## Guidelines

- **Committee stays clean.** Planning agents never edit files. Implementation agents don't re-plan.
- **Fresh context.** Committee agents get a clean briefing, not a dump of everything tried so far.
- **Two is enough.** More than two reasoning agents rarely adds value — it just adds noise.
- **Provider diversity.** Use different providers (Claude + Codex) for different analytical blind spots.
