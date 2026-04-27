/**
 * Codex CLI provider — spawns codex as subprocess.
 *
 * Unlike Claude which has a proper SDK, Codex is driven via CLI subprocess.
 * This is a thin wrapper that captures stdout/stderr and emits timeline events.
 */
import { spawn } from "node:child_process";
const log = (msg) => process.stderr.write(`[session-mgr:codex] ${msg}\n`);
/**
 * Create a Codex agent session via subprocess.
 */
export function createCodexSession(config, onEvent) {
    const handle = {
        id: config.title ?? "codex-session",
        process: null,
        closed: false,
        turnSeq: 0,
        stdout: "",
        stderr: "",
        usage: {},
    };
    const runPrompt = (prompt) => {
        const turnId = `turn-${++handle.turnSeq}`;
        onEvent({ type: "turn_started", turnId });
        onEvent({ type: "status_changed", status: "running" });
        handle.stdout = "";
        handle.stderr = "";
        const args = ["exec", "--full-auto", "--skip-git-repo-check", prompt];
        log(`Spawning codex: ${args.slice(0, 3).join(" ")}... (${prompt.length} chars)`);
        const proc = spawn("codex", args, {
            cwd: config.cwd,
            stdio: ["ignore", "pipe", "pipe"],
            env: { ...process.env, ...(config.env ?? {}) },
        });
        handle.process = proc;
        proc.stdout?.on("data", (chunk) => {
            const text = chunk.toString("utf-8");
            handle.stdout += text;
            onEvent({ type: "timeline", item: { type: "assistant_message", text } });
        });
        proc.stderr?.on("data", (chunk) => {
            const text = chunk.toString("utf-8");
            handle.stderr += text;
        });
        proc.on("close", (code) => {
            handle.process = null;
            if (handle.closed)
                return;
            if (code === 0) {
                onEvent({ type: "turn_completed", turnId });
                onEvent({ type: "status_changed", status: "idle" });
            }
            else {
                const error = handle.stderr.slice(-500) || `Process exited with code ${code}`;
                onEvent({ type: "turn_failed", turnId, error });
                onEvent({ type: "status_changed", status: "error" });
            }
        });
        proc.on("error", (err) => {
            handle.process = null;
            if (handle.closed)
                return;
            onEvent({ type: "turn_failed", turnId, error: err.message });
            onEvent({ type: "status_changed", status: "error" });
        });
    };
    // Start the first turn
    runPrompt(config.prompt);
    // Attach follow-up method
    handle.sendQuery = (prompt) => {
        if (handle.closed)
            throw new Error("Session is closed");
        runPrompt(prompt);
    };
    return handle;
}
/**
 * Send a follow-up query to an existing Codex session.
 */
export function sendCodexQuery(handle, prompt, onEvent) {
    handle.sendQuery(prompt);
}
/**
 * Close a Codex session.
 */
export async function closeCodexSession(handle) {
    handle.closed = true;
    if (handle.process) {
        handle.process.kill("SIGTERM");
        handle.process = null;
    }
}
//# sourceMappingURL=codex.js.map