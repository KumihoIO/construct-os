/**
 * Event emitter — manages subscriptions and broadcasts agent events.
 *
 * Subscribers receive structured AgentEvent payloads. Used by:
 * - SSE endpoint for streaming to operator/dashboard
 * - Future: gateway WebSocket bridge, channel adapters
 */

import type { AgentEvent, AgentStreamEvent } from "./types.js";

export type EventSubscriber = (event: AgentEvent) => void;

export class AgentEventEmitter {
  private subscribers = new Map<string, Set<EventSubscriber>>();
  private globalSubscribers = new Set<EventSubscriber>();
  private seqCounters = new Map<string, number>();

  /**
   * Subscribe to events for a specific agent.
   * Returns an unsubscribe function.
   */
  subscribe(agentId: string, callback: EventSubscriber): () => void {
    if (!this.subscribers.has(agentId)) {
      this.subscribers.set(agentId, new Set());
    }
    this.subscribers.get(agentId)!.add(callback);
    return () => {
      this.subscribers.get(agentId)?.delete(callback);
    };
  }

  /**
   * Subscribe to events for ALL agents.
   * Returns an unsubscribe function.
   */
  subscribeAll(callback: EventSubscriber): () => void {
    this.globalSubscribers.add(callback);
    return () => {
      this.globalSubscribers.delete(callback);
    };
  }

  /**
   * Emit an event for a specific agent.
   */
  emit(agentId: string, event: AgentStreamEvent): void {
    const seq = (this.seqCounters.get(agentId) ?? 0) + 1;
    this.seqCounters.set(agentId, seq);

    const envelope: AgentEvent = {
      agentId,
      event,
      seq,
      timestamp: new Date().toISOString(),
    };

    // Agent-specific subscribers
    const agentSubs = this.subscribers.get(agentId);
    if (agentSubs) {
      for (const cb of agentSubs) {
        try {
          cb(envelope);
        } catch {
          // don't let subscriber errors break the emitter
        }
      }
    }

    // Global subscribers
    for (const cb of this.globalSubscribers) {
      try {
        cb(envelope);
      } catch {
        // ignore
      }
    }
  }

  /**
   * Remove all subscriptions for an agent (on close).
   */
  removeAgent(agentId: string): void {
    this.subscribers.delete(agentId);
    this.seqCounters.delete(agentId);
  }
}
