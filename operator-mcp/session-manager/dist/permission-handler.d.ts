/**
 * Permission Handler — policy-based auto-approve with channel escalation.
 *
 * Evaluates permission requests against a policy table:
 *   - Auto-approve: read-only ops, file edits in cwd (coder role), safe bash, MCP tools
 *   - Escalate: network access, destructive commands, out-of-cwd writes
 *
 * Escalated requests are emitted as events for the operator to forward
 * to gateway → channels → user. The user's response routes back through
 * respond_to_permission().
 */
import type { AgentStreamEvent } from "./types.js";
export interface PermissionRequest {
    id: string;
    agentId: string;
    agentTitle: string;
    tool: string;
    args: Record<string, any>;
    cwd: string;
    role: string;
    status: "pending" | "approved" | "denied";
    createdAt: string;
    resolvedAt?: string;
    resolvedBy?: string;
}
export type PermissionAction = "approve" | "deny";
export declare class PermissionHandler {
    private pending;
    private history;
    /**
     * Evaluate a permission request against the policy table.
     * Returns "approve" | "deny" | "escalate".
     */
    evaluate(tool: string, args: Record<string, any>, cwd: string, role: string): "approve" | "escalate";
    /**
     * Create a pending permission request (for escalated operations).
     * Returns a promise that resolves when the user responds.
     */
    createPendingRequest(agentId: string, agentTitle: string, tool: string, args: Record<string, any>, cwd: string, role: string, onEvent: (event: AgentStreamEvent) => void): Promise<PermissionAction>;
    /**
     * Respond to a pending permission request.
     */
    respond(requestId: string, action: PermissionAction, by?: string): boolean;
    /**
     * List all pending permission requests.
     */
    listPending(): PermissionRequest[];
    /**
     * Get a specific permission request.
     */
    getRequest(requestId: string): PermissionRequest | undefined;
    /**
     * Get recent permission history.
     */
    getHistory(limit?: number): PermissionRequest[];
}
