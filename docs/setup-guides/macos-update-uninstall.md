# macOS Update and Uninstall Guide

This page documents supported update and uninstall procedures for Construct on macOS (OS X).

Last verified: **February 22, 2026**.

## 1) Check current install method

```bash
which construct
construct --version
```

Typical locations:

- Homebrew: `/opt/homebrew/bin/construct` (Apple Silicon) or `/usr/local/bin/construct` (Intel)
- Cargo/bootstrap/manual: `~/.cargo/bin/construct`

If both exist, your shell `PATH` order decides which one runs.

## 2) Update on macOS

### A) Homebrew install

```bash
brew update
brew upgrade construct
construct --version
```

### B) Clone + bootstrap install

From your local repository checkout:

```bash
git pull --ff-only
./install.sh --prefer-prebuilt
construct --version
```

If you want source-only update:

```bash
git pull --ff-only
cargo install --path . --force --locked
construct --version
```

### C) Manual prebuilt binary install

Re-run your download/install flow with the latest release asset, then verify:

```bash
construct --version
```

## 3) Uninstall on macOS

### A) Stop and remove background service first

This prevents the daemon from continuing to run after binary removal.

```bash
construct service stop || true
construct service uninstall || true
```

Service artifacts removed by `service uninstall`:

- `~/Library/LaunchAgents/com.construct.daemon.plist`

### B) Remove the binary by install method

Homebrew:

```bash
brew uninstall construct
```

Cargo/bootstrap/manual (`~/.cargo/bin/construct`):

```bash
cargo uninstall construct || true
rm -f ~/.cargo/bin/construct
```

### C) Optional: remove local runtime data

Only run this if you want a full cleanup of config, auth profiles, logs, and workspace state.

```bash
rm -rf ~/.construct
```

## 4) Verify uninstall completed

```bash
command -v construct || echo "construct binary not found"
pgrep -fl construct || echo "No running construct process"
```

If `pgrep` still finds a process, stop it manually and re-check:

```bash
pkill -f construct
```

## Related docs

- [One-Click Bootstrap](one-click-bootstrap.md)
- [Commands Reference](../reference/cli/commands-reference.md)
- [Troubleshooting](../ops/troubleshooting.md)
