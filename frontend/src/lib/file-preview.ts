import { BRAIN_WORKSPACE_ID } from "@/lib/brain";

export type FilePreviewKind = "text" | "markdown" | "image" | "pdf" | "audio" | "video";

const BROWSER_IMAGE_FILE_EXTENSIONS = new Set([
  "apng",
  "avif",
  "avifs",
  "bmp",
  "cur",
  "gif",
  "ico",
  "jfif",
  "jif",
  "jp2",
  "jpe",
  "jpeg",
  "jpg",
  "jxl",
  "pjp",
  "pjpeg",
  "png",
  "svg",
  "svgz",
  "webp",
]);

const AUDIO_FILE_EXTENSIONS = new Set(["m4a", "mp3", "oga", "ogg", "opus", "wav", "weba"]);
const VIDEO_FILE_EXTENSIONS = new Set(["m4v", "mov", "mp4", "ogv", "webm"]);

export function fileExtension(filePath: string): string {
  const name = filePath.split("/").pop() ?? filePath;
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === name.length - 1) return "";
  return name.slice(dotIndex + 1).toLowerCase();
}

export function isImageFilePath(filePath: string): boolean {
  return getFilePreviewKind(filePath) === "image";
}

const MARKDOWN_FILE_EXTENSIONS = new Set(["md", "markdown"]);

/**
 * Whether a path points to a Markdown file (`.md`/`.markdown`, case-insensitive).
 * Used to gate the Raw ⇄ Rendered toggle and rendered-preview mode.
 */
export function isMarkdownFilePath(filePath: string): boolean {
  return MARKDOWN_FILE_EXTENSIONS.has(fileExtension(filePath));
}

export function getFilePreviewKind(filePath: string): FilePreviewKind {
  const ext = fileExtension(filePath);
  if (MARKDOWN_FILE_EXTENSIONS.has(ext)) return "markdown";
  if (BROWSER_IMAGE_FILE_EXTENSIONS.has(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (AUDIO_FILE_EXTENSIONS.has(ext)) return "audio";
  if (VIDEO_FILE_EXTENSIONS.has(ext)) return "video";
  return "text";
}

export function isBinaryPreviewFilePath(filePath: string): boolean {
  const kind = getFilePreviewKind(filePath);
  return kind === "image" || kind === "pdf" || kind === "audio" || kind === "video";
}

export function workspaceFileRawPath(wsId: string, filePath: string): string {
  if (wsId === BRAIN_WORKSPACE_ID) {
    return `/api/brain/file/raw?path=${encodeURIComponent(filePath)}`;
  }
  return `/api/workspaces/${encodeURIComponent(wsId)}/file/raw?path=${encodeURIComponent(filePath)}`;
}
