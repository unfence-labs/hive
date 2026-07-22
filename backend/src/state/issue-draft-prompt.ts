import { getDataDir } from "./state.js";
import { DEFAULT_ISSUE_DRAFT_PROMPT } from "../agents/issue-draft-prompt.js";
import {
  loadPromptFileData,
  savePromptFile,
  resetPromptFile,
  type PromptFileData,
} from "./prompt-file.js";

const ISSUE_DRAFT_PROMPT_FILE = "issue-draft.md";

export async function loadIssueDraftPromptData(dataDir = getDataDir()): Promise<PromptFileData> {
  return loadPromptFileData(ISSUE_DRAFT_PROMPT_FILE, DEFAULT_ISSUE_DRAFT_PROMPT, dataDir);
}

export async function saveIssueDraftPrompt(content: string, dataDir = getDataDir()): Promise<void> {
  return savePromptFile(ISSUE_DRAFT_PROMPT_FILE, content, dataDir);
}

export async function resetIssueDraftPrompt(dataDir = getDataDir()): Promise<void> {
  return resetPromptFile(ISSUE_DRAFT_PROMPT_FILE, dataDir);
}
