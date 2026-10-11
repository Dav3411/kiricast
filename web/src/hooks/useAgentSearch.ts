"use client";

import { useMemo } from "react";
import type { Agent } from "@/types/agent";

export function useAgentSearch(agents: Agent[], search: string): Agent[] {
  return useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return agents;
    return agents.filter((agent) => {
      const haystack = `${agent.name} ${agent.id} ${agent.personality ?? ""} ${agent.speaking_style ?? ""} ${agent.concept ?? ""}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [agents, search]);
}
