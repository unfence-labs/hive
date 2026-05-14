import { describe, expect, it } from "vitest";
import {
  countProjectEnvVariables,
  generateProjectEnvContent,
  parseProjectEnvContent,
  parseProjectEnvConfig,
  validateProjectEnvConfig,
  type ProjectEnvConfig,
} from "@hive/shared/project-env";

describe("project env config helpers", () => {
  it("generates .env content from structured variables", () => {
    const config: ProjectEnvConfig = {
      variables: [
        {
          id: "var-1",
          key: "DATABASE_URL",
          value: "postgres://local",
          comment: "Local database",
        },
        {
          id: "var-2",
          key: "EMPTY_VALUE",
          value: "",
        },
      ],
    };

    expect(generateProjectEnvContent(config)).toBe(
      "# Local database\nDATABASE_URL=postgres://local\nEMPTY_VALUE=\n",
    );
  });

  it("does not generate a .env file when variables are absent", () => {
    expect(generateProjectEnvContent({ variables: [] })).toBe("");
  });

  it("parses raw .env content into key-value entries", () => {
    expect(parseProjectEnvContent([
      "# Local settings",
      "DATABASE_URL=postgres://local # main database",
      "export API_KEY=secret",
      "EMPTY_VALUE=",
      "QUOTED=\"value # not a comment\" # ignored",
      "INVALID_LINE",
      "",
    ].join("\n"))).toEqual([
      { key: "DATABASE_URL", value: "postgres://local" },
      { key: "API_KEY", value: "secret" },
      { key: "EMPTY_VALUE", value: "" },
      { key: "QUOTED", value: "value # not a comment" },
    ]);
  });

  it("round-trips generated .env values that need quoting", () => {
    const config: ProjectEnvConfig = {
      variables: [
        { id: "var-1", key: "SAFE", value: "simple" },
        { id: "var-2", key: "HASH", value: "abc # def" },
        { id: "var-3", key: "SPACE", value: "hello world" },
        { id: "var-4", key: "QUOTE", value: "say \"hi\"" },
        { id: "var-5", key: "BACKSLASH", value: "C:\\tmp\\app" },
        { id: "var-6", key: "PADDED", value: "  padded  " },
        { id: "var-7", key: "EMPTY", value: "" },
      ],
    };

    const generated = generateProjectEnvContent(config);

    expect(generated).toBe([
      "SAFE=simple",
      "HASH=\"abc # def\"",
      "SPACE=\"hello world\"",
      "QUOTE=\"say \\\"hi\\\"\"",
      "BACKSLASH=\"C:\\\\tmp\\\\app\"",
      "PADDED=\"  padded  \"",
      "EMPTY=",
      "",
    ].join("\n"));
    expect(parseProjectEnvContent(generated)).toEqual([
      { key: "SAFE", value: "simple" },
      { key: "HASH", value: "abc # def" },
      { key: "SPACE", value: "hello world" },
      { key: "QUOTE", value: "say \"hi\"" },
      { key: "BACKSLASH", value: "C:\\tmp\\app" },
      { key: "PADDED", value: "  padded  " },
      { key: "EMPTY", value: "" },
    ]);
  });

  it("validates empty, invalid, and duplicated keys", () => {
    const result = validateProjectEnvConfig({
      variables: [
        { id: "var-1", key: "", value: "" },
        { id: "var-2", key: "API KEY", value: "" },
        { id: "var-3", key: "TOKEN", value: "" },
        { id: "var-4", key: "TOKEN", value: "" },
        { id: "var-5", key: "MULTILINE", value: "one\ntwo" },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Variable keys cannot be empty.");
    expect(result.errors).toContain("API KEY is not a valid environment variable key.");
    expect(result.errors).toContain("TOKEN is duplicated.");
    expect(result.errors).toContain("MULTILINE value cannot contain line breaks.");
  });

  it("normalizes parsed config and counts variables", () => {
    const parsed = parseProjectEnvConfig({
      variables: [
        { id: "var-1", key: " API_KEY ", value: "secret", comment: "  Token  " },
      ],
    });

    expect(parsed).toEqual({
      variables: [
        { id: "var-1", key: "API_KEY", value: "secret", comment: "Token" },
      ],
    });
    expect(countProjectEnvVariables(parsed ?? { variables: [] })).toBe(1);
  });
});
