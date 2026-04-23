/**
 * Codex CLI provider — spawns codex as subprocess.
 *
 * Unlike Claude which has a proper SDK, Codex is driven via CLI subprocess.
 * This is a thin wrapper that captures stdout/stderr and emits timeline events.
 */

import { spawn, type ChildProcess } from "node:child_process";
import type { AgentSessionConfig, AgentStreamEvent, AgentUsage } from "../types.js";

const log = (msg: string) => process.stderr.write(`[session-mgr:codex] ${msg}\n`);

export interface CodexSessionHandle {
  id: string;
  process: ChildProcess | null;
  closed: boolean;
  turnSeq: number;
  stdout: string;
  stderr: string;
  usage: AgentUsage;
}

/**
 * Create a Codex agent session via subprocess.
 */
export function createCodexSession(
  config: AgentSessionConfig,
  onEvent: (event: AgentStreamEvent) => void,
): CodexSessionHandle {
  const handle: CodexSessionHandle = {
    id: config.title ?? "codex-session",
    process: null,
    closed: false,
    turnSeq: 0,
    stdout: "",
    stderr: "",
    usage: {},
  };

  const runPrompt = (prompt: string) => {
    const turnId = `turn-${++handle.turnSeq}`;
    onEvent({ type: "turn_started", turnId });
    onEvent({ type: "status_changed", status: "running" });

    handle.stdout = "";
    handle.stderr = "";

    const args = ["--quiet", "-a", "full-auto", prompt];
    log(`Spawning codex: ${args.slice(0, 3).join(" ")}... (${prompt.length} chars)`);

    const proc = spawn("codex", args, {
      cwd: config.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...(config.env ?? {}) },
    });
    handle.process = proc;

    proc.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      handle.stdout += text;
      onEvent({ type: "timeline", item: { type: "assistant_message", text } });
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      handle.stderr += text;
    });

    proc.on("close", (code) => {
      handle.process = null;
      if (handle.closed) return;

      if (code === 0) {
        onEvent({ type: "turn_completed", turnId });
        onEvent({ type: "status_changed", status: "idle" });
      } else {
        const error = handle.stderr.slice(-500) || `Process exited with code ${code}`;
        onEvent({ type: "turn_failed", turnId, error });
        onEvent({ type: "status_changed", status: "error" });
      }
    });

    proc.on("error", (err) => {
      handle.process = null;
      if (handle.closed) return;
      onEvent({ type: "turn_failed", turnId, error: err.message });
      onEvent({ type: "status_changed", status: "error" });
    });
  };

  // Start the first turn
  runPrompt(config.prompt);

  // Attach follow-up method
  (handle as any).sendQuery = (prompt: string) => {
    if (handle.closed) throw new Error("Session is closed");
    runPrompt(prompt);
  };

  return handle;
}

/**
 * Send a follow-up query to an existing Codex session.
 */
export function sendCodexQuery(handle: CodexSessionHandle, prompt: string, onEvent: (event: AgentStreamEvent) => void): void {
  (handle as any).sendQuery(prompt);
}

/**
 * Close a Codex session.
 */
export async function closeCodexSession(handle: CodexSessionHandle): Promise<void> {
  handle.closed = true;
  if (handle.process) {
    handle.process.kill("SIGTERM");
    handle.process = null;
  }
}
