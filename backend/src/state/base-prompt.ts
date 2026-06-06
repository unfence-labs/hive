import { getDataDir } from "./state.js";
import { DEFAULT_BASE_PROMPT } from "../agents/system-prompt.js";
import {
  loadPromptFileData,
  savePromptFile,
  resetPromptFile,
  type PromptFileData,
} from "./prompt-file.js";

const BASE_PROMPT_FILE = "base.md";

/** @deprecated Prefer {@link PromptFileData}; kept for backward compatibility. */
export type BasePromptData = PromptFileData;

export async function loadBasePromptData(dataDir = getDataDir()): Promise<PromptFileData> {
  return loadPromptFileData(BASE_PROMPT_FILE, DEFAULT_BASE_PROMPT, dataDir);
}

export async function saveBasePrompt(content: string, dataDir = getDataDir()): Promise<void> {
  return savePromptFile(BASE_PROMPT_FILE, content, dataDir);
}

export async function resetBasePrompt(dataDir = getDataDir()): Promise<void> {
  return resetPromptFile(BASE_PROMPT_FILE, dataDir);
}
