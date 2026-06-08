import { basename } from "node:path";

const RAW_FILE_MIME_BY_EXT: Record<string, string> = {
  apng: "image/apng",
  avif: "image/avif",
  avifs: "image/avif",
  bmp: "image/bmp",
  cur: "image/x-icon",
  gif: "image/gif",
  heic: "image/heic",
  heics: "image/heic-sequence",
  heif: "image/heif",
  heifs: "image/heif-sequence",
  ico: "image/x-icon",
  jfif: "image/jpeg",
  jif: "image/jpeg",
  jp2: "image/jp2",
  jpe: "image/jpeg",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  jxl: "image/jxl",
  png: "image/png",
  psd: "image/vnd.adobe.photoshop",
  svg: "image/svg+xml",
  svgz: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  webp: "image/webp",
  xcf: "image/x-xcf",
  pdf: "application/pdf",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  oga: "audio/ogg",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  wav: "audio/wav",
  weba: "audio/webm",
  m4v: "video/mp4",
  mov: "video/quicktime",
  mp4: "video/mp4",
  ogv: "video/ogg",
  webm: "video/webm",
};

export function rawFileContentType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return RAW_FILE_MIME_BY_EXT[ext] ?? "application/octet-stream";
}

export function headerFilename(path: string): string {
  return basename(path).replace(/[\r\n"]/g, "_");
}
