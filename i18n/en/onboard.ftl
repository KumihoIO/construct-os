# Construct onboard wizard — English source bundle.
#
# Keys are kebab-case grouped by surface area. Args use {$name} placeholders.
# When you add a new key here, mirror it in i18n/ko/onboard.ftl (or whatever
# language bundle you're authoring) so missing strings don't silently fall
# back to English in production.
#
# This is the Phase 1 surface: banner, step headers, primary prompts at
# each step, provider/memory backend selection, and the final "Next steps"
# block. Per-provider deep instructions and per-channel walkthroughs are
# scheduled for a follow-up PR.

## ── Banner / welcome ─────────────────────────────────────────────

welcome-title = Welcome to the Construct.
welcome-subtitle = This wizard will configure your agent in under 60 seconds.

## ── Language picker (Step 0) ─────────────────────────────────────

step-language-prompt = Select your language / 언어를 선택하세요
step-language-saved = Language set to {$lang}.

## ── Step header (used at the top of every step) ──────────────────

step-header = Step {$num}/{$total}: {$title}

step-1-title = Workspace Setup
step-2-title = AI Provider & API Key
step-3-title = Channels (How You Talk to Construct)
step-4-title = Tunnel (Expose to Internet)
step-5-title = Tool Mode & Security
step-6-title = Hardware (Physical World)
step-7-title = Memory Configuration
step-8-title = Project Context (Personalize Your Agent)
step-9-title = Workspace Files

## ── Step 1: Workspace ────────────────────────────────────────────

workspace-default-location = Default location: {$path}
workspace-use-default = Use default workspace location?
workspace-enter-path = Enter workspace path
workspace-confirmed = ✓ Workspace: {$path}

## ── Step 2: Provider ─────────────────────────────────────────────

provider-select-tier = Select provider category
provider-tier-recommended = Recommended (Anthropic, OpenAI, Google)
provider-tier-fast = Fast / Low-cost (Groq, Cerebras, OpenRouter)
provider-tier-gateway = Gateway / Multi-provider (OpenRouter, LiteLLM)
provider-tier-specialized = Specialized (Cohere, Mistral, Together)
provider-tier-local = Local (Ollama, llama.cpp, LM Studio, vLLM, SGLang)
provider-tier-custom = Custom (OpenAI-compatible endpoint)

provider-select = Select your AI provider
provider-api-key-prompt = Paste your API key (or press Enter to skip)
provider-api-base-prompt = API base URL (e.g. http://localhost:1234 — where Construct sends LLM requests)
provider-api-key-optional = API key (or Enter to skip if not needed)
provider-model-name = Model name (e.g. llama3, gpt-4o, mistral)
provider-select-model = Select your default model
provider-enter-custom-model = Enter custom model ID

## ── Step 3: Channels ─────────────────────────────────────────────

channels-prompt = Connect a channel (or Done to continue)

## ── Step 4: Tunnel ───────────────────────────────────────────────

tunnel-select = Select tunnel provider

## ── Step 5: Tool mode & secrets ──────────────────────────────────

tool-mode-select = Select tool mode
secrets-encrypt = Enable encrypted secret storage?

## ── Step 6: Hardware ─────────────────────────────────────────────

hardware-prompt = How should Construct interact with the physical world?

## ── Step 7: Memory ───────────────────────────────────────────────

memory-select = Select memory backend
memory-kumiho-api-url = Kumiho API URL
memory-kumiho-token = Kumiho service token (KUMIHO_SERVICE_TOKEN)
memory-auto-save = Auto-save conversations to memory?

dreamstate-prompt = Set up nightly DreamState memory consolidation? (recommended)
dreamstate-time-prompt = What time should DreamState run?
dreamstate-cron-created = ✓ DreamState cron job created (schedule: {$time}, next run: {$next})
dreamstate-cron-failed = Could not register DreamState cron job: {$err}

## ── Step 8: Project context ──────────────────────────────────────

ctx-your-name = Your name
ctx-timezone = Your timezone
ctx-timezone-enter = Enter timezone (e.g. America/New_York)
ctx-agent-name = Agent name
ctx-comm-style = Communication style
ctx-comm-style-custom = Custom communication style

## ── Existing-config handling ─────────────────────────────────────

existing-config-found = Existing config found at {$path}. Select setup mode
existing-config-detected-force = ! Existing config detected at {$path}. Proceeding because --force was provided.
existing-config-overwrite-prompt = Existing config found at {$path}. Re-running onboarding will overwrite config.toml. Continue?

setup-mode-full = Full onboarding (overwrite config.toml)
setup-mode-update-provider = Update AI provider/model/API key only
setup-mode-cancel = Cancel

## ── Reinit flow (--reinit) ───────────────────────────────────────

reinit-banner = ⚠️  Reinitializing Construct configuration...
reinit-current-dir = Current config directory: {$path}
reinit-backup-target = This will back up your existing config to: {$path}
reinit-confirm = Continue? [y/N]
reinit-aborted = Aborted.
reinit-backup-ok = Backup created successfully.
reinit-fresh-start = Starting fresh initialization...

## ── Final "Next steps" block ─────────────────────────────────────

next-steps-header = Next steps:
next-step-chat = Start chatting with your agent:
next-step-chat-cmd = construct agent
next-step-gateway = Run the gateway (channels, dashboard):
next-step-gateway-cmd = construct gateway start
next-step-status = Check status anytime:
next-step-status-cmd = construct status
next-step-pairing-enabled = Pairing is enabled. A one-time pairing code will be displayed when the gateway starts.
next-step-dashboard = Dashboard: http://127.0.0.1:{$port}

## ── Errors / misc ────────────────────────────────────────────────

err-no-command = No command provided.
err-try-onboard = Try `construct onboard` to initialize your workspace.
