import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(
    (_cmd: string, _args: string[], cb: (...cbArgs: unknown[]) => void) => {
      cb(null, { stdout: "ok", stderr: "" });
    },
  ),
}));

import { execFile } from "node:child_process";
import { meetsMinVersion, preflight } from "./preflight.js";

const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;

describe("meetsMinVersion()", () => {
  it("accepts exact match", () => {
    expect(meetsMinVersion("2.17.0", [2, 17])).toBe(true);
  });

  it("accepts higher minor", () => {
    expect(meetsMinVersion("2.40.1", [2, 17])).toBe(true);
  });

  it("accepts higher major", () => {
    expect(meetsMinVersion("3.0.0", [2, 17])).toBe(true);
  });

  it("rejects lower minor", () => {
    expect(meetsMinVersion("2.16.5", [2, 17])).toBe(false);
  });

  it("rejects lower major", () => {
    expect(meetsMinVersion("1.99.0", [2, 17])).toBe(false);
  });
});

describe("preflight()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("continues when optional dependencies are missing", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      throw new Error(`exit-${String(code)}`);
    }) as never);

    mockExecFile.mockImplementation(
      (cmd: string, _args: string[], cb: (...a: unknown[]) => void) => {
        if (cmd === "codex") {
          cb(new Error("not found"), { stdout: "", stderr: "" });
          return;
        }
        if (cmd === "git") {
          cb(null, { stdout: "git version 2.44.0", stderr: "" });
          return;
        }
        cb(null, { stdout: "1.0.0", stderr: "" });
      },
    );

    await preflight();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("optional: 'codex' not found"));
  });

  it("warns but does not exit when claude is missing (guided setup installs it later)", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      throw new Error(`exit-${String(code)}`);
    }) as never);

    mockExecFile.mockImplementation(
      (cmd: string, _args: string[], cb: (...a: unknown[]) => void) => {
        if (cmd === "claude") {
          cb(new Error("not found"), { stdout: "", stderr: "" });
          return;
        }
        if (cmd === "git") {
          cb(null, { stdout: "git version 2.44.0", stderr: "" });
          return;
        }
        cb(null, { stdout: "1.0.0", stderr: "" });
      },
    );

    await preflight();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("optional: 'claude' not found"));
  });

  it("exits when a required dependency is missing", async () => {
    vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      throw new Error(`exit-${String(code)}`);
    }) as never);

    mockExecFile.mockImplementation(
      (cmd: string, _args: string[], cb: (...a: unknown[]) => void) => {
        if (cmd === "git") {
          cb(new Error("not found"), { stdout: "", stderr: "" });
          return;
        }
        cb(null, { stdout: "1.0.0", stderr: "" });
      },
    );

    await expect(preflight()).rejects.toThrow("exit-1");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("'git' not found"));
  });

  it("exits when git version is below minimum", async () => {
    vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      throw new Error(`exit-${String(code)}`);
    }) as never);

    mockExecFile.mockImplementation(
      (cmd: string, _args: string[], cb: (...a: unknown[]) => void) => {
        if (cmd === "git") {
          cb(null, { stdout: "git version 2.16.9", stderr: "" });
          return;
        }
        cb(null, { stdout: "1.0.0", stderr: "" });
      },
    );

    await expect(preflight()).rejects.toThrow("exit-1");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("git 2.16.9 is too old (need >= 2.17)"));
  });

  it("does not warn when optional CLI exists", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      throw new Error(`exit-${String(code)}`);
    }) as never);

    mockExecFile.mockImplementation(
      (cmd: string, _args: string[], cb: (...a: unknown[]) => void) => {
        if (cmd === "git") {
          cb(null, { stdout: "git version 2.44.0", stderr: "" });
          return;
        }
        cb(null, { stdout: "1.0.0", stderr: "" });
      },
    );

    await preflight();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });
});
