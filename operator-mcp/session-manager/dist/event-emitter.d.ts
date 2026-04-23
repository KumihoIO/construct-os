/**
 * Event emitter — manages subscriptions and broadcasts agent events.
 *
 * Subscribers receive structured AgentEvent payloads. Used by:
 * - SSE endpoint for streaming to operator/dashboard
 * - Future: gateway WebSocket bridge, channel adapters
 */
import type { AgentEvent, AgentStreamEvent } from "./types.js";
export type EventSubscriber = (event: AgentEvent) => void;
export declare class AgentEventEmitter {
    private subscribers;
    private globalSubscribers;
    private seqCounters;
    /**
     * Subscribe to events for a specific agent.
     * Returns an unsubscribe function.
     */
    subscribe(agentId: string, callback: EventSubscriber): () => void;
    /**
     * Subscribe to events for ALL agents.
     * Returns an unsubscribe function.
     */
    subscribeAll(callback: EventSubscriber): () => void;
    /**
     * Emit an event for a specific agent.
     */
    emit(agentId: string, event: AgentStreamEvent): void;
    /**
     * Remove all subscriptions for an agent (on close).
     */
    removeAgent(agentId: string): void;
}
