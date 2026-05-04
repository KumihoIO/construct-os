# Coherence Audit — Phase 0-1
**Date:** 2026-05-04 (revised after codex/gpt-5.5 review, rounds 1 + 2)
**Branch:** `chore/coherence-audit-2026-05`
**Auditor:** claude/claude-opus-4-7 (xHigh thinking)
**Scope:** Construct improvement plan, Phase 0-1
**Revision history:** v1 issued 2026-05-04; reviewer (codex/gpt-5.5) returned FAIL-fix with citations → v2 reissued same day; reviewer round 2 asked for proof that `kumiho_memory_store` / `kumiho_memory_recall` actually exist as Kumiho-exposed tools → v3 reissued same day, citing the kumiho package on disk and adding a new high-severity row (row 13) that captures a deeper-than-expected mismatch found while looking for that proof. Changes vs v1 and v2 are listed at the bottom.

## Summary

This audit checked 19 prompt / config / doc surfaces against the runtime source of truth on `chore/coherence-audit-2026-05` (off `origin/dev`). The repo is in materially better shape than the brief assumed: the `FoxClaw` rebrand is essentially complete (one stray comment remains), the `conductor → Operator` rebrand is 99 % done (one doc cell remains), and the runtime gates the Kumiho bootstrap on a config flag — so it isn't *blindly* aspirational. The real coherence debt sits in four clusters: a **legacy in-process memory tool surface** (`memory_store`/`memory_recall`/`memory_forget`) that is advertised in prompts and docs but has no `impl Tool` anywhere; **two parallel system-prompt builders** that disagree on section order and bootstrap-file lists; **the Kumiho first-turn block** in `KUMIHO_BOOTSTRAP_PROMPT`, which was lifted from Paseo and tells the agent to invoke a `kumiho-memory:kumiho-memory` skill that this runtime does not have; and — surfaced in v3 — **the Construct installer ships a Kumiho sidecar venv that does not contain the package which registers the very tools (`kumiho_memory_engage` / `reflect` / `recall` / `consolidate`) that `KUMIHO_BOOTSTRAP_PROMPT` mandates**. The prompt's contract is unsatisfiable on a default Construct install today.

**Distribution by classification** (19 rows): **Phantom = 5**, **Drift = 6**, **Aspirational = 4**, **Orphan = 4**.
**Distribution by severity:** high = 7, medium = 4, low = 8.
**Distribution by remediation class:** rewrite-both = 7, config-follows-code = 10, delete = 2, code-follows-config = 0.

The known seed rows are present — row 1 = Kumiho contract (Aspirational, rewrite-both), row 2 = `FoxClaw` residue (Drift, low), row 3 = `BOOTSTRAP.md` (Phantom, delete) — classified per the brief's pre-decided remediation. New surfaces added beyond the seed table: the second prompt builder (row 6), the `HEARTBEAT.md` source-list mismatch (row 7), the wizard's flat-file `MEMORY.md` *and* `AGENTS.md` templates (row 8), the `install.sh` workspace scaffold that re-issues the same legacy memory mandates (row 10), the unimplemented `memory_*` native-tool surface (row 11), the `memory_search` Operator-MCP-vs-native conflation (row 12), the unshipped `kumiho_memory` package on a stock install (row 13, **added in v3**), the cron TZ documentation gap (row 14), the cloudflared tunnel orphan (row 15), the Firecrawl manifest gap (row 16), the risk-level command classification orphan (row 17), the daemon-loop full-Kumiho-prompt knob (row 18), and the channel bootstrap-files comment drift (row 19).

A standalone item from v1 — the `OpenClaw` attribution comment in `src/agent/kumiho.rs:340` — was dropped on review: it is legitimate attribution to a separately-maintained TS project, not a coherence row.

## Audit Table

| # | Surface | Claim location | Source of truth | Type | Severity | Remediation | Notes |
|---|---|---|---|---|---|---|---|
| 1 | Kumiho memory contract — prompt mandates `kumiho_memory_engage` / `kumiho_memory_reflect` | `src/agent/kumiho.rs:40-161` (`KUMIHO_BOOTSTRAP_PROMPT`) | `src/agent/prompt.rs:121-132` (gate); `src/agent/kumiho.rs:19-21` ("degrades gracefully to stateless"); `resources/sidecars/run_kumiho_mcp.py:15-36` (sidecar exit 127) | Aspirational | high | rewrite-both | Gate is `config.kumiho.enabled` only — not MCP connectivity, and not whether the high-level memory tools are even registered. The default install ships a sidecar venv that doesn't have those tools at all (see row 13). |
| 2 | `FoxClaw` rebrand residue | `operator-mcp/tests/conftest.py:15` | `src/config/schema.rs:1050-1052` defaults `harness_project = "Construct"` | Drift | low | config-follows-code | Single stray comment; rebrand otherwise clean. |
| 3 | `BOOTSTRAP.md` auto-loaded as runtime authority | `src/agent/personality.rs:15-23`; `src/channels/mod.rs:3743-3747`; `src/onboard/wizard.rs:6080-6126` | runtime first-turn instructions live in `src/agent/kumiho.rs:90-98` already | Phantom | high | delete | Per brief's 2026-05-04 decision: delete entirely. |
| 4 | `conductor` rebrand residue | `docs/contributing/kumiho-memory-integration.md:143` ("Plans the conductor decomposed for a project.") | runtime calls it Operator (`src/agent/operator/`, `operator-mcp/`) | Drift | low | config-follows-code | s/conductor/Operator/. |
| 5 | First-turn block references Paseo skill + revision-tag flow | `src/agent/kumiho.rs:45-46` ("Do NOT call kumiho_get_revision_by_tag…"); `src/agent/kumiho.rs:90-92` ("Invoke the kumiho-memory:kumiho-memory skill.") | repo-wide grep for `agent\.instruction\|kumiho_get_revision_by_tag\|kumiho-memory:kumiho-memory` returns only those two lines (zero implementations) | Phantom | high | rewrite-both | Construct has no Skill-tool dispatcher recognising `kumiho-memory:kumiho-memory`; no `agent.instruction` revision-tag flow. |
| 6 | Two parallel system-prompt builders | `src/agent/prompt.rs:56-92` (`SystemPromptBuilder`) vs `src/channels/mod.rs:3790-4027` (`build_system_prompt_with_mode_and_autonomy`) | both wired and used; section orders + file lists diverge | Drift | high | rewrite-both | Different ordering of identity vs tools, different bootstrap-file lists. |
| 7 | `HEARTBEAT.md` listed as a personality file but channels intentionally exclude it | `src/agent/personality.rs:15-23` (`PERSONALITY_FILES` includes `HEARTBEAT.md`); wizard writes it (`src/onboard/wizard.rs:6122`) | `src/channels/mod.rs:3737` (5-file list, no `HEARTBEAT.md`); test-asserted intentional exclusion at `src/channels/mod.rs:8832-8838` ("HEARTBEAT.md is intentionally excluded… causes LLMs to emit spurious 'HEARTBEAT_OK' acknowledgments") | Drift | low | rewrite-both | Exclusion is **deliberate** and tested. The coherence issue is the un-annotated `PERSONALITY_FILES` list — fix is to attach a per-file scope flag (channel-eligible vs daemon-only) so the two paths consume one list. Severity is low because nothing leaks into channel prompts today. |
| 8 | Wizard `MEMORY.md` and `AGENTS.md` describe a flat-file daily-memory model | `src/onboard/wizard.rs:6098-6117` (`MEMORY.md` template); `src/onboard/wizard.rs:5921-5927` (else-branch `AGENTS.md` Memory System: "Daily notes: `memory/YYYY-MM-DD.md` — raw logs (accessed via memory tools)"); `src/onboard/wizard.rs:5938-5942` (else-branch session_steps: "Use `memory_recall` for recent context"); `src/onboard/wizard.rs:5951-5955` (always-printed: "Memory is limited — if you want to remember something, WRITE IT TO A FILE", "When someone says 'remember this' -> update daily file or MEMORY.md") | `src/memory/mod.rs:66-69`: "Persistent memory in Construct is handled exclusively by Kumiho MCP… the runtime `Memory` trait binding is therefore always `NoneMemory` — in-session, non-persistent."; `src/agent/kumiho.rs:14-21`: "Kumiho is Construct's *only* persistent memory store." | Aspirational | medium | rewrite-both | Three sub-issues here: (a) the else-branch `AGENTS.md` describes daily-files that the runtime doesn't service; (b) the always-printed "WRITE IT TO A FILE" block contradicts the Kumiho branch even when the user opts into Kumiho; (c) the Kumiho branch tells the agent `memory_store/recall/forget` are "disabled" (line 5915), but the prompt's tool list still advertises them — see row 11. Wizard generated content needs to be audited against the runtime's actual memory backend, not against the older flat-file model. |
| 9 | Wizard `BOOTSTRAP.md` is self-deleting prose | `src/onboard/wizard.rs:6080-6096` ("Delete this file. You don't need a bootstrap script anymore — you're you now.") | the file is auto-loaded *every prompt* via `src/agent/personality.rs:22`; once written it persists and re-injects | Drift | low | delete | Subsumed by row 3 (BOOTSTRAP.md goes away). Listed for narrative completeness. |
| 10 | `install.sh` workspace scaffolding hands the agent a `memory_recall` mandate and a flat-file `MEMORY.md` | `install.sh:1015-1086` writes `IDENTITY.md`, `USER.md`, `MEMORY.md`, `AGENTS.md`, `SOUL.md`. `install.sh:1085` instructs: "3. Use memory_recall for recent context"; `install.sh:1061-1074` writes a `MEMORY.md` body (`Key Facts / Decisions & Preferences / Lessons Learned / Open Loops`). | `memory_recall` has no `impl Tool` anywhere in `src/tools/` (see row 11); `MEMORY.md` is then auto-injected into every system prompt by `src/agent/personality.rs:23` and `src/channels/mod.rs:3750` | Phantom | high | config-follows-code | The shell installer ships a workspace whose first instruction is to call a tool the runtime does not implement, and a memory file the runtime never reads programmatically. Fix: rewrite `install.sh:1076-1088` to mirror whatever the wizard's Kumiho branch settles on (after row 8 lands), and either drop `MEMORY.md` from the install scaffold or make its content runtime-honest. |
| 11 | Native `memory_store` / `memory_recall` / `memory_forget` advertised as tools but have no `impl Tool` | tool-list advertisements at `src/agent/loop_.rs:3940-3950` and `src/channels/mod.rs:5356-5366`; descriptions reused at `src/agent/loop_.rs:4906-4908`; XML alias-canonicalisation at `src/agent/loop_.rs:1102-1104`; doc references at `docs/maintainers/repo-map.md:104` ("Memory: `memory_store`, `memory_recall`, `memory_forget`"), `docs/reference/sop/cookbook.md:59` ("tools: memory_recall"), `docs/reference/sop/cookbook.md:91` ("tools: memory_store"); IAM policy mention at `src/security/iam_policy.rs:230,236,339` (`memory_search`); approval allowlist at `src/approval/mod.rs:350,369,634` | grep `impl Tool for.*Memory\|MemoryRecallTool\|MemoryStoreTool\|MemoryForgetTool` in `src/tools/`, `src/memory/`: zero matches. The runtime's `Memory` trait resolves to `NoneMemory` (`src/memory/mod.rs:66-69`); persistent memory is delegated to Kumiho MCP (which exposes `kumiho_memory_*` names, not `memory_*`). | Phantom | high | config-follows-code | The legacy tool-name surface from before the Kumiho-only decision still lives in prompts, docs, IAM policy, approval defaults, and a parser-alias table. Drop it everywhere — `loop_.rs:3940-3950`, `channels/mod.rs:5356-5366`, the `4906-4908` description list, the `1102-1104` alias map, the IAM permissions, the cookbook examples, and the repo-map row. The Kumiho-branch wizard prose at `wizard.rs:5915` already says these tools are "disabled when Kumiho is active"; honour that by removing them rather than continuing to advertise them. |
| 12 | `memory_search` referenced as a native channel tool but only registered in Operator MCP | `src/channels/mod.rs:3767-3768` ("Daily memory files (`memory/*.md`) are NOT injected — they are accessed on-demand via `memory_recall` / `memory_search` tools."); `src/security/iam_policy.rs:230,236,339` lists `memory_search` as a `construct_permission` | only implementation is `operator-mcp/operator_mcp/operator_mcp.py:2095,2532` and `operator-mcp/operator_mcp/tool_handlers/memory.py:115` (Operator MCP tool, not native) | Phantom | medium | config-follows-code | The Rust comment promises a tool the native registry doesn't ship. Either drop the reference or qualify it as an Operator-MCP-provided tool. The IAM permission entry probably needs deletion too (or a relocation to the Operator-side IAM scope). |
| 13 | Construct's Kumiho sidecar venv ships `kumiho` only; the `kumiho_memory` package — which registers `kumiho_memory_engage` / `reflect` / `recall` / `consolidate` etc. — is not installed, so those tools are absent from Construct's MCP at runtime | `KUMIHO_BOOTSTRAP_PROMPT` at `src/agent/kumiho.rs:40-161` mandates `kumiho_memory_engage` / `kumiho_memory_reflect` / `kumiho_memory_consolidate`; `docs/contributing/kumiho-memory-integration.md:208-211` (smoke test) treats `kumiho_memory_engage` / `kumiho_memory_reflect` / `kumiho_memory_recall` / `kumiho_memory_consolidate` as required-visible; `src/onboard/wizard.rs:5910-5914` advertises `kumiho_memory_engage` / `kumiho_memory_reflect` / `kumiho_memory_store` / `kumiho_memory_recall` to the agent | installer: `scripts/install-sidecars.sh:171` (`pip install --quiet 'kumiho[mcp]>=0.9.20'` — no `kumiho_memory`); `scripts/install-sidecars.bat:107` matches; the kumiho 0.9.24 dist-info METADATA at `~/.construct/kumiho/venv/lib/python3.11/site-packages/kumiho-0.9.24.dist-info/METADATA` declares only `dev` / `docs` / `mcp` / `all` extras — none pull in `kumiho_memory`. Tool registration: the bare `kumiho` package registers 45 tools incl. `kumiho_memory_store` (`kumiho/mcp_server.py:2006`) and `kumiho_memory_retrieve` (`:2073`) — but *not* engage/reflect/recall/consolidate. Auto-discovery shim at `kumiho/mcp_server.py:3079-3090` extends `TOOLS` only `if kumiho_memory` is importable; on `ImportError` the high-level tool set is silently skipped. For comparison, when `kumiho_memory` 0.5.0 *is* installed (e.g. in `~/.kumiho/venv/lib/python3.11/site-packages/`), `kumiho_memory/mcp_tools.py:555,601,622,641,701,763,821,882,975` registers ingest / add_response / consolidate / **recall** / discover_edges / store_execution / **engage** / **reflect** / dream_state. Construct's installer never lands that package. | Aspirational | high | rewrite-both | The whole `KUMIHO_BOOTSTRAP_PROMPT` premise — engage / reflect / recall — is satisfiable only when `kumiho_memory` is installed alongside `kumiho`. On a stock Construct install today it isn't. Two-sided fix: (a) **code change** — extend `scripts/install-sidecars.{sh,bat}` to also install `kumiho_memory` (or pin a Construct-side `kumiho[memory]` extra and have `kumiho` declare it); (b) **prompt change** — gate the `KUMIHO_BOOTSTRAP_PROMPT` engage/reflect mandates on whether the high-level tools were registered. This is the deeper, *operational* version of row 1; row 1's gate is config-only, but the more concrete failure mode found in v3 is "configured + sidecar healthy + tools still missing because the package isn't there." |
| 14 | Cron `tz` field exists; documented in CLI top-level but absent from `[cron]` config / detail docs | runtime: `src/cron/types.rs:92-97` (`tz: Option<String>`), with IANA-tz parsing tests at `src/cron/types.rs:210-218`. Tool surface: `src/tools/cron_add.rs`. | CLI list mentions it: `docs/reference/cli/commands-reference.md:144` (`construct cron add <expr> [--tz <IANA_TZ>] <command>`). But `docs/reference/api/config-reference.md` has no TZ description in the `[cron]` block, and `commands-reference.md` doesn't document the default behaviour when `--tz` is omitted (UTC). | Orphan | low | config-follows-code | v1 of this audit incorrectly claimed *no* cron-TZ docs existed anywhere; the CLI list does mention `--tz`. Narrowed: there is a one-line CLI flag mention; there is no config-reference entry, no default-behaviour description, no per-job persistence note. Document the default and the IANA-string semantics. |
| 15 | Cloudflared tunnel implementation not in config-reference | `src/tunnel/cloudflare.rs` (cloudflared subprocess + URL parsing); `src/config/schema.rs` tunnel section | `docs/reference/api/config-reference.md` has no `[tunnel]` section | Orphan | medium | config-follows-code | Document. |
| 16 | Browser/web_fetch Firecrawl fallback omitted from manifest | `src/tools/web_fetch.rs:268-274` `description()` includes "Falls back to Firecrawl for JS-heavy/bot-blocked sites (if enabled)." | `tool_descriptions/en.toml:59` (and the 30 locale variants) carry only the older blurb without the Firecrawl mention | Orphan | low | config-follows-code | v1 cited the wrong line (185-187); corrected to 268-274. Update the manifest blurb across locales (or move to a single source). |
| 17 | Risk-level command classification | `docs/reference/api/config-reference.md:486-487` documents `require_approval_for_medium_risk: true` and `block_high_risk_commands: true` knobs | runtime mapping is concrete: `src/security/policy.rs:22-26` defines `enum CommandRiskLevel { Low, Medium, High }`; `src/security/policy.rs:723-770` enumerates the high-risk command basenames (rm, mkfs, dd, shutdown, sudo, ssh, etc., plus Windows variants); `src/security/policy.rs:783-816` lists medium-risk verbs (`git commit/push/reset/clean/rebase/…`, `npm install/add/…`, `cargo add/install/…`, `touch`, `mkdir`, `mv`, `cp`, `ln`, `mklink`, etc.); destructive-pattern detection at `:772-781` | Orphan | medium | config-follows-code | v1 misclassified this as Phantom. The mapping is real — the user-facing knob just isn't paired with a published list. Fix is to publish the table (likely under `docs/security/`), citing `src/security/policy.rs:723-816` as source of truth. |
| 18 | Daemon agent loop always uses full ~1500-token Kumiho prompt | `src/agent/prompt.rs:121-132` hardcodes the full prompt; `src/agent/kumiho.rs:163-190` defines a compact `KUMIHO_CHANNEL_BOOTSTRAP_PROMPT` (~400 tokens) used only by `append_kumiho_channel_bootstrap` (`src/agent/kumiho.rs:430-444`) | no documented contract requires lite mode for non-channel agents; this is an unrealised optimisation rather than a violated promise | Aspirational | low | rewrite-both | v1 misclassified this as Phantom. Reclassified as Aspirational with low severity because no doc commits to it. Optional remediation: add a `kumiho.prompt_mode = "full" \| "lite"` config knob (or wire to existing `compact_context`) so long-running daemon sessions can opt into the lite block. |
| 19 | Channel bootstrap-files comment lists 7 files; code passes 5 + 2 conditional | `src/channels/mod.rs:3760` ("5. Bootstrap files — AGENTS, SOUL, TOOLS, IDENTITY, USER, BOOTSTRAP, MEMORY") | `src/channels/mod.rs:3737` static array is 5 files; BOOTSTRAP.md and MEMORY.md handled separately at lines 3744-3750 | Drift | low | config-follows-code | Comment and code agree in spirit but disagree literally. Cleanup will fall out of row 3 (BOOTSTRAP.md goes away). |

## Per-row Narrative

### Row 1 — Kumiho memory contract (Aspirational, high, rewrite-both)
**Claim:** `src/agent/kumiho.rs:40-161` defines `KUMIHO_BOOTSTRAP_PROMPT`, which mandates: "Call `kumiho_memory_engage` ONCE when prior context is needed…", "REFLECT: Call `kumiho_memory_reflect`…", and "NEVER SAY 'I DON'T KNOW' WITHOUT CHECKING MEMORY". This block is appended to the system prompt by `KumihoBootstrapSection::build` (`src/agent/prompt.rs:121-132`):
```rust
fn build(&self, ctx: &PromptContext<'_>) -> Result<String> {
    if !ctx.kumiho_enabled { return Ok(String::new()); }
    Ok(crate::agent::kumiho::KUMIHO_BOOTSTRAP_PROMPT.to_string())
}
```
and also by `append_kumiho_bootstrap()` in the agent run loop (`src/agent/kumiho.rs:413-423`).

**Actual:** the gate is **only** `ctx.kumiho_enabled`, which is set from `config.kumiho.enabled` (default `true`, `src/config/schema.rs:1001-1002`). There is **no runtime check** that the Kumiho MCP sidecar actually started or stayed connected. `src/agent/kumiho.rs:19-21` admits: *"Injection is non-fatal: if the script path does not exist at runtime the MCP registry will simply log an error and continue — the agent degrades gracefully to stateless operation."* The sidecar exits with code 127 if the venv is missing (`resources/sidecars/run_kumiho_mcp.py:15-36`). When that happens the prompt still demands `kumiho_memory_engage` calls, and the tools are not in the registry — the agent fires tool calls into the void.

There is a *second* failure mode v3 of this audit added under row 13: even when the sidecar is healthy, the bare `kumiho[mcp]` package that Construct's installer ships does not register `kumiho_memory_engage` / `reflect` / `recall` / `consolidate`. Those names live in a sibling `kumiho_memory` package (`~/.kumiho/venv/lib/python3.11/site-packages/kumiho_memory/mcp_tools.py:641,821,882,975`) which Construct's `scripts/install-sidecars.sh:171` does not install. The `try/except ImportError: pass` shim at `kumiho/mcp_server.py:3079-3090` swallows that absence silently. The agent therefore sees `kumiho_memory_store` (from the bare package, registered at `kumiho/mcp_server.py:2006`) and `kumiho_memory_retrieve` (`:2073`) — but not the engage/reflect tools the prompt insists on. Row 13 captures this in detail; the two rows want the same fix landed together.

**Why this classification:** matches the brief's canonical Aspirational / rewrite-both example. The remediation is the prompt-builder runtime conditional the brief specified — *if Kumiho high-level memory tools not registered, strip the engage/reflect mandates*; *if registered, inject the full block.* The probe and the gating flag should also drive row 13's fix.

### Row 2 — `FoxClaw` rebrand residue (Drift, low, config-follows-code)
**Claim:** `operator-mcp/tests/conftest.py:15`:
```python
# `[kumiho].harness_project` (e.g. legacy "FoxClaw") would otherwise make
```
**Actual:** repo-wide grep finds **one** match for `FoxClaw|Foxclaw|foxclaw|FOXCLAW`. The current default is `harness_project = "Construct"` (`src/config/schema.rs:1050-1052`). Identity files (`src/identity.rs`, `src/agent/personality.rs`) contain no `FoxClaw` references. The rebrand is essentially complete.
**Why this classification:** Drift — both the legacy name and current name exist; the legacy mention is residual.

### Row 3 — `BOOTSTRAP.md` auto-loaded as runtime authority (Phantom, high, delete)
**Claim:** `src/agent/personality.rs:22` lists `BOOTSTRAP.md` in `PERSONALITY_FILES`; the loader unconditionally reads it from the workspace dir (`src/agent/personality.rs:85-117`). `src/channels/mod.rs:3743-3747`:
```rust
// BOOTSTRAP.md — only if it exists (first-run ritual)
let bootstrap_path = workspace_dir.join("BOOTSTRAP.md");
if bootstrap_path.exists() {
    inject_workspace_file(prompt, workspace_dir, "BOOTSTRAP.md", max_chars_per_file);
}
```
The wizard writes a default at `src/onboard/wizard.rs:6080-6096` whose body is *"Delete this file. You don't need a bootstrap script anymore — you're you now."*

**Actual:** the runtime already has a *real* first-turn template in `src/agent/kumiho.rs:90-98` (the `=== FIRST MESSAGE ONLY ===` block). The workspace-level `BOOTSTRAP.md` claims runtime authority — its contents are pasted verbatim into every system prompt — but it is a user-editable markdown file outside the prompt builder's control.

**Why this classification:** Phantom — `BOOTSTRAP.md` claims to direct runtime behaviour but is not a vetted runtime contract. Remediation = delete (Phase 0-2 will: drop the entry from `PERSONALITY_FILES`, drop the special-case in `channels/mod.rs:3743-3747`, drop the wizard write at `wizard.rs:6126`, drop the `install.sh` `_write_if_missing "$workspace_dir/BOOTSTRAP.md"` call if any, and remove the snapshot tests in `wizard.rs:6759-6917` that assert against its contents).

### Row 4 — `conductor` rebrand residue (Drift, low, config-follows-code)
**Claim:** `docs/contributing/kumiho-memory-integration.md:143`:
```
| `Construct/Plans/<project>` | Plans the conductor decomposed for a project. |
```
**Actual:** the orchestrator runtime is named Operator throughout the code (`src/agent/operator/`, `operator-mcp/`). This is the only stale `conductor` reference in the repo's docs.
**Why this classification:** simple Drift; replace with "Operator".

### Row 5 — First-turn block references Paseo skill + revision-tag flow (Phantom, high, rewrite-both)
**Claim:** `src/agent/kumiho.rs:38` says the bootstrap was *"Modelled after the Paseo `session-bootstrap.py` CONTEXT string but adapted for Construct naming conventions."* Two relics of the Paseo origin survived:

- Line 45-46: `- Do NOT invoke the kumiho-memory skill.` / `- Do NOT call kumiho_get_revision_by_tag.  Identity is already loaded.`
- Line 90-92 (inside `=== FIRST MESSAGE ONLY ===`): `1. Invoke the kumiho-memory:kumiho-memory skill.`

**Actual:** repo-wide grep for `agent\.instruction|kumiho_get_revision_by_tag|kumiho-memory:kumiho-memory` returns only those lines. Construct has no Skill-tool dispatcher that recognises `kumiho-memory:kumiho-memory` (Construct's `src/skills/` is the ClawHub skill registry — different concept). Construct has no `agent.instruction` revision-tag flow; the prompt builder loads identity from `personality.rs` files, not from a Kumiho-stored agent-instruction revision.

**Why this classification:** Phantom — the prompt instructs the agent to use surfaces that the runtime does not provide. Remediation: rewrite both — define a coherent first-turn spec for Construct (which uses `personality.rs`-loaded identity), then update the prompt to match.

### Row 6 — Two parallel system-prompt builders (Drift, high, rewrite-both)
**Claim:** `src/agent/prompt.rs:56-92` defines a section-based `SystemPromptBuilder`:
```
DateTime → Identity → OperatorIdentity → KumihoBootstrap →
ToolHonesty → Tools → Safety → Skills → Workspace → Runtime → ChannelMedia
```
**Actual:** `src/channels/mod.rs:3833-4027` defines `build_system_prompt_with_mode_and_autonomy`, an ad-hoc string builder used by channel agents. Section order is different (Tool Honesty first, then Tools, then Safety, then Skills, then Workspace, then Project Context, then DateTime, then Runtime, then Channel Capabilities). Identity is appended *after* tools, not before. The channel builder calls `load_openclaw_bootstrap_files` (`src/channels/mod.rs:3727-3751`) which loads only 5 of the 8 files in `PERSONALITY_FILES`. The two prompt builders also disagree on Kumiho variant (full vs lite — see row 18).

**Why this classification:** Drift between two co-equal builders. Remediation is consolidation: pick the section-based builder, parameterise it, retire the ad-hoc one.

### Row 7 — `HEARTBEAT.md` listed in PERSONALITY_FILES; channels intentionally exclude it (Drift, low, rewrite-both)
**Claim:** `src/agent/personality.rs:15-23`:
```rust
const PERSONALITY_FILES: &[&str] = &[
    "SOUL.md", "IDENTITY.md", "USER.md", "AGENTS.md",
    "TOOLS.md", "HEARTBEAT.md", "BOOTSTRAP.md", "MEMORY.md",
];
```
And the wizard writes `HEARTBEAT.md` at `src/onboard/wizard.rs:6122`.

**Actual:** the channel prompt path uses a separate, smaller list at `src/channels/mod.rs:3737`:
```rust
let bootstrap_files = ["AGENTS.md", "SOUL.md", "TOOLS.md", "IDENTITY.md", "USER.md"];
```
A test at `src/channels/mod.rs:8832-8838` *asserts* the exclusion is intentional, with an explanatory comment:
```rust
// HEARTBEAT.md is intentionally excluded from channel prompts — it's only
// relevant to the heartbeat worker and causes LLMs to emit spurious
// "HEARTBEAT_OK" acknowledgments in channel conversations.
assert!(
    !prompt.contains("### HEARTBEAT.md"),
    "HEARTBEAT.md should not be in channel prompt"
);
```

**Why this classification:** the channel exclusion is **deliberate, documented, and tested** — so this is not a bug; nothing leaks. The remaining coherence issue is that `PERSONALITY_FILES` is a single un-annotated list shared between two consumers with different scopes. The right fix is structural: replace the bare `&[&str]` with a typed list whose entries declare *channel-eligible vs daemon-only* (e.g. an enum or a struct with a `scope` field). After that change, `personality.rs` and `channels/mod.rs` consume the same source of truth and the test on line 8832-8838 enforces the daemon-only flag rather than a magic substring. Severity is low because today there is no observed leak; this is a maintenance hazard, not a runtime bug. v1 over-rated this at medium and missed the test-asserted intent — corrected here.

### Row 8 — Wizard `MEMORY.md` *and* `AGENTS.md` describe a flat-file daily-memory model (Aspirational, medium, rewrite-both)
**Claim:** Multiple sub-claims in `src/onboard/wizard.rs`:

- `MEMORY.md` template (`wizard.rs:6098-6117`): *"Daily files (`memory/YYYY-MM-DD.md`) capture raw events (on-demand via tools) … This file is auto-injected into your system prompt each session … ONLY loaded in main session (direct chat with your human) … NEVER loaded in group chats or shared contexts."*
- `AGENTS.md` Memory System block, else-branch (`wizard.rs:5921-5927`): *"Daily notes: `memory/YYYY-MM-DD.md` — raw logs (accessed via memory tools) … Long-term: `MEMORY.md` — curated memories (auto-injected in main session)."*
- `AGENTS.md` else-branch session_steps (`wizard.rs:5938-5942`): *"3. Use `memory_recall` for recent context (daily notes are on-demand) … 4. If in MAIN SESSION (direct chat): `MEMORY.md` is already injected"*
- `AGENTS.md` always-printed (every memory backend, `wizard.rs:5951-5955`): *"Memory is limited — if you want to remember something, WRITE IT TO A FILE … When someone says 'remember this' -> update daily file or MEMORY.md."*
- Kumiho-branch contradiction (`wizard.rs:5915`): *"Do NOT use `memory_store` / `memory_recall` / `memory_forget` — those are disabled when Kumiho is active."*

**Actual:** `src/memory/mod.rs:66-69` is explicit: *"Persistent memory in Construct is handled exclusively by Kumiho MCP (injected at the agent level). The runtime `Memory` trait binding is therefore always `NoneMemory` — in-session, non-persistent."* `src/agent/kumiho.rs:14-21` agrees: *"Kumiho is Construct's *only* persistent memory store."* There is no `memory/YYYY-MM-DD.md` daily-file mechanism the runtime services. The "ONLY loaded in main session" claim is not enforced — `personality.rs::load_personality` reads `MEMORY.md` for both the `SystemPromptBuilder` and the channel builder paths, regardless of channel.

The Kumiho-branch's claim that `memory_store/recall/forget` are "disabled when Kumiho is active" is itself wrong — those tool names are still advertised in every prompt (see row 11) — so even the *correct* Kumiho branch carries a false claim.

The four Kumiho tool names the wizard names at `wizard.rs:5910-5914` resolve unevenly against what's actually installed: `kumiho_memory_engage` and `kumiho_memory_reflect` (advertised at lines 5911 and 5912) live in the sibling `kumiho_memory` package and are **not registered on a stock Construct install**; `kumiho_memory_store` (line 5913) IS registered on a stock install (`~/.construct/kumiho/venv/lib/python3.11/site-packages/kumiho/mcp_server.py:2006`); `kumiho_memory_recall` (line 5914) is NOT — the bare `kumiho` package's nearest analogue is named `kumiho_memory_retrieve` (`mcp_server.py:2073`). See row 13 for the full installer/package picture.

**Why this classification:** Aspirational — the wizard tells the agent about a memory system that the runtime does not expose. Three concrete sub-fixes:
1. Drop the entire else-branch (`wizard.rs:5920-5927`, `5937-5942`) once "openclaw"-style flat-file memory is not a supported `memory.backend`. Today the only supported backends are `kumiho` and `none` (`src/memory/mod.rs:70-108`).
2. Drop or rewrite the always-printed `AGENTS.md` block (`wizard.rs:5951-5955`) so it does not say "WRITE IT TO A FILE" when the active backend is Kumiho.
3. Remove the `MEMORY.md` template entirely from the wizard set (`wizard.rs:6128-6130`), or rewrite it to point at Kumiho space conventions (`Construct/Sessions/<id>/Outcomes`, etc., already documented in `KUMIHO_BOOTSTRAP_PROMPT:114-124`).

v1 captured only sub-fix 3. Reviewer flagged the broader scope; this revision rolls all three into row 8.

### Row 9 — Wizard `BOOTSTRAP.md` is self-deleting prose (Drift, low, delete)
Subsumed by row 3. The wizard-generated content (`src/onboard/wizard.rs:6080-6096`) is internally inconsistent — *"Delete this file. You don't need a bootstrap script anymore — you're you now."* — but the runtime auto-loads the file every prompt until the user manually deletes it. Listed separately so the recommendation list reads cleanly.

### Row 10 — `install.sh` workspace scaffolding mandates `memory_recall` and writes a flat-file `MEMORY.md` (Phantom, high, config-follows-code)
**Claim:** `install.sh:1015-1086` is the bash equivalent of the wizard's workspace seed. It writes:
- `MEMORY.md` (`install.sh:1061-1074`) with the legacy `Key Facts / Decisions & Preferences / Lessons Learned / Open Loops` body.
- `AGENTS.md` (`install.sh:1076-1088`) which contains:
  ```
  ## Every Session (required)
  Before doing anything else:
  1. Read SOUL.md — this is who you are
  2. Read USER.md — this is who you're helping
  3. Use memory_recall for recent context
  ```

**Actual:** `memory_recall` has no `impl Tool` in `src/tools/` or `src/memory/` (see row 11 for the full enumeration). `MEMORY.md` is unconditionally injected into every system prompt by `src/agent/personality.rs:23` and (when present) `src/channels/mod.rs:3750`. The shell installer therefore ships a brand-new workspace whose **first** instruction to the agent is to call a tool that does not exist, and a memory file the runtime never reads.

**Why this classification:** Phantom — `install.sh` references a runtime surface that doesn't exist. The remediation is purely on the install.sh side: rewrite the seed `AGENTS.md` to mirror whatever the wizard's Kumiho branch settles on (after row 8 lands), and either drop `MEMORY.md` from the install scaffold or rewrite its content to be runtime-honest. v1 missed this surface entirely. This is **separate from the wizard** (row 8) because `install.sh` is the canonical entry point for the public one-line installer — many users will never run the wizard at all.

### Row 11 — Native `memory_store` / `memory_recall` / `memory_forget` are advertised as tools but unimplemented (Phantom, high, config-follows-code)
**Claim:** the prompt-time tool list at `src/agent/loop_.rs:3940-3950` advertises:
```
"memory_store" — "Save to memory. Use when: …"
"memory_recall" — "Search memory. Use when: …"
"memory_forget" — "Delete a memory entry. Use when: …"
```
The same trio is repeated at `src/channels/mod.rs:5356-5366` for channel agents; at `src/agent/loop_.rs:4906-4908` as a parallel description list; and at `src/agent/loop_.rs:1102-1104` as XML-tag aliases (`memoryrecall|memory_recall|recall|memrecall → memory_recall`, etc.).

The same names also appear as if they were real tools across the docs and the security stack:
- `docs/maintainers/repo-map.md:104`: *"Memory: `memory_store`, `memory_recall`, `memory_forget`"*.
- `docs/reference/sop/cookbook.md:59`: *"tools: memory_recall"*.
- `docs/reference/sop/cookbook.md:91`: *"tools: memory_store"*.
- `src/security/iam_policy.rs:230,236,339`: `memory_search` listed as a `construct_permission` (note: `memory_search` is Operator-MCP-only — see row 12).
- `src/approval/mod.rs:350,369,634`: `memory_recall` is in the `auto_approve` allowlist and the approval-needs tests.
- `src/security/policy.rs:1540,1549,1561`: `memory_recall`/`memory_store` are referenced in tool-operation enforcement tests.
- `src/onboard/wizard.rs:7116-7118` (test): asserts the wizard-generated `TOOLS.md` lists `memory_store/recall/forget` as built-ins.

**Actual:** grep `impl Tool for.*Memory|MemoryRecallTool|MemoryStoreTool|MemoryForgetTool` over `src/tools/` and `src/memory/` returns **zero matches**. There is no `src/tools/memory_*.rs` file. The runtime `Memory` trait resolves to `NoneMemory` (`src/memory/mod.rs:66-108`); persistent memory is delegated to Kumiho MCP, which exposes the `kumiho_memory_*` namespace, **not** the unprefixed `memory_*` names. The Kumiho replacement names are *real* tools — verified by reading the Python source on disk:

- `kumiho_memory_store` — registered at `~/.construct/kumiho/venv/lib/python3.11/site-packages/kumiho/mcp_server.py:2006` (dispatch `:2896`). Reachable on a stock Construct install.
- `kumiho_memory_retrieve` — registered at the same file, line 2073. Reachable on a stock Construct install.
- `kumiho_memory_engage`, `kumiho_memory_reflect`, `kumiho_memory_recall`, `kumiho_memory_consolidate`, `kumiho_memory_dream_state`, etc. — registered at `~/.kumiho/venv/lib/python3.11/site-packages/kumiho_memory/mcp_tools.py:555,601,622,641,701,763,821,882,975`. **Not reachable on a stock Construct install** — see row 13.

So the unprefixed `memory_*` Phantoms have a real namespace they were *meant* to be replaced by, but: (a) the canonical name `kumiho_memory_recall` is reachable only after row 13's installer fix, and (b) the bare `kumiho` package's nearest analogue is named `kumiho_memory_retrieve` rather than `kumiho_memory_recall` — so any cleanup pass that mass-renames `memory_recall → kumiho_memory_recall` will produce more Phantoms unless row 13 lands first. The wizard's own Kumiho branch acknowledges the unprefixed surface is gone at `wizard.rs:5915` ("Do NOT use `memory_store` / `memory_recall` / `memory_forget` — those are disabled when Kumiho is active") — but the prompt's tool list still advertises them, the IAM policy still gates on them, the SOP cookbook still references them, and the parser still canonicalises XML aliases for them.

**Why this classification:** Phantom on a large scale — the prompt promises the agent a memory tool surface the runtime does not implement. Fix is config-follows-code in the strict sense (the runtime says these tools are gone; bring docs/prompts/IAM/parser into line):

- `src/agent/loop_.rs:3940-3950` (tool-list ad), `:4906-4908` (description list), `:1102-1104` (alias map): drop the three entries.
- `src/channels/mod.rs:5356-5366`: drop the three entries.
- `src/security/iam_policy.rs:230,236,339`: drop `memory_search` from `construct_permissions` (or move to Operator-MCP-side IAM scope).
- `src/approval/mod.rs:350`: drop `memory_recall` from `auto_approve` defaults; update tests at `:369,634`.
- `src/security/policy.rs:1540,1549,1561`: replace test references with Kumiho-tool equivalents or drop.
- `src/onboard/wizard.rs:7116-7118`: drop the test expectation that `TOOLS.md` lists these built-ins.
- `docs/maintainers/repo-map.md:104`: rewrite the Memory tool category as "delegated to Kumiho MCP (`kumiho_memory_*`)".
- `docs/reference/sop/cookbook.md:59,91`: rewrite the example SOPs to use a real tool (or migrate to `kumiho_memory_engage`/`reflect`).
- `src/channels/mod.rs:3768`: drop the `memory_recall` reference in the daily-memory comment (also row 12).

This is the highest-multiplicity row in the audit; its fan-out is what makes the cleanup feel large. Reviewer rightly flagged that v1 missed it entirely.

### Row 12 — `memory_search` referenced as a native tool but only registered in Operator MCP (Phantom, medium, config-follows-code)
**Claim:** `src/channels/mod.rs:3767-3768`:
```
/// Daily memory files (`memory/*.md`) are NOT injected — they are accessed
/// on-demand via `memory_recall` / `memory_search` tools.
```
And `src/security/iam_policy.rs:230,236,339` lists `memory_search` as a `construct_permission`.

**Actual:** the only `memory_search` implementation is in the Operator MCP server: `operator-mcp/operator_mcp/operator_mcp.py:2095` (registration), `:2532-2534` (dispatch), `operator-mcp/operator_mcp/tool_handlers/memory.py:115` (handler). It is not a native Rust tool. The native runtime's prompt-time tool list (`src/agent/loop_.rs:3940-3950` and `src/channels/mod.rs:5356-5366`) does not include `memory_search`.

**Why this classification:** Phantom in the same family as row 11, but distinct: `memory_search` only ever existed on the Operator side, so the issue is specifically the Rust comment and the IAM policy entry that conflate the two scopes. Fix: drop the `memory_search` mention from `channels/mod.rs:3768`; either drop the IAM permission or relocate it to an Operator-MCP-scoped policy. Severity medium because the IAM grant could be misleading in a security review. v1 missed this surface.

### Row 13 — Construct sidecar venv missing the `kumiho_memory` package (Aspirational, high, rewrite-both)
**Claim:** the Kumiho contract surfaces in three places mandate or assume the high-level memory tools:

- `KUMIHO_BOOTSTRAP_PROMPT` at `src/agent/kumiho.rs:40-161` — *"Call `kumiho_memory_engage` ONCE…"*, *"Call `kumiho_memory_reflect` only for explicit 'remember this' requests…"*, *"COMPACTION — On /compact or auto-compression, capture summary via `kumiho_memory_reflect` with `type='summary'`…"*
- `docs/contributing/kumiho-memory-integration.md:208-211` (smoke test) — *"`GET /api/tools` returns at least `kumiho_memory_engage`, `kumiho_memory_reflect`, `kumiho_memory_recall`, `kumiho_memory_consolidate`."*
- `src/onboard/wizard.rs:5910-5914` (wizard-generated `AGENTS.md`) — *"`kumiho_memory_engage` — retrieve relevant memories by query… `kumiho_memory_reflect` — save durable decisions… `kumiho_memory_store` — directly store a memory item… `kumiho_memory_recall` — directly recall memory items"*.

**Actual:** Construct's installer ships a sidecar venv that does not contain the package which registers most of those tools.

The installer line is unambiguous — `scripts/install-sidecars.sh:171`:
```sh
run "'$kumiho_py' -m pip install --quiet 'kumiho[mcp]>=0.9.20'"
```
and the Windows mirror at `scripts/install-sidecars.bat:107`:
```bat
"%K_PY%" -m pip install --quiet "kumiho[mcp]>=0.9.20"
```

The `kumiho` 0.9.24 package's own metadata (`~/.construct/kumiho/venv/lib/python3.11/site-packages/kumiho-0.9.24.dist-info/METADATA`) declares only four extras — `dev`, `docs`, `mcp`, `all` — and `all == kumiho[dev,docs,mcp]`. None of them pull in `kumiho_memory`. So `pip install 'kumiho[mcp]'` lands `kumiho` and nothing else memory-related.

What the bare `kumiho` package registers is partial. `kumiho/mcp_server.py:1845-2852` lists 45 tool names; only two of them are memory-typed:
- `kumiho_memory_store` at `mcp_server.py:2006` (registration), `:2896` (dispatch).
- `kumiho_memory_retrieve` at `mcp_server.py:2073` (registration). Note the name is `_retrieve`, not `_recall`.

The high-level memory tool set lives in a *separate* package, `kumiho_memory`. Where it is installed (`~/.kumiho/venv/lib/python3.11/site-packages/kumiho_memory/mcp_tools.py`), it registers:
- `kumiho_memory_ingest` (line 555)
- `kumiho_memory_add_response` (line 601)
- `kumiho_memory_consolidate` (line 622)
- **`kumiho_memory_recall`** (line 641)
- `kumiho_memory_discover_edges` (line 701)
- `kumiho_memory_store_execution` (line 763)
- **`kumiho_memory_engage`** (line 821)
- **`kumiho_memory_reflect`** (line 882)
- `kumiho_memory_dream_state` (line 975)

`kumiho.mcp_server` *does* know how to graft those in — `mcp_server.py:3079-3090`:
```python
# Auto-discover kumiho-memory tools if installed
try:
    from kumiho_memory.mcp_tools import MEMORY_TOOLS, MEMORY_TOOL_HANDLERS  # type: ignore
    TOOLS.extend(MEMORY_TOOLS)
    TOOL_HANDLERS.update(MEMORY_TOOL_HANDLERS)
except ImportError:
    pass
```

But that branch only fires when `kumiho_memory` is importable. On a default Construct install — produced by `install.sh` calling `install-sidecars.sh` — it isn't. `pip list` inside `~/.construct/kumiho/venv/` returns exactly one Kumiho-prefixed entry: `kumiho 0.9.24`. The `try/except ImportError: pass` branch swallows the failure silently, so the sidecar starts cleanly, the MCP tool list is shorter than expected, and nothing in the daemon log surfaces the discrepancy at startup.

**Net effect:** when an agent on a stock Construct install is told by `KUMIHO_BOOTSTRAP_PROMPT` to call `kumiho_memory_engage`, the tool is not registered. The MCP dispatcher returns "tool not found"; the agent sees a tool error; the runtime "degrades gracefully to stateless operation" exactly as `src/agent/kumiho.rs:19-21` warns — but the *prompt is still mandating engage on every turn*. This is the operational form of row 1's Aspirational gap.

**Why this classification:** Aspirational, high. The prompt commits to a tool surface the installer makes unreachable. Of the four tool names the wizard advertises at `wizard.rs:5910-5914`:
- `kumiho_memory_store` — **real and reachable** today (`kumiho/mcp_server.py:2006`).
- `kumiho_memory_engage`, `kumiho_memory_reflect`, `kumiho_memory_recall` — **real but unreachable on a stock Construct install**; live in `kumiho_memory/mcp_tools.py:641,821,882`, package not installed by `scripts/install-sidecars.sh`.

Note the name drift inside the installed `kumiho` package: it ships `kumiho_memory_retrieve` (`mcp_server.py:2073`) where the wizard prose says `kumiho_memory_recall`. So even if Construct rewires the prompt around what *is* installed today, the wizard's `kumiho_memory_recall` line at `wizard.rs:5914` is still wrong on stock Construct (the closest reachable primitive is `kumiho_memory_retrieve`).

**Remediation:** rewrite-both, two-sided.
1. *Code change* — extend `scripts/install-sidecars.sh:171` and `scripts/install-sidecars.bat:107` to also install `kumiho_memory` (e.g. `pip install 'kumiho[mcp]>=0.9.20' 'kumiho_memory>=0.5.0'`). Alternative: add a `[memory]` extra to the `kumiho` package and have Construct request `kumiho[mcp,memory]` once that ships. Either path makes the auto-discovery branch at `kumiho/mcp_server.py:3081-3083` succeed.
2. *Prompt change* — gate the `KUMIHO_BOOTSTRAP_PROMPT` engage/reflect/recall/consolidate mandates on detected tool availability. Easiest path: have `inject_kumiho` (`src/agent/kumiho.rs:316-374`) probe the Kumiho MCP after start-up for the high-level tool names and feed a `kumiho_memory_advanced_available: bool` into `PromptContext`; `KumihoBootstrapSection::build` strips engage/reflect blocks when false. This pairs naturally with row 1's connectivity gate.
3. *Wizard correction* — in the same Phase 0-2 pass, fix the `wizard.rs:5914` `kumiho_memory_recall` line to match whichever name (`_recall` vs `_retrieve`) the post-fix Construct install actually exposes.

Until both 1 and 2 land, Phase 0-2 should at minimum make the discrepancy *loud*: emit a daemon warning when `inject_kumiho` lands the sidecar but `kumiho_memory` is not importable, so the gap is visible in `~/.construct/logs/` instead of silently failing each agent turn.

### Row 14 — Cron `tz` field — partially documented (Orphan, low, config-follows-code)
**Claim:** runtime supports IANA timezones per cron job. `src/cron/types.rs:92-97`:
```rust
pub enum Schedule {
    Cron {
        expr: String,
        #[serde(default)]
        tz: Option<String>,
    },
    …
}
```
Deserialisation tests at `src/cron/types.rs:210-218` confirm IANA strings round-trip. `src/tools/cron_add.rs` exposes the field at the tool surface.

**Actual:** documentation is partial:
- ✓ The CLI command list mentions the flag once: `docs/reference/cli/commands-reference.md:144`:
  ```
  - `construct cron add <expr> [--tz <IANA_TZ>] <command>`
  ```
- ✗ `docs/reference/api/config-reference.md` has no TZ description in the `[cron]` block.
- ✗ `docs/reference/cli/commands-reference.md` does not document the default behaviour when `--tz` is omitted (UTC) or which IANA-string formats are accepted/rejected.
- ✗ The other `cron` subcommands (`add-at`, `add-every`, `once`) don't document whether they honour an inherited or implicit timezone.

**Why this classification:** Orphan with a partial doc trail. v1 incorrectly claimed *no* TZ docs anywhere; reviewer caught the CLI flag mention. This row is now narrower: document the default-UTC behaviour, the per-job semantics, and add a `[cron]`-section line to `config-reference.md`. Severity dropped from medium to low.

### Row 15 — Cloudflared tunnel undocumented (Orphan, medium, config-follows-code)
**Claim:** `src/tunnel/cloudflare.rs` runs `cloudflared --token <token> --url http://localhost:<port>` and parses the public URL from stderr. `src/config/schema.rs` defines a `TunnelConfig`.
**Actual:** `docs/reference/api/config-reference.md` has no `[tunnel]` section.
**Why this classification:** Orphan. Document.

### Row 16 — Browser/web_fetch Firecrawl fallback omitted from manifest (Orphan, low, config-follows-code)
**Claim:** `src/tools/web_fetch.rs:268-274` includes "Falls back to Firecrawl for JS-heavy/bot-blocked sites (if enabled)" in its `description()`:
```rust
fn description(&self) -> &str {
    "Fetch a web page and return its content as clean plain text. \
     HTML pages are automatically converted to readable text. \
     JSON and plain text responses are returned as-is. \
     Only GET requests; follows redirects. \
     Falls back to Firecrawl for JS-heavy/bot-blocked sites (if enabled). \
     Security: allowlist-only domains, no local/private hosts."
}
```
**Actual:** `tool_descriptions/en.toml:59` (and the 30 locale variants) carry only the older blurb without the Firecrawl mention.
**Why this classification:** Orphan — the implementation surfaced a capability that the manifest doesn't advertise. v1's citation (`web_fetch.rs:185-187`) was wrong; corrected. Update the manifest blurb across locales (or, better, retire the locale TOMLs in favour of a single `tool.description()` source of truth).

### Row 17 — Risk-level command classification (Orphan, medium, config-follows-code)
**Claim:** `docs/reference/api/config-reference.md:486-487`:
```
| `require_approval_for_medium_risk` | `true` | approval gate for medium-risk commands |
| `block_high_risk_commands` | `true` | hard block for high-risk commands |
```
**Actual:** the runtime has a real, code-resident classification:
- `src/security/policy.rs:22-26`: `enum CommandRiskLevel { Low, Medium, High }`.
- `src/security/policy.rs:723-770`: high-risk command basenames — `rm`, `mkfs`, `dd`, `shutdown`, `reboot`, `halt`, `poweroff`, `sudo`, `su`, `chown`, `chmod`, `useradd`, `userdel`, `usermod`, `passwd`, `mount`, `umount`, `iptables`, `ufw`, `firewall-cmd`, `curl`, `wget`, `nc`, `ncat`, `netcat`, `scp`, `ssh`, `ftp`, `telnet`, plus Windows-specific (`del`, `rmdir`, `format`, `reg`, `net`, `runas`, `icacls`, `takeown`, `powershell`, `pwsh`, `wmic`, `sc`, `netsh`).
- `src/security/policy.rs:772-781`: destructive-pattern detection (`rm -rf /`, `:(){:|:&};:`, Windows `del /s /q`, `format c:`).
- `src/security/policy.rs:783-816`: medium-risk verbs — `git commit/push/reset/clean/rebase/merge/cherry-pick/revert/branch/checkout/switch/tag`; `npm/pnpm/yarn install/add/remove/uninstall/update/publish`; `cargo add/remove/install/clean/publish`; basenames `touch`, `mkdir`, `mv`, `cp`, `ln`, plus Windows `copy`, `xcopy`, `robocopy`, `move`, `ren`, `rename`, `mklink`.

**Why this classification:** Orphan, not Phantom. v1 misclassified — the table does exist, just not in user-facing docs. Reviewer correctly pushed back. Fix is config-follows-code: publish the table (probably under `docs/security/`) referencing `src/security/policy.rs:723-816` as the source-of-truth, and link from the `[autonomy]` section of `config-reference.md`.

### Row 18 — Daemon agent loop always uses full ~1500-token Kumiho prompt (Aspirational, low, rewrite-both)
**Claim:** `src/agent/kumiho.rs:163-190` defines a compact `KUMIHO_CHANNEL_BOOTSTRAP_PROMPT` (~400 tokens) used only by `append_kumiho_channel_bootstrap` (`src/agent/kumiho.rs:430-444`); `KumihoBootstrapSection::build` (`src/agent/prompt.rs:121-132`) hardcodes the full ~1500-token variant.
**Actual:** there is no documented contract that requires non-channel agents to use the lite block — and no doc that promises the full block either. The daemon agent loop simply pays full price by default.
**Why this classification:** v1 misclassified as Phantom. Phantom requires a documented commitment that the runtime is failing to honour. Here there is none. This is at most an unrealised optimisation, so Aspirational with low severity. Optional remediation if Phase 0-2 wants to take it: add a `kumiho.prompt_mode = "full" \| "lite"` knob (or wire to existing `compact_context`) so long-running daemon sessions can opt into the lite block. If Phase 0-2 doesn't, this row can be closed without action.

### Row 19 — Channel bootstrap-files comment vs code (Drift, low, config-follows-code)
**Claim:** `src/channels/mod.rs:3760`:
```
/// 5. Bootstrap files — AGENTS, SOUL, TOOLS, IDENTITY, USER, BOOTSTRAP, MEMORY
```
**Actual:** `src/channels/mod.rs:3737` lists only 5 of those 7 in the static array; `BOOTSTRAP.md` is conditional (line 3744) and `MEMORY.md` is unconditional (line 3750). The comment reads as if all 7 are equivalent, which they aren't.
**Why this classification:** Drift between code and the comment that purports to summarise it. Trivial to fix; included because the BOOTSTRAP.md deletion in row 3 will require touching this comment anyway.

## Recommendations Summary

Grouped by remediation class, ordered by severity. This drives Phase 0-2.

### `delete` (2 — both subsumed under one workstream)
- **Row 3** (high): delete `BOOTSTRAP.md` from `PERSONALITY_FILES` (`src/agent/personality.rs:22`); remove the special-case in `src/channels/mod.rs:3743-3747`; remove the wizard write (`src/onboard/wizard.rs:6126`); remove the install.sh equivalent if any; remove or rewrite the wizard tests at `wizard.rs:6759-6917` that assert against its contents.
- **Row 9** (low): subsumed by row 3.

### `rewrite-both` (7)
- **Row 1** (high): introduce a runtime check on actual Kumiho MCP connectivity. Gate `KumihoBootstrapSection::build` on it, not just `config.kumiho.enabled`. When MCP is configured-but-disconnected, strip the engage/reflect mandates rather than emit them.
- **Row 5** (high): rewrite the `=== FIRST MESSAGE ONLY ===` block in `KUMIHO_BOOTSTRAP_PROMPT` to match Construct's actual identity loader (`personality.rs`), not Paseo's skill+revision-tag flow.
- **Row 6** (high): collapse `build_system_prompt_with_mode_and_autonomy` into the section-based `SystemPromptBuilder`. Single source of truth for prompt assembly.
- **Row 7** (low): replace the bare `PERSONALITY_FILES: &[&str]` with a typed list whose entries declare channel-eligible vs daemon-only; both `personality.rs` and `channels/mod.rs` consume the same source. Update the existing `HEARTBEAT.md`-exclusion test to enforce the daemon-only flag.
- **Row 8** (medium): cull the wizard's flat-file memory guidance per the three sub-fixes in the row narrative — drop the else-branch `AGENTS.md` Memory System; rewrite the always-printed "WRITE IT TO A FILE" block; remove (or rewrite to Kumiho conventions) the `MEMORY.md` template.
- **Row 13** (high): make the Kumiho contract honourable on a default install. Two-sided fix: (a) extend `scripts/install-sidecars.sh:171` and `scripts/install-sidecars.bat:107` to install `kumiho_memory` alongside `kumiho` (or pin a `kumiho[memory]` extra once that exists in the SDK); (b) gate `KumihoBootstrapSection::build` on detected high-level-tool availability (probe `kumiho_memory_engage` etc. after sidecar handshake). Pair with row 1's connectivity gate so a single `kumiho_memory_advanced_available: bool` in `PromptContext` drives both. Bonus: emit a daemon-log warning when the sidecar starts but the package isn't importable, so the failure stops being silent (`kumiho/mcp_server.py:3079-3090`).
- **Row 18** (low): optional. Add a `kumiho.prompt_mode` knob if Phase 0-2 wants the daemon loop to opt into the lite Kumiho block. Skip without consequence if not.

### `config-follows-code` (10)
- **Row 10** (high): rewrite `install.sh:1015-1086` to mirror the wizard's post-row-8 Kumiho-honest scaffold; drop the `Use memory_recall for recent context` line and either drop or rewrite `MEMORY.md`.
- **Row 11** (high): drop the unimplemented `memory_store/recall/forget` advertisements from `src/agent/loop_.rs:3940-3950`, `:4906-4908`, `:1102-1104`; from `src/channels/mod.rs:5356-5366`; from `docs/maintainers/repo-map.md:104`; from `docs/reference/sop/cookbook.md:59,91`; from `src/security/iam_policy.rs:230,236,339`; from `src/approval/mod.rs:350,369,634`; from `src/security/policy.rs:1540,1549,1561`; from `src/onboard/wizard.rs:7116-7118`; and from the `src/channels/mod.rs:3768` comment. The canonical replacements (where they exist) are `kumiho_memory_store` (`kumiho/mcp_server.py:2006`) and `kumiho_memory_retrieve` (`:2073`); engage/reflect/recall are only available once row 13's installer fix lands.
- **Row 12** (medium): drop the `memory_search` reference from `src/channels/mod.rs:3768` and reconsider its IAM placement at `src/security/iam_policy.rs:230,236,339`.
- **Row 14** (low): document cron `tz` semantics in `docs/reference/api/config-reference.md` `[cron]` section and add the default-UTC behaviour to `docs/reference/cli/commands-reference.md`.
- **Row 15** (medium): add a `[tunnel]` section to `docs/reference/api/config-reference.md`.
- **Row 16** (low): update `tool_descriptions/*.toml` `web_fetch` blurb across locales to mention the Firecrawl fallback (or retire the locale TOMLs in favour of `Tool::description()`).
- **Row 17** (medium): publish the command → risk-level mapping under `docs/security/`, citing `src/security/policy.rs:723-816`.
- **Row 2** (low): drop the `FoxClaw` reference comment in `operator-mcp/tests/conftest.py:15`.
- **Row 4** (low): replace `conductor` with `Operator` in `docs/contributing/kumiho-memory-integration.md:143`.
- **Row 19** (low): correct the comment in `src/channels/mod.rs:3760` (or let row 3's BOOTSTRAP.md deletion drive a clean rewrite of that whole comment block).

### `code-follows-config` (0)
- None. Every gap in this audit is the runtime being more correct than the docs/configs/scaffolds, so the docs/configs/scaffolds are what should change.

---

## Changes vs v1 (per reviewer round 1)

- **Row 7** (HEARTBEAT.md): added the test-asserted intentional-exclusion citation (`src/channels/mod.rs:8832-8838`); severity reduced from medium to low; remediation reframed as "annotate the source list" rather than "pick one canonical list".
- **Row 8** (wizard MEMORY.md): expanded to cover the wizard's `AGENTS.md` flat-file memory guidance — the else-branch Memory System block, the else-branch session_steps `memory_recall` mandate, the always-printed "WRITE IT TO A FILE" instructions, and the contradictory Kumiho-branch claim that legacy memory tools are "disabled when Kumiho is active". Three concrete sub-fixes now itemised.
- **Row 10 (was 10) — cron TZ**: corrected the false claim that no TZ docs exist anywhere; cited `docs/reference/cli/commands-reference.md:144` for the partial CLI mention; narrowed the finding to the missing `[cron]` config-section entry, default-behaviour description, and per-subcommand semantics; severity reduced from medium to low.
- **Row 12 (was 12) — Firecrawl manifest**: corrected line citation from `src/tools/web_fetch.rs:185-187` to `src/tools/web_fetch.rs:268-274`.
- **Row 13 (was 13) — risk-level classification**: reclassified from Phantom to Orphan; remediation corrected to config-follows-code; cited `src/security/policy.rs:723-770` (high), `:772-781` (destructive patterns), `:783-816` (medium) as the runtime mapping.
- **Row 14 (was 14, dropped) — `OpenClaw` attribution comment**: dropped from the audit. Reviewer correctly noted it is legitimate attribution to a separately-maintained TS project, not a coherence row.
- **Row 17 (was 15) — daemon full Kumiho prompt**: reclassified from Phantom to Aspirational; severity reduced from medium to low. No documented contract is being violated; this is an unrealised optimisation.
- **Remediation labels swept**: rows 10, 11, 12, 13, 14, 15, 16, 18 changed from `code-follows-config` (v1) to `config-follows-code` (v2). For Orphans and Phantoms where the runtime is the source of truth, the docs/configs/scaffolds are what need to change — that is `config-follows-code` per the brief's definitions. v1 had the direction backwards.
- **Row 10 (NEW) — `install.sh` workspace scaffolding**: added. The shell installer at `install.sh:1015-1086` writes a `MEMORY.md` and an `AGENTS.md` whose first instruction is `Use memory_recall for recent context` — calling a tool that has no `impl Tool`. High-severity Phantom.
- **Row 11 (NEW) — native `memory_*` tool surface**: added. Cross-referenced 13 sites (loop, channels, repo-map, cookbook, IAM policy, approval defaults, security tests, wizard test, channel comment). High-severity Phantom; the largest fan-out in the audit.
- **Row 12 (NEW) — `memory_search` Operator-MCP-vs-native conflation**: added. Comment in channels and IAM permission grant both refer to a tool that exists only on the Operator side. Medium-severity Phantom.

## Changes vs v2 (per reviewer round 2)

Reviewer round 2 asked the audit to either cite a Kumiho source proving `kumiho_memory_store` and `kumiho_memory_recall` are real Kumiho-exposed tool names (Option A), or open a new row classifying the wizard's `wizard.rs:5913-5914` claim if they're unverified (Option B). Looking for that proof exposed a deeper-than-Option-A finding, so v3 takes a hybrid path: cites the source-of-truth files for the names *and* opens a new row for the operational gap they revealed.

- **Citation added (Option A)** — `kumiho_memory_store` is real and reachable on a stock Construct install: registered at `~/.construct/kumiho/venv/lib/python3.11/site-packages/kumiho/mcp_server.py:2006` (and dispatched at `:2896`).
- **Citation added (Option A, partial)** — `kumiho_memory_recall` is real *but unreachable on a stock Construct install*. It only registers when the separate `kumiho_memory` package is importable: `~/.kumiho/venv/lib/python3.11/site-packages/kumiho_memory/mcp_tools.py:641`. The closest reachable primitive in the bare `kumiho` package is `kumiho_memory_retrieve` (`mcp_server.py:2073`) — different name.
- **Citation added (Option A, missing)** — `kumiho_memory_engage` (`kumiho_memory/mcp_tools.py:821`) and `kumiho_memory_reflect` (`:882`) are *also* in the unshipped sibling package; they are mandated by `KUMIHO_BOOTSTRAP_PROMPT` but not exposed on a stock Construct install.
- **NEW Row 13 (Option B, expanded)** — added a high-severity Aspirational row for the deeper finding: Construct's installer (`scripts/install-sidecars.sh:171`, `scripts/install-sidecars.bat:107`) installs only `kumiho[mcp]>=0.9.20`. The auto-discovery shim at `kumiho/mcp_server.py:3079-3090` swallows the `ImportError` silently, so the sidecar starts cleanly with a truncated tool registry. The whole `KUMIHO_BOOTSTRAP_PROMPT` premise is unsatisfiable on a default install today. Row 13 is the operational version of row 1; both should be remediated together.
- **Row 1 cell updated** to call out that the gate is config-only, plus the cross-reference to row 13.
- **Renumbering** — old rows 13-18 are now rows 14-19. Total row count: 18 → 19. Remediation totals: rewrite-both 6 → 7; everything else unchanged. Severity totals: high 6 → 7; everything else unchanged.

**End of audit.** Phase 0-2 should pick up the `delete` and high-severity items first (rows 1, 3, 5, 6, 10, 11, 13); the orphans (rows 14, 15, 16, 17) are documentation debt that can ride the same PR train without blocking. **Row 13 should be sequenced together with row 1** — the prompt-builder gate and the installer extension are two halves of the same fix; landing only one leaves the contract still aspirational on stock installs.
