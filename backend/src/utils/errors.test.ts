import { describe, expect, it } from "vitest";
import { errorMessage } from "./errors.js";

describe("errorMessage", () => {
  it("returns Error.message for Error instances", () => {
    expect(errorMessage(new Error("boom"), "fallback")).toBe("boom");
  });

  it("returns fallback for non-Error values", () => {
    expect(errorMessage("boom", "fallback")).toBe("fallback");
    expect(errorMessage({ message: "boom" }, "fallback")).toBe("fallback");
  });

  it("returns fallback for nullish values", () => {
    expect(errorMessage(undefined, "fallback")).toBe("fallback");
    expect(errorMessage(null, "fallback")).toBe("fallback");
  });
});
