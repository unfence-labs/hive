import { getDataDir } from "./state.js";
import { BRAIN_BASE_PROMPT } from "../agents/system-prompt.js";
import {
  loadPromptFileData,
  savePromptFile,
  resetPromptFile,
  type PromptFileData,
} from "./prompt-file.js";

const BRAIN_PROMPT_FILE = "brain.md";

export async function loadBrainPromptData(dataDir = getDataDir()): Promise<PromptFileData> {
  return loadPromptFileData(BRAIN_PROMPT_FILE, BRAIN_BASE_PROMPT, dataDir);
}

export async function saveBrainPrompt(content: string, dataDir = getDataDir()): Promise<void> {
  return savePromptFile(BRAIN_PROMPT_FILE, content, dataDir);
}

export async function resetBrainPrompt(dataDir = getDataDir()): Promise<void> {
  return resetPromptFile(BRAIN_PROMPT_FILE, dataDir);
}
