import { makePromptResource } from "./usePromptResource";

const brainResource = makePromptResource(["brain-prompt"], "/api/prompts/brain");

export const useBrainPrompt = brainResource.usePrompt;
export const useUpdateBrainPrompt = brainResource.useUpdatePrompt;
export const useResetBrainPrompt = brainResource.useResetPrompt;
