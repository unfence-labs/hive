import { describe, expect, it } from "vitest";
import {
  fileExtension,
  isImageFilePath,
  isMarkdownFilePath,
  workspaceFileRawPath,
} from "@/lib/file-preview";

describe("file-preview", () => {
  it("detects common image extensions case-insensitively", () => {
    expect(isImageFilePath("assets/logo.PNG")).toBe(true);
    expect(isImageFilePath("screenshots/home.avif")).toBe(true);
    expect(isImageFilePath("icons/app.svg")).toBe(true);
  });

  it("does not classify files without image extensions as images", () => {
    expect(isImageFilePath("src/app.tsx")).toBe(false);
    expect(isImageFilePath("README.md")).toBe(false);
    expect(isImageFilePath(".env")).toBe(false);
  });

  it("extracts the extension from the basename only", () => {
    expect(fileExtension("docs.v1/avatar.webp")).toBe("webp");
    expect(fileExtension("docs.v1/avatar")).toBe("");
  });

  it("detects markdown extensions case-insensitively", () => {
    expect(isMarkdownFilePath("README.md")).toBe(true);
    expect(isMarkdownFilePath("docs/Guide.MD")).toBe(true);
    expect(isMarkdownFilePath("notes/draft.markdown")).toBe(true);
  });

  it("does not classify non-markdown files as markdown", () => {
    expect(isMarkdownFilePath("src/app.tsx")).toBe(false);
    expect(isMarkdownFilePath("assets/logo.png")).toBe(false);
    expect(isMarkdownFilePath("mdfile")).toBe(false);
  });

  it("builds an encoded raw workspace file path", () => {
    expect(workspaceFileRawPath("ws 1", "assets/my logo.png")).toBe(
      "/api/workspaces/ws%201/file/raw?path=assets%2Fmy%20logo.png",
    );
  });
});
