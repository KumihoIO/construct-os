# Changelog

All notable changes to Construct are recorded here. Dates are ISO 8601 (UTC).
Version numbers follow CalVer (`YYYY.M.D`).

## [Unreleased] — Open-source preparation

### Rebranding & attribution

- Swept legacy `constructlabs.ai` domain references (96 URLs across 33
  files) to `kumiho.io`.
- Swapped social handles in all 30 localized READMEs to `@KumihoHQ` (X),
  `@kumihohq` (Threads, newly added), `r/KumihoIO` (Reddit). Removed
  Facebook group, TikTok, Instagram, RedNote, BuyMeACoffee, and legacy
  Discord invite links.
- Set copyright holder to **Kumiho Inc.** across `NOTICE`, `LICENSE-MIT`,
  30 localized READMEs, CLA, and trademark documents. Updated year to
  2026.
- Rewrote `docs/maintainers/trademark.md` as "Naming and Attribution"
  with an explicit no-registered-trademark status and fork-friendly
  community norms.
- Updated `CODE_OF_CONDUCT.md` enforcement contact to
  `https://x.com/KumihoHQ`.
- Replaced `Argenis` / `argenis` attribution in source + tests with
  `Kave` (wizard fixtures) and `yourname` (Telegram prompt example).

### Install experience

- Added `scripts/install-sidecars.sh` (POSIX, +x) and
  `scripts/install-sidecars.bat` (Windows) — idempotent installers for
  the Kumiho and Operator Python MCP sidecars under `~/.construct/`.
  Both preserve existing user config, `.env`, and authored launchers.
- Wired sidecar install into `install.sh` (new `--install-sidecars` /
  `--skip-sidecars` flags, auto-detect default) and `setup.bat` (new
  `:install_sidecars` label; fixed a dead-code bug where the sidecar
  block sat after an unconditional `goto :post_install` and was
  unreachable for both prebuilt and source-build paths).
- Added `docs/setup-guides/kumiho-operator-setup.md` — end-to-end guide
  for both sidecars with automated + manual paths, verification,
  troubleshooting, and config wiring. Reframes the Kumiho FastAPI as
  a control-plane HTTP endpoint discoverable via `[kumiho].api_url`
  rather than something to install locally.
- Pinned the Kumiho MCP install to `kumiho[mcp]>=0.9.20`; the `[mcp]`
  extra pulls in `mcp>=1.0.0` + `httpx>=0.27.0`, required by
  `kumiho.mcp_server`.
- Replaced the nonexistent `construct init` reference in `setup.bat`'s
  Next Steps with `construct onboard` + `construct gateway`.

### Packaging

- Renamed the crates.io package from `construct` (and the half-
  renamed `constructlabs`) to `kumiho-construct`. `[package].name`
  only — binary and lib names remain `construct`, so `construct …`
  still works at the CLI and in-repo `use construct::*` imports are
  unchanged. Verified via `cargo metadata --no-deps`.
- Updated `.github/workflows/publish-crates.yml`,
  `publish-crates-auto.yml`, and `tweet-release.yml` to reference the
  new package name and `x.com/KumihoHQ`.
- Updated `Dockerfile` stale-artifact cleanup to cover the new
  `kumiho-construct-*` fingerprint paths and
  `kumihoio_construct-*` dep filenames in addition to legacy
  `construct-*` paths.

### Documentation refresh

- Reconciled the root README against actual code: 17 dashboard routes
  (was claimed 20+; one was nonexistent), 17 Operator step types (was
  14), 26 REST API groups (was 20), 7 real-time endpoints (was 4), 27
  Additional Features bullets (was 10), 13-row Tech Stack, new 26-row
  CLI Commands table cross-referencing `docs/reference/cli/commands-reference.md`.
- Rewrote Quick Start to lead with `./install.sh` / `setup.bat`, fix
  stale prereqs (Python 3.10+ → 3.11+), and honestly frame the
  Kumiho control plane requirement.
- Rewrote Hardware & Peripherals with a tiered model — host targets
  (x86_64/arm64 Linux/macOS/Windows, incl. Pi 3/4/5) run Construct;
  embedded boards (STM32 Nucleo, Arduino, ESP32, Pico) are peripherals
  driven over serial/USB from a host, not standalone Construct
  runtimes. Running the full daemon on bare MCUs remains an explicit
  non-goal.
- Refreshed code-grounded docs: `commands-reference.md` (+ 6 missing
  subcommands), `config-reference.md` (+ `[kumiho]`, `[operator]`,
  `[clawhub]`, `[trust]`, `[verifiable_intent]` sections),
  `providers-reference.md` (+ 7 missing providers), `dashboard-dev.md`
  (fixed stale `web/src/` paths), `windows-setup.md`
  (`construct init` → `onboard`), `operations-runbook.md` (+ health /
  audit / Kumiho proxy / Operator checkpoint / RunLog signals),
  `ci-map.md` (canonical workflows table + warning the narrative
  below lists upstream filenames not present).
- Added a "status: proposal" banner to
  `docs/hardware/hardware-peripherals-design.md` marking aspirational
  sections (Wasm dynamic exec, on-device code synthesis) as target
  design, not current behavior.
- Archived `docs/maintainers/project-triage-snapshot-2026-02-18.md`
  with an explicit status banner and removed it from active
  navigation in `docs/README.md`, `docs/SUMMARY.md`, and
  `docs/maintainers/README.md`.
- Fixed ~34 broken localized-hub links pointing at non-existent
  `README.<lang>.md` files; rewrote to `i18n/<lang>/README.md`.
- Flagged 12 i18n content files (zh-CN and vi mirrors) as stale with
  an English italic notice at the top.
