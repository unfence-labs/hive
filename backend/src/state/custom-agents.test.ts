import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir } from "../utils/test-helpers.js";
import {
  _clearCustomAgentsLockForTests,
  createGlobalCustomAgent,
  createGlobalCustomAgentCounterpart,
  deleteGlobalCustomAgentProvider,
  listGlobalCustomAgents,
  loadGlobalCustomAgent,
  saveGlobalCustomAgentProvider,
  type CustomAgentRoots,
} from "./custom-agents.js";

let tmpDir: string;
let roots: CustomAgentRoots;

async function writeAgent(root: string, fileName: string, content: string): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, fileName), content, "utf-8");
}

beforeEach(async () => {
  tmpDir = await createTempDir();
  roots = {
    claude: join(tmpDir, ".claude", "agents"),
    codex: join(tmpDir, ".codex", "agents"),
  };
  _clearCustomAgentsLockForTests();
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
  _clearCustomAgentsLockForTests();
});

describe("global custom agents state", () => {
  it("lists Claude and Codex custom agents as one collection", async () => {
    await writeAgent(
      roots.claude,
      "reviewer.md",
      "---\nname: reviewer\ndescription: Review code\n---\n# Reviewer\n",
    );
    await writeAgent(
      roots.codex,
      "planner.toml",
      "name = \"planner\"\ndescription = \"Plan work\"\ndeveloper_instructions = \"Plan changes.\"\n",
    );

    const { agents } = await listGlobalCustomAgents(roots);

    expect(agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "reviewer",
          status: "claude_only",
          providers: expect.objectContaining({
            claude: expect.objectContaining({ present: true }),
            codex: expect.objectContaining({ present: false }),
          }),
        }),
        expect.objectContaining({
          id: "planner",
          status: "codex_only",
        }),
      ]),
    );
  });

  it("groups matching Claude and Codex agents as both", async () => {
    await writeAgent(roots.claude, "reviewer.md", "---\nname: reviewer\n---\n# Claude\n");
    await writeAgent(
      roots.codex,
      "reviewer.toml",
      "name = \"reviewer\"\ndeveloper_instructions = \"Codex\"\n",
    );

    const detail = await loadGlobalCustomAgent("reviewer", roots);

    expect(detail?.status).toBe("both");
    expect(detail?.contents.claude).toContain("# Claude");
    expect(detail?.contents.codex).toContain("developer_instructions");
  });

  it("keeps invalid provider content editable", async () => {
    await writeAgent(roots.codex, "broken.toml", "name = \"broken\"\n=");

    const detail = await loadGlobalCustomAgent("broken", roots);

    expect(detail?.status).toBe("invalid");
    expect(detail?.invalidReason).toBeTruthy();
    expect(detail?.contents.codex).toBe("name = \"broken\"\n=");
  });

  it("creates a provider-native custom agent", async () => {
    const created = await createGlobalCustomAgent(
      "claude",
      "---\nname: reviewer\ndescription: Review code\n---\n# Reviewer\n",
      roots,
    );

    expect(created.id).toBe("reviewer");
    expect(created.status).toBe("claude_only");
    await expect(readFile(join(roots.claude, "reviewer.md"), "utf-8")).resolves.toContain("# Reviewer");
  });

  it("rejects creating Codex content without developer_instructions", async () => {
    await expect(
      createGlobalCustomAgent("codex", "name = \"reviewer\"\n", roots),
    ).rejects.toThrow("developer_instructions is required");
  });

  it("renames only the edited provider copy", async () => {
    await writeAgent(roots.claude, "reviewer.md", "---\nname: reviewer\n---\n# Reviewer\n");

    const saved = await saveGlobalCustomAgentProvider(
      "reviewer",
      "claude",
      "---\nname: auditor\n---\n# Auditor\n",
      roots,
    );

    expect(saved?.id).toBe("auditor");
    await expect(readFile(join(roots.claude, "auditor.md"), "utf-8")).resolves.toContain("# Auditor");
    await expect(lstat(join(roots.claude, "reviewer.md"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("deletes a single provider copy", async () => {
    await writeAgent(roots.claude, "reviewer.md", "---\nname: reviewer\n---\n# Claude\n");
    await writeAgent(
      roots.codex,
      "reviewer.toml",
      "name = \"reviewer\"\ndeveloper_instructions = \"Codex\"\n",
    );

    await expect(deleteGlobalCustomAgentProvider("reviewer", "claude", roots)).resolves.toBe(true);

    const detail = await loadGlobalCustomAgent("reviewer", roots);
    expect(detail?.status).toBe("codex_only");
    await expect(lstat(join(roots.claude, "reviewer.md"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("creates an explicit Codex counterpart from Claude content", async () => {
    await writeAgent(
      roots.claude,
      "reviewer.md",
      "---\nname: reviewer\ndescription: Review code\n---\n# Reviewer\n\nReview changes carefully.\n",
    );

    const created = await createGlobalCustomAgentCounterpart("reviewer", "codex", roots);

    expect(created?.status).toBe("both");
    const content = await readFile(join(roots.codex, "reviewer.toml"), "utf-8");
    expect(content).toContain("name = \"reviewer\"");
    expect(content).toContain("developer_instructions");
    expect(content).toContain("Review changes carefully");
  });
});
