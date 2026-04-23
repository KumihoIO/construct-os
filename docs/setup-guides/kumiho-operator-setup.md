# Install Kumiho & Operator Sidecars

Construct ships with defaults that expect two Python MCP (Model Context
Protocol) sidecars to be installed under `~/.construct/`:

| Sidecar | Launcher path | Config key |
|---------|---------------|------------|
| **Kumiho MCP** | `~/.construct/kumiho/run_kumiho_mcp.py` | `[kumiho].mcp_path` |
| **Operator MCP** | `~/.construct/operator_mcp/run_operator_mcp.py` | `[operator].mcp_path` |

This guide shows the supported install paths for both, what each one gives you,
and how to verify + troubleshoot.

Last verified: **2026-04-21**.

## Quick install (automated)

If you already have the `construct` binary on PATH (e.g. from `cargo install kumiho-construct` or a prior `./install.sh`):

```bash
construct install --sidecars-only
```

This is cross-platform. It materializes and runs the bundled sidecar installer script for your OS.

From a Construct source checkout (no `construct` binary needed):

```bash
# POSIX (macOS / Linux / WSL)
./scripts/install-sidecars.sh

# Windows
scripts\install-sidecars.bat
```

These scripts are **idempotent** — re-running them is safe. They only create
scaffolding under `~/.construct/`; they will never overwrite an existing
`config.toml`, `.env`, or user-authored launcher.

The same logic is invoked automatically from `./install.sh` and `setup.bat`
when a checkout contains `operator-mcp/` and the launchers are missing.
Disable with `./install.sh --skip-sidecars`.

---

## 1. Kumiho MCP Server

### What it is

Kumiho is Construct's graph-native persistent memory backend. The **Kumiho
MCP server** is a stdio MCP process that exposes memory tools
(`kumiho_memory_engage`, `kumiho_memory_reflect`, etc.) to every non-internal
agent.

The MCP server is a client of the **Kumiho control plane** — an HTTP service
(FastAPI-backed, Neo4j-backed) that you don't install locally. It's discovered
over HTTP via `[kumiho].api_url` in your `~/.construct/config.toml`. Point this
at your managed Kumiho endpoint (e.g. `https://api.kumiho.cloud`) or a
self-hosted URL; the MCP sidecar you install here is the *client stub*, not
the backend.

### Prerequisites

- Python **3.11+** on PATH.
- Network access to PyPI (the installer runs `pip install 'kumiho[mcp]>=0.9.20'`).
- A reachable Kumiho control-plane URL + service token — collected by
  `construct onboard` and written to `~/.construct/.env`. Without them the MCP
  process still starts but degrades to stateless operation.

### Install steps — automated

`./scripts/install-sidecars.sh` performs the following:

1. Creates `~/.construct/kumiho/venv/` (Python 3 virtualenv).
2. Runs `pip install 'kumiho[mcp]>=0.9.20'` into that venv. The `[mcp]` extra
   pulls in `mcp>=1.0.0` + `httpx>=0.27.0`, which `kumiho.mcp_server` requires.
3. Writes `~/.construct/kumiho/run_kumiho_mcp.py` — a thin shim that invokes
   `python -m kumiho.mcp_server` from the venv. (Equivalent to the `kumiho-mcp`
   console script that `pip` installs into the venv's `bin/`.)

If a launcher already exists it is left alone.

### Install steps — manual

```bash
mkdir -p ~/.construct/kumiho
python3 -m venv ~/.construct/kumiho/venv
~/.construct/kumiho/venv/bin/pip install --upgrade pip
~/.construct/kumiho/venv/bin/pip install "kumiho[mcp]>=0.9.20"

cat > ~/.construct/kumiho/run_kumiho_mcp.py <<'PY'
#!/usr/bin/env python3
import os, pathlib, sys
HERE = pathlib.Path(__file__).resolve().parent
VENV_PY = HERE / "venv" / "bin" / "python3"
if not VENV_PY.exists():
    VENV_PY = HERE / "venv" / "Scripts" / "python.exe"
os.execv(str(VENV_PY), [str(VENV_PY), "-m", "kumiho.mcp_server", *sys.argv[1:]])
PY
chmod +x ~/.construct/kumiho/run_kumiho_mcp.py
```

### Verification

```bash
# Package import smoke test
~/.construct/kumiho/venv/bin/python3 -c 'import kumiho; print(kumiho.__version__)'

# Launcher smoke test (close with Ctrl-D; it will print a protocol banner then wait)
~/.construct/kumiho/venv/bin/python3 -m kumiho.mcp_server --help 2>&1 | head -5

# End-to-end: let Construct's doctor verify wiring
construct doctor
```

### Troubleshooting

| Symptom | Fix |
|---------|-----|
| `construct` logs `Kumiho MCP script not found: ~/.construct/kumiho/run_kumiho_mcp.py` | Run `./scripts/install-sidecars.sh`. |
| `ModuleNotFoundError: kumiho.mcp_server` or `ModuleNotFoundError: mcp` | Upgrade with `~/.construct/kumiho/venv/bin/pip install -U 'kumiho[mcp]'` (the `[mcp]` extra is required). |
| MCP tools list is empty in dashboard | Check `~/.construct/logs/` for a stderr trail; confirm `KUMIHO_AUTH_TOKEN` and `KUMIHO_CONTROL_PLANE_URL` are set (`construct onboard` writes them to `~/.construct/.env`). |
| Kumiho control plane unreachable | Verify `[kumiho].api_url` in `~/.construct/config.toml` points at a reachable Kumiho endpoint. |

### Config wiring

`~/.construct/config.toml` (written by `construct onboard`):

```toml
[kumiho]
enabled = true
mcp_path = "~/.construct/kumiho/run_kumiho_mcp.py"
api_url = "https://api.kumiho.cloud"   # or your self-hosted URL
space_prefix = "Construct"
```

`kumiho.mcp_path` resolution priority (see `src/agent/kumiho.rs`):

1. `kumiho.mcp_path` from config if non-empty.
2. `~/.construct/kumiho/run_kumiho_mcp.py` (the default install location).

---

## 2. Operator MCP Server

### What it is

The **Operator** is Construct's Python MCP server for multi-agent workflow
orchestration. It exposes ~89 MCP tools — agent lifecycle, workflow execution,
team coordination, patterns (refinement, map-reduce, supervisor, group-chat,
handoff). Source lives in-repo at `operator-mcp/`.

### Prerequisites

- Python **3.11+** on PATH.
- `make` (POSIX, for the canonical install path). The Windows/.bat variant
  skips `make` and uses a minimal rsync-equivalent.
- Optional: Node.js 18+ if you want the live-execution session manager
  sidecar. The Operator runs without it but no live DAG overlay events are
  relayed.

### Install steps — automated

`./scripts/install-sidecars.sh` performs the following (POSIX):

1. If `make` is available: `cd operator-mcp && make install` — the canonical
   install target. This creates `~/.construct/operator_mcp/venv/`, `pip
   install`s the `construct-operator[all]` package, rsyncs the package tree to
   `~/.construct/operator_mcp/`, builds + installs the Node.js session-manager
   sidecar, copies orchestration skills to `~/.construct/skills/`, and places
   the bootstrap launcher at `~/.construct/operator_mcp/run_operator_mcp.py`.
2. If `make` is missing: falls back to a minimal `python3 -m venv`, `pip
   install operator-mcp/[all]`, `rsync operator_mcp/ ~/.construct/operator_mcp/`,
   and `cp run_operator_mcp.py`.

Windows (`install-sidecars.bat`) always takes the fallback path using
`robocopy` in place of `rsync`.

### Install steps — manual

```bash
cd operator-mcp
make install
```

That's it — the Makefile is the canonical deployment. See
[operator-mcp/README.md](../../operator-mcp/README.md) for component details.

### Verification

```bash
# Package installed in the operator venv
~/.construct/operator_mcp/venv/bin/python3 -c 'import operator_mcp; print("ok")'

# Launcher smoke test — prints an MCP handshake banner then exits on Ctrl-D
~/.construct/operator_mcp/venv/bin/python3 ~/.construct/operator_mcp/run_operator_mcp.py --help 2>&1 | head -5

# Confirm the bootstrap launcher was installed
test -f ~/.construct/operator_mcp/run_operator_mcp.py && echo ok

# End-to-end
construct doctor
```

### Troubleshooting

| Symptom | Fix |
|---------|-----|
| `run_operator_mcp.py` crashes with `ModuleNotFoundError: operator_mcp` | Re-run `make install` from `operator-mcp/`; the package tree likely failed to copy. |
| No `requirements.txt` at `~/.construct/operator_mcp/requirements.txt` | `cp operator-mcp/requirements.txt ~/.construct/operator_mcp/` and re-run the launcher — it will reinstall deps into the shared venv. |
| Live DAG overlay empty during workflow runs | Session manager sidecar missing — `cd operator-mcp && make build-ts && make install-ts`. |
| Workflow tools missing from the dashboard MCP tool list | Check `~/.construct/logs/` for the operator process; run `~/.construct/operator_mcp/venv/bin/python3 ~/.construct/operator_mcp/run_operator_mcp.py` manually and watch stderr. |

### Config wiring

```toml
[operator]
enabled = true
mcp_path = "~/.construct/operator_mcp/run_operator_mcp.py"
```

Resolution (see `src/agent/operator/mod.rs`):

1. `operator.mcp_path` from config if non-empty.
2. `~/.construct/operator_mcp/run_operator_mcp.py` (the default install location).

---

## Shared venv note

The Operator bootstrap (`run_operator_mcp.py`) historically used a shared venv
at `~/.cache/kumiho-claude/venv` to avoid duplicating the Kumiho gRPC client.
`operator-mcp/Makefile` installs a *dedicated* venv at
`~/.construct/operator_mcp/venv`. Both layouts work — the bootstrap will fall
back to creating the shared venv if it does not exist. If you see deps being
reinstalled on every cold start, set `XDG_CACHE_HOME` consistently across
shells or run `make install` to pin the dedicated venv.

## Related

- [one-click-bootstrap.md](one-click-bootstrap.md) — full install entry point.
- [../../operator-mcp/README.md](../../operator-mcp/README.md) — Operator
  architecture and deployment detail.
- [../reference/api/config-reference.md](../reference/api/config-reference.md)
  — full `[kumiho]` / `[operator]` config schema.
