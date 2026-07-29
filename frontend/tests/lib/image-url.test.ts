import { describe, expect, it, beforeEach } from "vitest";
import { replaceConnection } from "@/hooks/useConnection";

import { resolveApiResourceSrc, resolveImageSrc } from "@/lib/image-url";

beforeEach(() => {
  localStorage.clear();
  replaceConnection({ host: "192.168.1.10", port: 3000 });
});

describe("resolveImageSrc", () => {
  it("returns base64 data URLs unchanged", () => {
    const dataUrl = "data:image/png;base64,iVBOR...";
    expect(resolveImageSrc(dataUrl)).toBe(dataUrl);
  });

  it("returns empty string unchanged", () => {
    expect(resolveImageSrc("")).toBe("");
  });

  it("prepends server URL for /api/ paths", () => {
    const path = "/api/workspaces/ws1/sessions/s1/attachments/abc.png";
    expect(resolveImageSrc(path)).toBe(`http://192.168.1.10:3000${path}`);
  });

  it("appends the connection token as a query param", () => {
    replaceConnection({ host: "192.168.1.10", port: 3000, authToken: "my-secret" });
    const path = "/api/workspaces/ws1/sessions/s1/attachments/abc.png";
    const result = resolveImageSrc(path);
    expect(result).toContain("?token=my-secret");
    expect(result.startsWith("http://192.168.1.10:3000/api/")).toBe(true);
  });

  it("does not append token param when the record carries none", () => {
    const path = "/api/workspaces/ws1/sessions/s1/attachments/abc.png";
    expect(resolveImageSrc(path)).not.toContain("token=");
  });
});

describe("resolveApiResourceSrc", () => {
  it("adds auth tokens before URL fragments", () => {
    replaceConnection({ host: "192.168.1.10", port: 3000, authToken: "secret token" });
    const path = "/api/brain/file/raw?path=docs%2Fspec.pdf#navpanes=0";

    expect(resolveApiResourceSrc(path)).toBe(
      "http://192.168.1.10:3000/api/brain/file/raw?path=docs%2Fspec.pdf&token=secret%20token#navpanes=0",
    );
  });
});
