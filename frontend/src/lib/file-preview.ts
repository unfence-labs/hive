const IMAGE_FILE_EXTENSIONS = new Set([
  "ai",
  "apng",
  "ari",
  "arw",
  "avif",
  "avifs",
  "bay",
  "bmp",
  "braw",
  "cr2",
  "cr3",
  "crw",
  "cur",
  "dcm",
  "dcr",
  "dds",
  "dng",
  "emf",
  "erf",
  "fff",
  "fit",
  "fits",
  "fts",
  "exr",
  "gif",
  "gpr",
  "hdr",
  "heic",
  "heics",
  "heif",
  "heifs",
  "icns",
  "ico",
  "iiq",
  "jfif",
  "jif",
  "jp2",
  "jpe",
  "jpeg",
  "jpg",
  "jxl",
  "k25",
  "kdc",
  "ktx",
  "ktx2",
  "mef",
  "mos",
  "mrw",
  "nef",
  "nrw",
  "orf",
  "pbm",
  "pcx",
  "pef",
  "pgm",
  "pjp",
  "pjpeg",
  "png",
  "pnm",
  "ppm",
  "psb",
  "psd",
  "qoi",
  "raf",
  "raw",
  "rw2",
  "rwl",
  "sr2",
  "srf",
  "srw",
  "svg",
  "svgz",
  "tga",
  "tif",
  "tiff",
  "webp",
  "wmf",
  "xcf",
  "x3f",
]);

export function fileExtension(filePath: string): string {
  const name = filePath.split("/").pop() ?? filePath;
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === name.length - 1) return "";
  return name.slice(dotIndex + 1).toLowerCase();
}

export function isImageFilePath(filePath: string): boolean {
  return IMAGE_FILE_EXTENSIONS.has(fileExtension(filePath));
}

const MARKDOWN_FILE_EXTENSIONS = new Set(["md", "markdown"]);

/**
 * Whether a path points to a Markdown file (`.md`/`.markdown`, case-insensitive).
 * Used to gate the Raw ⇄ Rendered toggle and rendered-preview mode.
 */
export function isMarkdownFilePath(filePath: string): boolean {
  return MARKDOWN_FILE_EXTENSIONS.has(fileExtension(filePath));
}

export function workspaceFileRawPath(wsId: string, filePath: string): string {
  return `/api/workspaces/${encodeURIComponent(wsId)}/file/raw?path=${encodeURIComponent(filePath)}`;
}
