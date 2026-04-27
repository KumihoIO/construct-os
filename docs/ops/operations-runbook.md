# Construct Operations Runbook

This runbook is for operators who maintain availability, security posture, and incident response.

Last verified: **April 21, 2026**.

## Scope

Use this document for day-2 operations:

- starting and supervising runtime
- health checks and diagnostics
- safe rollout and rollback
- incident triage and recovery

For first-time installation, start from [one-click-bootstrap.md](../setup-guides/one-click-bootstrap.md).

## Runtime Modes

| Mode | Command | When to use |
|---|---|---|
| Foreground runtime | `construct daemon` | local debugging, short-lived sessions |
| Foreground gateway only | `construct gateway` | webhook endpoint testing |
| User service | `construct service install && construct service start` | persistent operator-managed runtime |
| Docker / Podman | `docker compose up -d` | containerized deployment |

## Docker / Podman Runtime

If you installed via `./install.sh --docker`, the container exits after onboarding. To run
Construct as a long-lived container, use the repository `docker-compose.yml` or start a
container manually against the persisted data directory.

### Recommended: docker-compose

```bash
# Start (detached, auto-restarts on reboot)
docker compose up -d

# Stop
docker compose down

# Restart
docker compose up -d
```

Replace `docker` with `podman` if using Podman.

### Manual container lifecycle

```bash
# Start a new container from the bootstrap image
docker run -d --name construct \
  --restart unless-stopped \
  -v "$PWD/.construct-docker/.construct:/construct-data/.construct" \
  -v "$PWD/.construct-docker/workspace:/construct-data/workspace" \
  -e HOME=/construct-data \
  -e CONSTRUCT_WORKSPACE=/construct-data/workspace \
  -p 42617:42617 \
  construct-bootstrap:local \
  gateway

# Stop (preserves config and workspace)
docker stop construct

# Restart a stopped container
docker start construct

# View logs
docker logs -f construct

# Health check
docker exec construct construct status
```

For Podman, add `--userns keep-id --user "$(id -u):$(id -g)"` and append `:Z` to volume mounts.

### Key detail: do not re-run install.sh to restart

Re-running `install.sh --docker` rebuilds the image and re-runs onboarding. To simply
restart, use `docker start`, `docker compose up -d`, or `podman start`.

For full setup instructions, see [one-click-bootstrap.md](../setup-guides/one-click-bootstrap.md#stopping-and-restarting-a-dockerpodman-container).

## Baseline Operator Checklist

1. Validate configuration:

```bash
construct status
```

2. Verify diagnostics:

```bash
construct doctor
construct channel doctor
```

3. Start runtime:

```bash
construct daemon
```

4. For persistent user session service:

```bash
construct service install
construct service start
construct service status
```

<!-- TODO screenshot: Construct dashboard Audit view displaying the signed audit chain -->
![Construct dashboard Audit view displaying the signed audit chain](../assets/ops/operations-runbook-01-dashboard-audit.png)

<!-- TODO screenshot: dashboard showing Construct health status indicators for runtime subsystems -->
![Dashboard showing Construct health status indicators for runtime subsystems](../assets/ops/operations-runbook-03-dashboard-health.png)

## Health and State Signals

| Signal | Command / File | Expected |
|---|---|---|
| Config validity | `construct doctor` | no critical errors |
| Channel connectivity | `construct channel doctor` | configured channels healthy |
| Runtime summary | `construct status` | expected provider/model/channels |
| Daemon heartbeat/state | `~/.construct/daemon_state.json` | file updates periodically |
| Gateway/dashboard | `GET http://127.0.0.1:42617/health` | `200 OK` |
| Audit chain | `GET /api/audit/verify` (or `Audit` view on dashboard) | chain verifies clean |
| Kumiho proxy | `GET /api/kumiho/health` (via gateway) | upstream Kumiho reachable |
| Operator checkpoints | `~/.construct/workflow_checkpoints/` | recent workflow runs present |
| Operator RunLogs | `~/.construct/operator_mcp/runlogs/` | per-agent JSONL trails present |

<!-- TODO screenshot: terminal showing the tail of ~/.construct/logs/daemon.log -->
![Terminal showing the tail of ~/.construct/logs/daemon.log](../assets/ops/operations-runbook-02-daemon-logs.png)

## Logs and Diagnostics

### macOS / Windows (service wrapper logs)

- `~/.construct/logs/daemon.stdout.log`
- `~/.construct/logs/daemon.stderr.log`

### Linux (systemd user service)

```bash
journalctl --user -u construct.service -f
```

## Incident Triage Flow (Fast Path)

1. Snapshot system state:

```bash
construct status
construct doctor
construct channel doctor
```

2. Check service state:

```bash
construct service status
```

3. If service is unhealthy, restart cleanly:

```bash
construct service stop
construct service start
```

4. If channels still fail, verify allowlists and credentials in `~/.construct/config.toml`.

5. If gateway is involved, verify bind/auth settings (`[gateway]`) and local reachability.

## Safe Change Procedure

Before applying config changes:

1. backup `~/.construct/config.toml`
2. apply one logical change at a time
3. run `construct doctor`
4. restart daemon/service
5. verify with `status` + `channel doctor`

## Rollback Procedure

If a rollout regresses behavior:

1. restore previous `config.toml`
2. restart runtime (`daemon` or `service`)
3. confirm recovery via `doctor` and channel health checks
4. document incident root cause and mitigation

## Related Docs

- [one-click-bootstrap.md](../setup-guides/one-click-bootstrap.md)
- [troubleshooting.md](./troubleshooting.md)
- [config-reference.md](../reference/api/config-reference.md)
- [commands-reference.md](../reference/cli/commands-reference.md)
