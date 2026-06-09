import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock getServerUrl and env before importing
vi.mock("@/hooks/useServerUrl", () => ({
  getServerUrl: vi.fn(() => "http://192.168.1.10:3000"),
}));

import { resolveApiResourceSrc, resolveImageSrc } from "@/lib/image-url";

beforeEach(() => {
  import.meta.env.VITE_HIVE_AUTH_TOKEN = "";
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

  it("appends auth token as query param when set", () => {
    import.meta.env.VITE_HIVE_AUTH_TOKEN = "my-secret";
    const path = "/api/workspaces/ws1/sessions/s1/attachments/abc.png";
    const result = resolveImageSrc(path);
    expect(result).toContain("?token=my-secret");
    expect(result.startsWith("http://192.168.1.10:3000/api/")).toBe(true);
  });

  it("does not append token param when token is empty", () => {
    import.meta.env.VITE_HIVE_AUTH_TOKEN = "";
    const path = "/api/workspaces/ws1/sessions/s1/attachments/abc.png";
    expect(resolveImageSrc(path)).not.toContain("token=");
  });
});

describe("resolveApiResourceSrc", () => {
  it("adds auth tokens before URL fragments", () => {
    import.meta.env.VITE_HIVE_AUTH_TOKEN = "secret token";
    const path = "/api/brain/file/raw?path=docs%2Fspec.pdf#navpanes=0";

    expect(resolveApiResourceSrc(path)).toBe(
      "http://192.168.1.10:3000/api/brain/file/raw?path=docs%2Fspec.pdf&token=secret%20token#navpanes=0",
    );
  });
});
