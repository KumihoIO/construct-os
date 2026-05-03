import { useEffect, useState, useCallback } from 'react';
import { fetchAgents } from '@/lib/api';
import type { AgentDefinition } from '@/types/api';

/**
 * Module-level cache shared by every consumer of `useAgentRoster` for the
 * lifetime of the editor session. Multiple surfaces (canvas badge, side
 * panel) open the picker back-to-back; we only want one network round-trip.
 */
let cache: AgentDefinition[] | null = null;
let inflight: Promise<AgentDefinition[]> | null = null;
const subscribers = new Set<() => void>();

function notify() {
  for (const s of subscribers) s();
}

async function loadAgents(force = false): Promise<AgentDefinition[]> {
  if (!force && cache) return cache;
  if (!force && inflight) return inflight;
  inflight = fetchAgents(false, 1, 100)
    .then((res) => {
      cache = res.agents;
      return cache;
    })
    .catch(() => {
      cache = [];
      return cache;
    })
    .finally(() => {
      inflight = null;
      notify();
    });
  return inflight;
}

export interface AgentRoster {
  agents: AgentDefinition[];
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useAgentRoster(): AgentRoster {
  const [agents, setAgents] = useState<AgentDefinition[]>(cache ?? []);
  const [loading, setLoading] = useState<boolean>(cache === null);

  useEffect(() => {
    const sync = () => {
      setAgents(cache ?? []);
      setLoading(inflight !== null);
    };
    subscribers.add(sync);
    if (cache === null) {
      setLoading(true);
      loadAgents().then(sync);
    } else {
      sync();
    }
    return () => {
      subscribers.delete(sync);
    };
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    await loadAgents(true);
    setAgents(cache ?? []);
    setLoading(false);
  }, []);

  return { agents, loading, refresh };
}
