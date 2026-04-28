import { describe, expect, it } from "vitest";
import { parseBrowserStreamMessage } from "../src/lib/browser-stream";

describe("parseBrowserStreamMessage", () => {
  it("parses jpeg frame messages", () => {
    expect(parseBrowserStreamMessage(JSON.stringify({
      type: "frame",
      data: "abc123",
      metadata: { url: "http://localhost:5173", title: "Hive" },
    }))).toEqual({
      src: "data:image/jpeg;base64,abc123",
      url: "http://localhost:5173",
      title: "Hive",
    });
  });

  it("parses active tab metadata", () => {
    expect(parseBrowserStreamMessage(JSON.stringify({
      type: "tabs",
      tabs: [
        { url: "http://old.local", title: "Old", active: false },
        { url: "http://localhost:5173", title: "Hive", active: true },
      ],
    }))).toEqual({
      url: "http://localhost:5173",
      title: "Hive",
    });
  });

  it("ignores malformed messages", () => {
    expect(parseBrowserStreamMessage("not json")).toBeNull();
  });
});
