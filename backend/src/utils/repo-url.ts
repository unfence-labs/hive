export interface ValidateRepoUrlOptions {
  allowLocalPath?: boolean;
}

const SCP_LIKE_GIT_RE = /^[^@\s]+@[^:\s]+:[^\s]+$/;
const WINDOWS_PATH_RE = /^[A-Za-z]:\\/;

function hasWhitespace(value: string): boolean {
  return /\s/.test(value);
}

export function validateRepositoryUrl(
  raw: string,
  options: ValidateRepoUrlOptions = {}
): string {
  if (!raw || typeof raw !== "string") {
    throw new Error("Invalid repository URL");
  }

  const url = raw.trim();
  if (!url) throw new Error("Invalid repository URL");
  if (hasWhitespace(url)) throw new Error("Repository URL cannot contain whitespace");

  if (url.startsWith("file://")) {
    throw new Error("file:// repository URLs are not allowed");
  }

  const allowLocal = options.allowLocalPath === true;
  const localLikePath = url.startsWith("/") || url.startsWith("./") || url.startsWith("../")
    || WINDOWS_PATH_RE.test(url) || url.startsWith("~/");
  if (localLikePath && !allowLocal) {
    throw new Error("Local repository paths are not allowed");
  }

  if (localLikePath && allowLocal) return url;

  if (SCP_LIKE_GIT_RE.test(url)) return url;

  if (url.includes("://")) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("Invalid repository URL");
    }

    const allowedProtocols = new Set(["https:", "ssh:"]);
    if (!allowedProtocols.has(parsed.protocol)) {
      throw new Error(`Unsupported repository URL protocol: ${parsed.protocol}`);
    }
    if (!parsed.hostname) throw new Error("Repository URL must include a host");
    if (!parsed.pathname || parsed.pathname === "/") {
      throw new Error("Repository URL must include a repository path");
    }
    return url;
  }

  throw new Error("Unsupported repository URL format");
}
