import { makePromptResource } from "./usePromptResource";

const baseResource = makePromptResource(["base-prompt"], "/api/prompts/base");

export const useBasePrompt = baseResource.usePrompt;
export const useUpdateBasePrompt = baseResource.useUpdatePrompt;
export const useResetBasePrompt = baseResource.useResetPrompt;
