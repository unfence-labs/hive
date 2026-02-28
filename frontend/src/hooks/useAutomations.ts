import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { api } from "./useApi";
import type { Automation, AutomationRun, ChatMessage } from "@/types";

const sharedOptions = {
  refetchInterval: 15_000,
  staleTime: 10_000,
  gcTime: 5 * 60_000,
  placeholderData: keepPreviousData,
} as const;

export function useAutomations() {
  return useQuery({
    queryKey: ["automations"],
    queryFn: () => api.get<Automation[]>("/api/automations"),
    ...sharedOptions,
  });
}

export function useAutomation(id: string | undefined) {
  return useQuery({
    queryKey: ["automations", id],
    queryFn: () => api.get<Automation>(`/api/automations/${id}`),
    enabled: !!id,
    ...sharedOptions,
  });
}

export function useAutomationRuns(id: string | undefined) {
  return useQuery({
    queryKey: ["automation-runs", id],
    queryFn: () => api.get<AutomationRun[]>(`/api/automations/${id}/runs`),
    enabled: !!id,
    ...sharedOptions,
  });
}

export function useCreateAutomation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      name: string;
      projectId?: string;
      trigger: { type: "cron"; expression: string };
      action: {
        type: "agent";
        modelId: string;
        systemPromptId?: string;
        systemPromptInline?: string;
        userPromptId?: string;
        userPromptInline?: string;
      };
      notification?: { onComplete: boolean; onFailure: boolean };
    }) => api.post<Automation>("/api/automations", body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["automations"] });
    },
  });
}

export function useUpdateAutomation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) =>
      api.put<Automation>(`/api/automations/${id}`, body),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: ["automations"] });
      void qc.invalidateQueries({ queryKey: ["automations", variables.id] });
    },
  });
}

export function useDeleteAutomation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/automations/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["automations"] });
    },
  });
}

export function useTriggerAutomation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<AutomationRun>(`/api/automations/${id}/trigger`),
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: ["automation-runs", id] });
      void qc.invalidateQueries({ queryKey: ["automations"] });
    },
  });
}

export interface RunMessagesResponse {
  messages: ChatMessage[];
  systemPrompt?: string;
}

export function useAutomationRunMessages(automationId: string | undefined, runId: string | undefined) {
  return useQuery({
    queryKey: ["automation-run-messages", automationId, runId],
    queryFn: () => api.get<RunMessagesResponse>(`/api/automations/${automationId}/runs/${runId}/messages`),
    enabled: !!automationId && !!runId,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  });
}
