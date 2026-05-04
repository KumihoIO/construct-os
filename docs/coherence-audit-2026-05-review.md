# Audit Review — Phase 0-1
**Latest Verdict:** PASS
**Latest Reviewed by:** codex/gpt-5.5 (read-only)
**Latest Reviewed at:** 2026-05-04T10:44:05+09:00

## Round 3
**Verdict:** PASS
**Reviewed by:** codex/gpt-5.5 (read-only)
**Reviewed at:** 2026-05-04T10:44:05+09:00

### Summary
The Round 2 outstanding item is resolved. I re-read the v3 audit, verified it now has 19 rows, checked the new Kumiho package evidence against the local sidecar venvs, and confirmed row numbering is consistent between the table and the narrative sections. The new Row 13 is well-founded and correctly classified as Aspirational/high/rewrite-both: Construct's prompt and docs require high-level Kumiho memory tools, but the stock sidecar installer installs only `kumiho[mcp]`, not the separate `kumiho_memory` package that registers `engage` / `reflect` / `recall` / `consolidate`.

This is now a PASS for Phase 0-1. The audit is rigorous enough to gate Phase 0-2, and the remaining concerns are sequencing guidance for remediation rather than audit defects.

### New Evidence
#### `kumiho_memory_store` Reachable
- **Audit claim:** `kumiho_memory_store` is registered in the Construct sidecar venv at `~/.construct/kumiho/venv/lib/python3.11/site-packages/kumiho/mcp_server.py:2006` and dispatched at `:2896`.
- **Verified content:**
  ```python
  # ~/.construct/kumiho/venv/.../kumiho/mcp_server.py:2004-2007
  # Memory operations (production)
  {
      "name": "kumiho_memory_store",
      "description": "Store a memory entry with one call ...
  ```
  ```python
  # ~/.construct/kumiho/venv/.../kumiho/mcp_server.py:2896-2899
  "kumiho_memory_store": lambda args: tool_memory_store(
      args.get("project", "CognitiveMemory"),
      args.get("space_path", ""),
  ```
- **Assessment:** Holds up.

#### `kumiho_memory_recall` Real But Not Stock-Reachable
- **Audit claim:** `kumiho_memory_recall` exists in the separate `kumiho_memory` package at `~/.kumiho/venv/lib/python3.11/site-packages/kumiho_memory/mcp_tools.py:641`; the stock Construct `kumiho` package has `kumiho_memory_retrieve` at `mcp_server.py:2073` instead.
- **Verified content:**
  ```python
  # ~/.kumiho/venv/.../kumiho_memory/mcp_tools.py:641-645
  "name": "kumiho_memory_recall",
  "description": (
      "Search long-term memories by semantic query. Returns matching "
      "memories from the Kumiho graph ...
  ```
  ```python
  # ~/.construct/kumiho/venv/.../kumiho/mcp_server.py:2073-2074
  "name": "kumiho_memory_retrieve",
  "description": "Retrieve memory using Google-like fuzzy search ...
  ```
- **Assessment:** Holds up. The name mismatch matters for Phase 0-2: `memory_recall -> kumiho_memory_recall` is only safe after Row 13's install fix.

#### High-level Kumiho Tools
- **Audit claim:** `kumiho_memory_consolidate`, `engage`, `reflect`, and `dream_state` are registered in `kumiho_memory/mcp_tools.py`.
- **Verified content:**
  ```python
  # ~/.kumiho/venv/.../kumiho_memory/mcp_tools.py
  622: "name": "kumiho_memory_consolidate",
  821: "name": "kumiho_memory_engage",
  882: "name": "kumiho_memory_reflect",
  975: "name": "kumiho_memory_dream_state",
  ```
- **Assessment:** Holds up.

#### Stock Installer Gap
- **Audit claim:** Construct's stock sidecar install only installs `kumiho[mcp]>=0.9.20`, and that extra does not include `kumiho_memory`.
- **Verified content:**
  ```sh
  # scripts/install-sidecars.sh:171
  run "'$kumiho_py' -m pip install --quiet 'kumiho[mcp]>=0.9.20'"
  ```
  ```bat
  :: scripts/install-sidecars.bat:107
  "%K_PY%" -m pip install --quiet "kumiho[mcp]>=0.9.20"
  ```
  ```text
  # ~/.construct/kumiho/venv/.../kumiho-0.9.24.dist-info/METADATA
  Provides-Extra: dev
  Provides-Extra: docs
  Provides-Extra: mcp
  Provides-Extra: all
  ```
  ```text
  /Users/neo/.construct/kumiho/venv/bin/python import check:
  ModuleNotFoundError No module named 'kumiho_memory'
  pip list: kumiho 0.9.24
  ```
- **Assessment:** Holds up. The default Construct sidecar venv lacks `kumiho_memory`.

#### Auto-discovery Shim
- **Audit claim:** `kumiho.mcp_server` silently skips the high-level tool set when `kumiho_memory` is missing.
- **Verified content:**
  ```python
  # ~/.construct/kumiho/venv/.../kumiho/mcp_server.py:3079-3085
  # Auto-discover kumiho-memory tools if installed
  try:
      from kumiho_memory.mcp_tools import MEMORY_TOOLS, MEMORY_TOOL_HANDLERS
      TOOLS.extend(MEMORY_TOOLS)
      TOOL_HANDLERS.update(MEMORY_TOOL_HANDLERS)
  except ImportError:
      pass
  ```
- **Assessment:** Holds up.

### Row 13 Classification
Agree with Aspirational/high/rewrite-both.

It is Aspirational because Construct's prompt/docs require a tool surface that exists in the ecosystem but is not reachable in the stock Construct install. It is high severity because `KUMIHO_BOOTSTRAP_PROMPT` mandates `kumiho_memory_engage` / `reflect`, so runtime trust breaks even when the sidecar itself starts cleanly. `rewrite-both` is correct because Phase 0-2 must both install/register the missing tools and gate or rewrite prompt mandates based on actual tool availability.

### Renumbering Check
The table has rows 1-19, and the narrative has matching `### Row 1` through `### Row 19` sections. Renumbering is consistent after the new Row 13 insertion:

- Old cron/firecrawl/risk/full-prompt rows are now rows 14/16/17/18.
- The table and narrative labels match for rows 1-19.
- Cross-reference from Row 1 to Row 13 is correct.
- Row 11's warning about mass-renaming `memory_recall -> kumiho_memory_recall` before Row 13 lands is correct.

### Prior Outstanding Item
Resolved. The audit now proves:

- `kumiho_memory_store` is real and reachable in the stock Construct sidecar venv.
- `kumiho_memory_recall` is real in `kumiho_memory`, but not reachable on stock install.
- The wizard's `kumiho_memory_recall` line is therefore not simply unverified; it is specifically blocked by the new Row 13 installer/package gap.

### Stretch Goal
For Phase 0-2 sequencing, fix Row 13 first or at least in the same patch as Row 1. Otherwise, cleaning up the legacy unprefixed memory tools in Row 11 could replace one Phantom surface with another by pointing docs/prompts at `kumiho_memory_recall` before the stock sidecar can actually expose it.

## Round 2 (Re-review)
**Verdict:** FAIL-fix
**Reviewed by:** codex/gpt-5.5 (read-only)
**Reviewed at:** 2026-05-04T10:28:54+09:00

### Summary
The v2 audit is materially stronger. I re-read `docs/coherence-audit-2026-05.md`, verified the 18-row table, re-spot-traced the corrected rows, and checked the three added rows 10/11/12 against source. Seven of my eight Round 1 required fixes are resolved, including the cron TZ narrowing, Firecrawl citation correction, risk classification reclass, removal of the OpenClaw row, Row 7 severity reduction with the test-backed HEARTBEAT citation, and new coverage for `install.sh`, legacy `memory_*`, and `memory_search`.

The remaining blocker is narrow but real: Round 1 asked the coder to verify whether `kumiho_memory_store` and `kumiho_memory_recall` are actually exposed by the installed Kumiho MCP server before leaving the wizard-generated tool list untouched. The v2 audit still treats those as real Kumiho tools in Row 11's narrative, but the repo evidence I found only proves `kumiho_memory_engage` / `reflect` in runtime eager-tool handling and docs; `kumiho_memory_recall` appears in a validation doc, while `kumiho_memory_store` appears only in wizard prose. Since this phase gates prompt/tool cleanup, that unverified positive claim should be fixed before PASS.

### Prior FAIL-fix Items
1. Resolved — cron TZ row now acknowledges `docs/reference/cli/commands-reference.md:144` and narrows the gap to config/detail/default-UTC docs.
2. Resolved — Firecrawl citation now points to `src/tools/web_fetch.rs:268-274`.
3. Resolved — risk-level classification is now `Orphan`, not `Phantom`, and remediation follows runtime truth.
4. Resolved — Row 7 now cites the intentional exclusion test and drops severity to low; OpenClaw attribution row was removed; full Kumiho prompt row is now Aspirational/low.
5. Resolved — new Row 10 covers `install.sh` scaffolding and its `memory_recall` mandate.
6. Resolved — Row 8 now includes wizard-generated `AGENTS.md` flat-file memory guidance, not only `MEMORY.md`.
7. Resolved — new Row 12 covers `memory_search` as Operator-MCP-only versus native references.
8. Partially resolved — the audit still does not prove `kumiho_memory_store` / `kumiho_memory_recall` are exposed by Kumiho MCP; it should either cite the Kumiho MCP source/manifest or add a row challenging the wizard's `kumiho_memory_store` / `kumiho_memory_recall` claims.

### Re-spot-traces
#### Corrected Row 7: `HEARTBEAT.md`
- **Audit's revised claim:** Channel exclusion is deliberate and tested; the remaining issue is an unannotated shared file list / maintenance hazard.
- **Actual file content:**
  ```rust
  // src/channels/mod.rs:8832-8838
  // HEARTBEAT.md is intentionally excluded from channel prompts — it's only
  // relevant to the heartbeat worker and causes LLMs to emit spurious
  // "HEARTBEAT_OK" acknowledgments in channel conversations.
  assert!(
      !prompt.contains("### HEARTBEAT.md"),
      "HEARTBEAT.md should not be in channel prompt"
  );
  ```
- **Reviewer assessment:** Agree. Keeping the row is defensible as low-severity Drift because the current behavior is correct but maintained through parallel lists.

#### Corrected Row 8: Wizard Flat-file Memory
- **Audit's revised claim:** `MEMORY.md` and generated `AGENTS.md` both describe a flat-file daily-memory model.
- **Actual file content:**
  ```rust
  // src/onboard/wizard.rs:5921-5924
  You wake up fresh each session. These files ARE your continuity:
  - **Daily notes:** `memory/YYYY-MM-DD.md` — raw logs (accessed via memory tools)
  - **Long-term:** `MEMORY.md` — curated memories (auto-injected in main session)
  ```
  ```rust
  // src/onboard/wizard.rs:5951-5955
  ### Write It Down — No Mental Notes!
  - Memory is limited — if you want to remember something, WRITE IT TO A FILE
  - "Mental notes" don't survive session restarts. Files do.
  - When someone says "remember this" -> update daily file or MEMORY.md
  ```
- **Reviewer assessment:** Agree. This addresses the Round 1 missed wizard `AGENTS.md` surface.

#### New Row 10: `install.sh` Scaffolding
- **Audit's claim:** Installer writes prompt-injected flat-file memory scaffolding and mandates `memory_recall`.
- **Actual file content:**
  ```bash
  # install.sh:1061-1074
  _write_if_missing "$workspace_dir/MEMORY.md" \
  "# MEMORY.md — Long-Term Memory
  ...
  ## Open Loops
  (Track unfinished tasks and follow-ups here)"
  ```
  ```bash
  # install.sh:1076-1085
  _write_if_missing "$workspace_dir/AGENTS.md" \
  "# AGENTS.md — ${agent_name} Personal Assistant
  ...
  3. Use memory_recall for recent context
  ```
- **Reviewer assessment:** Agree. This is a high-severity Phantom prompt surface if `memory_recall` is not implemented as a native tool.

#### New Row 11: Unimplemented Native `memory_*` Tools
- **Audit's claim:** `memory_store` / `memory_recall` / `memory_forget` are advertised as tools but have no native `impl Tool`.
- **Actual file content:**
  ```rust
  // src/agent/loop_.rs:3940-3949
  ("memory_store", "Save to memory. ..."),
  ("memory_recall", "Search memory. ..."),
  ("memory_forget", "Delete a memory entry. ..."),
  ```
  ```rust
  // src/channels/mod.rs:5356-5365
  ("memory_store", "Save to memory. ..."),
  ("memory_recall", "Search memory. ..."),
  ("memory_forget", "Delete a memory entry. ..."),
  ```
  ```text
  rg "impl Tool for.*Memory|MemoryRecallTool|MemoryStoreTool|MemoryForgetTool" src/tools src/memory
  src/tools/hardware_memory_read.rs:33:impl Tool for HardwareMemoryReadTool
  src/tools/hardware_memory_map.rs:54:impl Tool for HardwareMemoryMapTool
  ```
- **Reviewer assessment:** Agree on the native-tool Phantom classification. The negative search only finds hardware memory tools, not the advertised memory store/recall/forget tools.

#### New Row 12: `memory_search`
- **Audit's claim:** `memory_search` is referenced as native/channel-visible but only implemented in Operator MCP.
- **Actual file content:**
  ```rust
  // src/channels/mod.rs:3767-3768
  /// Daily memory files (`memory/*.md`) are NOT injected — they are accessed
  /// on-demand via `memory_recall` / `memory_search` tools.
  ```
  ```python
  # operator-mcp/operator_mcp/operator_mcp.py:2094-2099
  Tool(
      name="memory_search",
      description=(
          "Structured search by name/kind/context. Use for exact-match lookups when you "
  ```
  ```python
  # operator-mcp/operator_mcp/operator_mcp.py:2532-2534
  if name == "memory_search":
      from .tool_handlers.memory import tool_memory_search_op
      return await tool_memory_search_op(args)
  ```
- **Reviewer assessment:** Agree. The citation holds and the native-vs-Operator scope distinction is important.

#### Corrected Row 13: Cron TZ
- **Reviewer assessment:** Agree. `src/cron/types.rs:92-97` has `tz: Option<String>` and `docs/reference/cli/commands-reference.md:144` already lists `--tz <IANA_TZ>`, so the revised partial-doc Orphan is accurate.

#### Corrected Row 15: Firecrawl
- **Reviewer assessment:** Agree. `src/tools/web_fetch.rs:268-274` includes Firecrawl fallback in `description()`, while `tool_descriptions/en.toml:59` omits it.

#### Corrected Row 16: Risk Classification
- **Reviewer assessment:** Agree. `src/security/policy.rs:723-816` contains concrete high/medium mapping, so Orphan/config-follows-code is correct.

#### Corrected Row 17: Full Kumiho Prompt
- **Reviewer assessment:** Agree. Reclassifying to Aspirational/low is appropriate because no documented contract requires lite mode for daemon agents.

### Push-back Assessment
- Row 11/12 as `Phantom`: Agree. The brief's classification guidance says references to non-existent tools are Phantom. For Row 11, unprefixed native `memory_store` / `memory_recall` / `memory_forget` are advertised but lack native `impl Tool`; for Row 12, `memory_search` exists only in Operator MCP, not in the native channel/tool surface being referenced.
- Row 7 retained: Agree. The row should stay because two consumers maintain divergent file lists. The coder correctly reduced severity and cited the test proving current channel behavior is intentional.

### Outstanding Fix
1. Verify the Kumiho MCP tool manifest/source for `kumiho_memory_store` and `kumiho_memory_recall`, or add a row challenging `src/onboard/wizard.rs:5913-5914`. Repo search currently does not prove those tools exist in the installed Kumiho MCP server; it only shows wizard prose plus docs for `kumiho_memory_recall`.

## Round 1 (FAIL-fix)
# Audit Review — Phase 0-1
**Verdict:** FAIL-fix
**Reviewed by:** codex/gpt-5.5 (read-only)
**Reviewed at:** 2026-05-04T10:14:02+09:00

## Summary
The audit is directionally useful and it does include the three required seed rows: the Kumiho memory contract, the `FoxClaw` residue, and `BOOTSTRAP.md` with remediation `delete`. I inspected all 16 table rows against the cited files. Most high-impact prompt/runtime findings are real, especially the Kumiho prompt/tool-connectivity mismatch, the stale first-turn Paseo instructions, `BOOTSTRAP.md`, and the dual prompt-builder split.

This is not a PASS. Several claims are over-stated or misclassified, and at least three prompt-injected scaffolding surfaces were missed. The most important missed area is `install.sh`: it creates workspace `AGENTS.md` and `MEMORY.md` files that are later injected into prompts, and the generated `AGENTS.md` still mandates `memory_recall`. The wizard's generated `AGENTS.md` also contains broader flat-file memory instructions than row 8 captures.

Verdict is FAIL-fix, not FAIL-rescope. The audit's basic approach is sound: enumerate prompt/config/doc surfaces and compare them to runtime truth. The coder needs to revise the table and recommendations before Phase 0-2 uses it as the remediation source.

## Coverage check
- ✓ Row 1 — Kumiho memory contract | Cited files exist; prompt mandates `kumiho_memory_engage` / `kumiho_memory_reflect`; gate is config-only.
- ✓ Row 2 — `FoxClaw` rebrand residue | Cited file exists and contains the legacy `FoxClaw` comment; default harness project is `Construct`.
- ✓ Row 3 — `BOOTSTRAP.md` auto-loaded as runtime authority | Cited files exist; `BOOTSTRAP.md` is in `PERSONALITY_FILES` and channel prompt injection.
- ✓ Row 4 — `conductor` residue | Cited doc cell exists and says "Plans the conductor decomposed for a project."
- ✓ Row 5 — First-turn Paseo skill + revision-tag flow | Cited prompt lines exist; repo search did not show Construct implementations for those exact surfaces.
- ✓ Row 6 — Two parallel system-prompt builders | Both cited builders exist and have materially different section order/file loading.
- ✓ Row 7 — `HEARTBEAT.md` mismatch | Cited lists exist; channel path omits `HEARTBEAT.md`. Classification/severity needs nuance because tests state this exclusion is intentional.
- ✓ Row 8 — Wizard `MEMORY.md` flat-file model | Cited wizard template and `NoneMemory` source exist; finding is real but too narrow.
- ✓ Row 9 — Wizard `BOOTSTRAP.md` self-deleting prose | Cited wizard text exists and conflicts with repeated prompt injection.
- ✗ Row 10 — Cron timezone field undocumented | Runtime field exists, but the audit's claim that CLI docs mention nothing is false: `docs/reference/cli/commands-reference.md:144` documents `--tz <IANA_TZ>`.
- ✓ Row 11 — Cloudflared tunnel undocumented | Runtime tunnel config and implementation exist; config reference has no `[tunnel]` section.
- ✗ Row 12 — Firecrawl fallback omitted from manifest | Substance is real, but the cited line is wrong: `web_fetch` description is at `src/tools/web_fetch.rs:268-274`, not `185-187`.
- ✓ Row 13 — Risk-level command classification | Cited docs and runtime mapping exist; classification is wrong.
- ✓ Row 14 — `OpenClaw` attribution comment | Cited comment exists; classification as Drift is weak because the audit itself says it is legitimate attribution.
- ✓ Row 15 — Full Kumiho prompt for non-channel agents | Cited full/lite prompt paths exist; classification as Phantom is weak without a documented contract that non-channel agents should use lite mode.
- ✓ Row 16 — Channel bootstrap-files comment vs code | Cited comment and code exist.

## Spot-traces (≥5)
### Row 1: Kumiho memory contract
- **Audit's claim:** "Gate is `config.kumiho.enabled` only, not actual MCP connectivity."
- **Actual file content:**
  ```rust
  // src/agent/prompt.rs:126-130
  if !ctx.kumiho_enabled {
      return Ok(String::new());
  }
  Ok(crate::agent::kumiho::KUMIHO_BOOTSTRAP_PROMPT.to_string())
  ```
  ```rust
  // src/agent/kumiho.rs:19-21
  //! Injection is **non-fatal**: if the script path does not exist at runtime the
  //! MCP registry will simply log an error and continue — the agent degrades
  //! gracefully to stateless operation.
  ```
- **Audit's classification:** Aspirational
- **Reviewer assessment:** Agree. Runtime can degrade to stateless while the prompt still mandates Kumiho tool usage.

### Row 3: `BOOTSTRAP.md`
- **Audit's claim:** "`BOOTSTRAP.md` auto-loaded as runtime authority" and remediation must be `delete`.
- **Actual file content:**
  ```rust
  // src/agent/personality.rs:15-23
  const PERSONALITY_FILES: &[&str] = &[
      "SOUL.md", "IDENTITY.md", "USER.md", "AGENTS.md",
      "TOOLS.md", "HEARTBEAT.md", "BOOTSTRAP.md", "MEMORY.md",
  ];
  ```
  ```rust
  // src/channels/mod.rs:3743-3747
  // BOOTSTRAP.md — only if it exists (first-run ritual)
  let bootstrap_path = workspace_dir.join("BOOTSTRAP.md");
  if bootstrap_path.exists() {
      inject_workspace_file(prompt, workspace_dir, "BOOTSTRAP.md", max_chars_per_file);
  }
  ```
- **Audit's classification:** Phantom
- **Reviewer assessment:** Agree. Required seed row is present and handled with `delete`.

### Row 5: First-turn Paseo skill + revision-tag flow
- **Audit's claim:** The first-turn block references non-existent Construct surfaces.
- **Actual file content:**
  ```rust
  // src/agent/kumiho.rs:45-46
  - Do NOT invoke the kumiho-memory skill.
  - Do NOT call kumiho_get_revision_by_tag.  Identity is already loaded.
  ```
  ```rust
  // src/agent/kumiho.rs:90-92
  === FIRST MESSAGE ONLY ===
  Skip this block on all subsequent messages.
    1. Invoke the kumiho-memory:kumiho-memory skill.
  ```
- **Audit's classification:** Phantom
- **Reviewer assessment:** Agree. A reference to a non-existent tool/skill flow is Phantom, not Drift.

### Row 7: `HEARTBEAT.md`
- **Audit's claim:** "`HEARTBEAT.md` is never injected by the channel path — only the agent loop's `SystemPromptBuilder` honours it."
- **Actual file content:**
  ```rust
  // src/agent/personality.rs:20-23
  "TOOLS.md",
  "HEARTBEAT.md",
  "BOOTSTRAP.md",
  "MEMORY.md",
  ```
  ```rust
  // src/channels/mod.rs:3737
  let bootstrap_files = ["AGENTS.md", "SOUL.md", "TOOLS.md", "IDENTITY.md", "USER.md"];
  ```
  ```rust
  // src/channels/mod.rs:8832-8837
  // HEARTBEAT.md is intentionally excluded from channel prompts — it's only
  // used by the agent loop for scheduled background tasks.
  assert!(
      !prompt.contains("### HEARTBEAT.md"),
      "HEARTBEAT.md should not be in channel prompt"
  );
  ```
- **Audit's classification:** Drift
- **Reviewer assessment:** Partly agree on the observed divergence, but the audit misses the test-backed intent. The row should either explain why the intentional exclusion is still incoherent or reduce severity/remediation.

### Row 8: Wizard `MEMORY.md`
- **Audit's claim:** Wizard describes a flat-file daily-memory model that runtime does not implement.
- **Actual file content:**
  ```rust
  // src/onboard/wizard.rs:6101-6108
  ## How This Works
  - Daily files (`memory/YYYY-MM-DD.md`) capture raw events (on-demand via tools)
  - This file captures what's WORTH KEEPING long-term
  - This file is auto-injected into your system prompt each session
  - Keep it concise — every character here costs tokens
  
  ## Security
  - ONLY loaded in main session (direct chat with your human)
  - NEVER loaded in group chats or shared contexts
  ```
  ```rust
  // src/memory/mod.rs:66-69
  /// Persistent memory in Construct is handled exclusively by Kumiho MCP (injected
  /// at the agent level). The runtime `Memory` trait binding is therefore always
  /// `NoneMemory` — in-session, non-persistent.
  ```
- **Audit's classification:** Aspirational
- **Reviewer assessment:** Agree, but incomplete. The generated `AGENTS.md` in the same wizard repeats the flat-file guidance and should be its own row or explicitly included here.

### Row 10: Cron timezone field
- **Audit's claim:** Docs mention nothing about cron timezone support.
- **Actual file content:**
  ```rust
  // src/cron/types.rs:92-97
  pub enum Schedule {
      Cron {
          expr: String,
          #[serde(default)]
          tz: Option<String>,
      },
  ```
  ```markdown
  <!-- docs/reference/cli/commands-reference.md:141-145 -->
  ### `cron`
  
  - `construct cron list`
  - `construct cron add <expr> [--tz <IANA_TZ>] <command>`
  ```
- **Audit's classification:** Orphan
- **Reviewer assessment:** Disagree with the factual claim as written. There is at least CLI command documentation. A weaker row can remain for missing config/API/detail docs, but it must not say docs mention nothing.

### Row 12: Firecrawl fallback manifest
- **Audit's claim:** `web_fetch` supports Firecrawl fallback but the manifest omits it.
- **Actual file content:**
  ```rust
  // src/tools/web_fetch.rs:268-274
  fn description(&self) -> &str {
      "Fetch a web page and return its content as clean plain text. \
       HTML pages are automatically converted to readable text. \
       JSON and plain text responses are returned as-is. \
       Falls back to Firecrawl for JS-heavy/bot-blocked sites (if enabled). \
       Only GET requests; follows redirects."
  }
  ```
  ```toml
  # tool_descriptions/en.toml:59
  web_fetch = "Fetch a web page and return its content as clean plain text. HTML pages are automatically converted to readable text. JSON and plain text responses are returned as-is. Only GET requests; follows redirects. Security: allowlist-only domains, no local/private hosts."
  ```
- **Audit's classification:** Orphan
- **Reviewer assessment:** Agree on substance, but the row's source line must be corrected from `185-187` to `268-274`.

### Row 13: Risk-level command classification
- **Audit's claim:** The user-facing knobs exist, but command-to-risk semantics are undefined to users.
- **Actual file content:**
  ```markdown
  <!-- docs/reference/api/config-reference.md:486-487 -->
  | `require_approval_for_medium_risk` | `true` | approval gate for medium-risk commands |
  | `block_high_risk_commands` | `true` | hard block for high-risk commands |
  ```
  ```rust
  // src/security/policy.rs:723-731
  // High-risk commands (Unix and Windows)
  if matches!(
      base,
      "rm" | "mkfs" | "dd" | "shutdown" | "reboot" | "halt" | "poweroff"
  ```
  ```rust
  // src/security/policy.rs:783-816
  // Medium-risk commands (state-changing, but not inherently destructive)
  let medium = match base {
      "git" => args.first().is_some_and(|verb| {
          matches!(verb.as_str(), "commit" | "push" | "reset" | "clean" | "rebase" | "merge" | "cherry-pick" | "revert" | "branch" | "checkout" | "switch" | "tag")
      }),
  ```
- **Audit's classification:** Phantom
- **Reviewer assessment:** Disagree. This is not Phantom; the code has a real mapping. It is a documentation gap / orphaned runtime detail.

## Classification challenges
- Row 7 (`HEARTBEAT.md`): The divergence is real, but `src/channels/mod.rs:8832-8837` explicitly says channel exclusion is intentional. The row needs a stronger source-of-truth argument or lower severity.
- Row 10 (cron TZ): The audit's evidence is wrong because CLI docs do mention `--tz`. Keep only as partial documentation debt if config/API docs are missing.
- Row 13 (risk-level commands): Reclassify from Phantom to Orphan/doc gap. A Phantom is a reference to a non-existent surface; here the risk table exists in code.
- Row 14 (`OpenClaw` attribution): The audit says the comment is legitimate attribution, so Drift is not defensible unless the project wants all attribution comments removed. This may be informational, not a coherence row.
- Row 15 (full Kumiho prompt): Phantom is weak. The code intentionally uses full prompt for non-channel paths and lite prompt for channels. Without a documented contract requiring lite mode elsewhere, this is at most an optimization/enhancement or Aspirational config knob.
- Remediation labels are inconsistent: rows 10, 11, 12, and 13 say `code-follows-config` while their recommendation is to document runtime behavior. That reads like docs/config should follow code, not code following config.

## Missed surfaces
- `install.sh` scaffolds prompt-injected workspace files and was not audited. It writes `MEMORY.md` and an `AGENTS.md` that says `Use memory_recall for recent context` (`install.sh:1061-1086`). Since `AGENTS.md` and `MEMORY.md` are auto-loaded into prompts, this is a direct prompt surface.
- Wizard-generated `AGENTS.md` contains flat-file memory instructions beyond row 8. In the Kumiho branch it says to use Kumiho, but the same generated file later says `Memory is limited — if you want to remember something, WRITE IT TO A FILE` and `When someone says "remember this" -> update daily file or MEMORY.md` (`src/onboard/wizard.rs:5908-5918`, `5951-5955`). That conflicts with "Kumiho is the sole native memory backend."
- `src/channels/mod.rs:3767-3768` says daily memory files are accessed via `memory_recall` / `memory_search` tools. The Rust agent prompt/tool list shows `memory_store`, `memory_recall`, and `memory_forget` (`src/agent/loop_.rs:3940-3949`), not `memory_search`; `memory_search` appears as an Operator MCP tool, not a native Rust channel tool. This is at least a tool-name coherence row.
- `src/onboard/wizard.rs:5913-5914` lists `kumiho_memory_store` and `kumiho_memory_recall` as direct Kumiho tools. The audit should verify these are actually exposed by the installed Kumiho MCP server, not assume them from prose. The required seed row only covered `engage` / `reflect`.
- `docs/maintainers/repo-map.md:104`, `docs/reference/sop/cookbook.md:59`, and `docs/reference/sop/cookbook.md:91` still present `memory_store` / `memory_recall` as the Memory surface. If legacy in-session memory tools are intentionally still present, the audit should say so; if not, these are missed stale docs.

## Required fixes (if FAIL-fix)
1. Correct row 10: acknowledge CLI docs already list `--tz`; narrow the finding to missing detailed/config/API documentation or remove the row.
2. Correct row 12's source citation to `src/tools/web_fetch.rs:268-274`.
3. Reclassify row 13 from Phantom to Orphan/doc gap and fix the remediation label so it matches "document the runtime mapping."
4. Re-evaluate rows 7, 14, and 15 for severity/classification. In particular, cite the intentional `HEARTBEAT.md` channel exclusion test if keeping row 7 as medium Drift.
5. Add a row for `install.sh` workspace scaffolding, especially generated `AGENTS.md` mandating `memory_recall` and generated `MEMORY.md` as a prompt-injected flat-file memory surface.
6. Expand row 8 or add a separate row for wizard-generated `AGENTS.md` flat-file memory guidance (`WRITE IT TO A FILE`, daily file / `MEMORY.md` updates) under the Kumiho branch.
7. Add a tool-name coherence row for `memory_search` references in channel prompt comments/docs unless the coder can prove it is registered for that runtime path.
8. Verify whether `kumiho_memory_store` and `kumiho_memory_recall` are actually exposed by Kumiho MCP before leaving the wizard-generated tool list untouched.

## Required rescope (if FAIL-rescope)
N/A. The audit can be fixed in-step; the overall source-of-truth approach does not need to be replaced.
