import { describe, expect, it } from "vitest";
import { parseSubAgentInfo, buildChildrenMap } from "@/lib/sub-agent";
import type { ToolCall } from "@/types";

function tool(overrides: Partial<ToolCall> & { name: string; input: string }): ToolCall {
  return { id: "t-" + Math.random().toString(36).slice(2, 6), ...overrides };
}

describe("parseSubAgentInfo", () => {
  it("returns null for non-Task tools", () => {
    expect(parseSubAgentInfo(tool({ name: "Bash", input: '{"command":"ls"}' }))).toBeNull();
    expect(parseSubAgentInfo(tool({ name: "Read", input: '{"file_path":"/a.ts"}' }))).toBeNull();
    expect(parseSubAgentInfo(tool({ name: "Edit", input: "{}" }))).toBeNull();
  });

  it("parses a complete Task input", () => {
    const result = parseSubAgentInfo(
      tool({
        name: "Task",
        input: JSON.stringify({
          subagent_type: "Explore",
          description: "Search codebase",
          prompt: "Find all test files",
          run_in_background: true,
          model: "haiku",
        }),
      }),
    );

    expect(result).toEqual({
      subagentType: "Explore",
      description: "Search codebase",
      prompt: "Find all test files",
      runInBackground: true,
      model: "haiku",
    });
  });

  it("defaults subagentType to 'Agent' when missing", () => {
    const result = parseSubAgentInfo(
      tool({ name: "Task", input: JSON.stringify({ description: "Do something" }) }),
    );
    expect(result?.subagentType).toBe("Agent");
  });

  it("defaults description to empty string when missing", () => {
    const result = parseSubAgentInfo(
      tool({ name: "Task", input: JSON.stringify({ subagent_type: "Plan" }) }),
    );
    expect(result?.description).toBe("");
  });

  it("defaults runInBackground to false when not explicitly true", () => {
    expect(
      parseSubAgentInfo(tool({ name: "Task", input: JSON.stringify({}) }))?.runInBackground,
    ).toBe(false);

    expect(
      parseSubAgentInfo(
        tool({ name: "Task", input: JSON.stringify({ run_in_background: false }) }),
      )?.runInBackground,
    ).toBe(false);

    expect(
      parseSubAgentInfo(
        tool({ name: "Task", input: JSON.stringify({ run_in_background: "true" }) }),
      )?.runInBackground,
    ).toBe(false);

    expect(
      parseSubAgentInfo(
        tool({ name: "Task", input: JSON.stringify({ run_in_background: 1 }) }),
      )?.runInBackground,
    ).toBe(false);
  });

  it("sets runInBackground to true only for boolean true", () => {
    const result = parseSubAgentInfo(
      tool({ name: "Task", input: JSON.stringify({ run_in_background: true }) }),
    );
    expect(result?.runInBackground).toBe(true);
  });

  it("returns null for malformed JSON", () => {
    expect(parseSubAgentInfo(tool({ name: "Task", input: "not json" }))).toBeNull();
    expect(parseSubAgentInfo(tool({ name: "Task", input: "{broken" }))).toBeNull();
    expect(parseSubAgentInfo(tool({ name: "Task", input: "" }))).toBeNull();
  });

  it("handles prompt being undefined", () => {
    const result = parseSubAgentInfo(
      tool({ name: "Task", input: JSON.stringify({ subagent_type: "Explore" }) }),
    );
    expect(result?.prompt).toBeUndefined();
  });

  it("handles model being undefined", () => {
    const result = parseSubAgentInfo(
      tool({ name: "Task", input: JSON.stringify({ subagent_type: "Explore" }) }),
    );
    expect(result?.model).toBeUndefined();
  });

  it("preserves various model values", () => {
    for (const model of ["haiku", "sonnet", "opus"]) {
      const result = parseSubAgentInfo(
        tool({ name: "Task", input: JSON.stringify({ subagent_type: "Plan", model }) }),
      );
      expect(result?.model).toBe(model);
    }
  });

  it("preserves known subagent types", () => {
    for (const type of ["Explore", "Plan", "Bash", "general-purpose", "web-search", "explore-docs"]) {
      const result = parseSubAgentInfo(
        tool({ name: "Task", input: JSON.stringify({ subagent_type: type }) }),
      );
      expect(result?.subagentType).toBe(type);
    }
  });
});

describe("buildChildrenMap", () => {
  it("returns empty map for no tools", () => {
    expect(buildChildrenMap([]).size).toBe(0);
  });

  it("returns empty map when no tools have parents", () => {
    const tools = [
      tool({ name: "Bash", input: "{}" }),
      tool({ name: "Read", input: "{}" }),
    ];
    expect(buildChildrenMap(tools).size).toBe(0);
  });

  it("groups children by parentToolUseId", () => {
    const parent = tool({ id: "parent-1", name: "Task", input: "{}" });
    const child1 = tool({ id: "c1", name: "Read", input: "{}", parentToolUseId: "parent-1" });
    const child2 = tool({ id: "c2", name: "Grep", input: "{}", parentToolUseId: "parent-1" });
    const orphan = tool({ id: "o1", name: "Bash", input: "{}" });

    const map = buildChildrenMap([parent, child1, child2, orphan]);

    expect(map.size).toBe(1);
    expect(map.get("parent-1")).toHaveLength(2);
    expect(map.get("parent-1")![0].id).toBe("c1");
    expect(map.get("parent-1")![1].id).toBe("c2");
  });

  it("handles multiple parents", () => {
    const child1 = tool({ id: "c1", name: "Read", input: "{}", parentToolUseId: "p1" });
    const child2 = tool({ id: "c2", name: "Grep", input: "{}", parentToolUseId: "p2" });
    const child3 = tool({ id: "c3", name: "Bash", input: "{}", parentToolUseId: "p1" });

    const map = buildChildrenMap([child1, child2, child3]);

    expect(map.size).toBe(2);
    expect(map.get("p1")).toHaveLength(2);
    expect(map.get("p2")).toHaveLength(1);
  });

  it("preserves insertion order of children", () => {
    const children = [
      tool({ id: "c1", name: "Read", input: "{}", parentToolUseId: "p" }),
      tool({ id: "c2", name: "Grep", input: "{}", parentToolUseId: "p" }),
      tool({ id: "c3", name: "Edit", input: "{}", parentToolUseId: "p" }),
    ];

    const map = buildChildrenMap(children);
    const result = map.get("p")!;

    expect(result[0].id).toBe("c1");
    expect(result[1].id).toBe("c2");
    expect(result[2].id).toBe("c3");
  });

  it("handles nested hierarchies (grandchildren map to their parent, not grandparent)", () => {
    const parent = tool({ id: "p", name: "Task", input: "{}" });
    const child = tool({ id: "c", name: "Task", input: "{}", parentToolUseId: "p" });
    const grandchild = tool({ id: "gc", name: "Bash", input: "{}", parentToolUseId: "c" });

    const map = buildChildrenMap([parent, child, grandchild]);

    expect(map.get("p")).toHaveLength(1);
    expect(map.get("p")![0].id).toBe("c");
    expect(map.get("c")).toHaveLength(1);
    expect(map.get("c")![0].id).toBe("gc");
    expect(map.has("gc")).toBe(false);
  });

  it("does not include the parent tool itself in its children", () => {
    const parent = tool({ id: "p", name: "Task", input: "{}" });
    const child = tool({ id: "c", name: "Read", input: "{}", parentToolUseId: "p" });

    const map = buildChildrenMap([parent, child]);
    const children = map.get("p")!;

    expect(children).toHaveLength(1);
    expect(children[0].id).toBe("c");
  });
});
