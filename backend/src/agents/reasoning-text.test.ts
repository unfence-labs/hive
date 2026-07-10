import { describe, expect, it } from "vitest";
import {
  cleanReasoningText,
  splitPendingSeparatorTail,
  stripReasoningSeparators,
} from "./reasoning-text.js";

describe("stripReasoningSeparators", () => {
  it("normalizes separators to paragraph breaks", () => {
    expect(stripReasoningSeparators("**First**\n\n<!-- -->\n\nSecond")).toBe("**First**\n\nSecond");
    expect(stripReasoningSeparators("a <!-- --> b")).toBe("a\n\nb");
    expect(stripReasoningSeparators("no marker")).toBe("no marker");
  });
});

describe("cleanReasoningText", () => {
  it("strips separators and trailing whitespace", () => {
    expect(cleanReasoningText("**Headline**\n\n<!-- -->")).toBe("**Headline**");
    expect(cleanReasoningText("<!-- -->")).toBe("");
  });
});

describe("splitPendingSeparatorTail", () => {
  it("emits text that cannot become a separator", () => {
    expect(splitPendingSeparatorTail("plain text")).toEqual({ emit: "plain text", hold: "" });
  });

  it("holds back whitespace and partial markers", () => {
    expect(splitPendingSeparatorTail("done\n\n")).toEqual({ emit: "done", hold: "\n\n" });
    expect(splitPendingSeparatorTail("done\n\n<!-")).toEqual({ emit: "done", hold: "\n\n<!-" });
    expect(splitPendingSeparatorTail("done<!-- -")).toEqual({ emit: "done", hold: "<!-- -" });
    expect(splitPendingSeparatorTail("<!-")).toEqual({ emit: "", hold: "<!-" });
  });

  it("does not hold back dashes without an opening marker", () => {
    expect(splitPendingSeparatorTail("a --")).toEqual({ emit: "a --", hold: "" });
  });
});
