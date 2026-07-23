import { makePromptResource } from "./usePromptResource";

const issueDraftResource = makePromptResource(
  ["issue-draft-prompt"],
  "/api/prompts/issue-draft",
);

export const useIssueDraftPrompt = issueDraftResource.usePrompt;
export const useUpdateIssueDraftPrompt = issueDraftResource.useUpdatePrompt;
export const useResetIssueDraftPrompt = issueDraftResource.useResetPrompt;
