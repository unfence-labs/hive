import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./useApi";
import type {
  CreateCustomAgentRequest,
  CustomAgentDetail,
  CustomAgentListResponse,
  CustomAgentProviderId,
  CustomAgentSummary,
  UpdateCustomAgentRequest,
} from "@/types";

function upsertCustomAgentInList(
  current: CustomAgentListResponse | undefined,
  agent: CustomAgentDetail,
  replaced?: { id: string; provider: CustomAgentProviderId },
): CustomAgentListResponse | undefined {
  if (!current) return current;
  const candidates = replaced && replaced.id !== agent.id
    ? current.agents.flatMap((item) => {
        if (item.id !== replaced.id) return [item];
        const updated = removeProviderFromSummary(item, replaced.provider);
        return updated ? [updated] : [];
      })
    : current.agents;
  const agents = candidates
    .filter((item) => item.id !== agent.id)
    .concat(agent)
    .sort((a, b) => a.name.localeCompare(b.name));
  return { ...current, agents };
}

function removeProviderFromSummary(
  agent: CustomAgentSummary,
  provider: CustomAgentProviderId,
): CustomAgentSummary | null {
  const otherProvider: CustomAgentProviderId = provider === "claude" ? "codex" : "claude";
  const otherState = agent.providers[otherProvider];
  if (!otherState.present) return null;

  return {
    ...agent,
    status: otherState.error
      ? "invalid"
      : otherProvider === "claude"
        ? "claude_only"
        : "codex_only",
    providers: {
      ...agent.providers,
      [provider]: {
        ...agent.providers[provider],
        present: false,
      },
    },
    invalidReason: otherState.error,
  };
}

function removeProviderFromList(
  current: CustomAgentListResponse | undefined,
  id: string,
  provider: CustomAgentProviderId,
): CustomAgentListResponse | undefined {
  if (!current) return current;
  const agents = current.agents
    .map((agent) => {
      if (agent.id !== id) return agent;
      return removeProviderFromSummary(agent, provider);
    })
    .filter((agent): agent is NonNullable<typeof agent> => agent !== null);
  return { ...current, agents };
}

export function useCustomAgents() {
  return useQuery({
    queryKey: ["settings", "custom-agents"],
    queryFn: () => api.get<CustomAgentListResponse>("/api/settings/custom-agents"),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useCustomAgent(id: string | null | undefined) {
  return useQuery({
    queryKey: ["settings", "custom-agents", id],
    queryFn: () => api.get<CustomAgentDetail>(`/api/settings/custom-agents/${id}`),
    enabled: Boolean(id),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
}

export function useCreateCustomAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCustomAgentRequest) =>
      api.post<CustomAgentDetail>("/api/settings/custom-agents", body),
    onSuccess: (data) => {
      qc.setQueryData(["settings", "custom-agents", data.id], data);
      qc.setQueryData<CustomAgentListResponse>(["settings", "custom-agents"], (current) =>
        upsertCustomAgentInList(current, data),
      );
      void qc.invalidateQueries({ queryKey: ["settings", "custom-agents"] });
      void qc.invalidateQueries({ queryKey: ["completions"] });
    },
  });
}

export function useUpdateCustomAgentProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      provider,
      content,
    }: { id: string; provider: CustomAgentProviderId } & UpdateCustomAgentRequest) =>
      api.put<CustomAgentDetail>(
        `/api/settings/custom-agents/${id}/providers/${provider}`,
        { content },
      ),
    onSuccess: (data, vars) => {
      qc.setQueryData(["settings", "custom-agents", data.id], data);
      qc.setQueryData<CustomAgentListResponse>(["settings", "custom-agents"], (current) =>
        upsertCustomAgentInList(current, data, {
          id: vars.id,
          provider: vars.provider,
        }),
      );
      if (data.id !== vars.id) {
        qc.removeQueries({ queryKey: ["settings", "custom-agents", vars.id] });
      }
      void qc.invalidateQueries({ queryKey: ["settings", "custom-agents"] });
      void qc.invalidateQueries({ queryKey: ["completions"] });
    },
  });
}

export function useDeleteCustomAgentProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, provider }: { id: string; provider: CustomAgentProviderId }) =>
      api.delete<void>(`/api/settings/custom-agents/${id}/providers/${provider}`),
    onSuccess: (_data, vars) => {
      qc.removeQueries({ queryKey: ["settings", "custom-agents", vars.id] });
      qc.setQueryData<CustomAgentListResponse>(["settings", "custom-agents"], (current) =>
        removeProviderFromList(current, vars.id, vars.provider),
      );
      void qc.invalidateQueries({ queryKey: ["settings", "custom-agents"] });
      void qc.invalidateQueries({ queryKey: ["completions"] });
    },
  });
}

export function useCreateCustomAgentCounterpart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, provider }: { id: string; provider: CustomAgentProviderId }) =>
      api.post<CustomAgentDetail>(
        `/api/settings/custom-agents/${id}/providers/${provider}/counterpart`,
      ),
    onSuccess: (data) => {
      qc.setQueryData(["settings", "custom-agents", data.id], data);
      qc.setQueryData<CustomAgentListResponse>(["settings", "custom-agents"], (current) =>
        upsertCustomAgentInList(current, data),
      );
      void qc.invalidateQueries({ queryKey: ["settings", "custom-agents"] });
      void qc.invalidateQueries({ queryKey: ["completions"] });
    },
  });
}
