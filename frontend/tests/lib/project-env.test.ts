import { describe, expect, it } from "vitest";
import {
  countProjectEnvVariables,
  generateProjectEnvContent,
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

  it("validates empty, invalid, and duplicated keys", () => {
    const result = validateProjectEnvConfig({
      variables: [
        { id: "var-1", key: "", value: "" },
        { id: "var-2", key: "API KEY", value: "" },
        { id: "var-3", key: "TOKEN", value: "" },
        { id: "var-4", key: "TOKEN", value: "" },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Variable keys cannot be empty.");
    expect(result.errors).toContain("API KEY is not a valid environment variable key.");
    expect(result.errors).toContain("TOKEN is duplicated.");
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
