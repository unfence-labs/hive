export interface ValidateRepoUrlOptions {
  allowLocalPath?: boolean;
}

const SCP_LIKE_GIT_RE = /^[^@\s]+@[^:\s]+:[^\s]+$/;
const WINDOWS_PATH_RE = /^[A-Za-z]:\\/;
const GITHUB_REPOSITORY_PATH_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const GITHUB_SCP_RE = /^git@github\.com:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/i;

function hasWhitespace(value: string): boolean {
  return /\s/.test(value);
}

/**
 * Converts GitHub's SSH clone forms to HTTPS so a server authenticated through
 * `gh auth setup-git` can clone them without a separate SSH credential.
 * Other hosts and SSH shapes are left untouched.
 */
export function normalizeRepositoryUrl(raw: string): string {
  if (typeof raw !== "string") return raw;
  const value = raw.trim();
  const scpMatch = value.match(GITHUB_SCP_RE);
  if (scpMatch) return `https://github.com/${scpMatch[1]}`;

  if (value.startsWith("ssh://")) {
    try {
      const parsed = new URL(value);
      const repositoryPath = parsed.pathname.replace(/^\//, "");
      if (
        parsed.protocol === "ssh:" &&
        parsed.username === "git" &&
        !parsed.password &&
        parsed.hostname.toLowerCase() === "github.com" &&
        (!parsed.port || parsed.port === "22") &&
        !parsed.search &&
        !parsed.hash &&
        GITHUB_REPOSITORY_PATH_RE.test(repositoryPath)
      ) {
        return `https://github.com/${repositoryPath}`;
      }
    } catch {
      // Validation below reports malformed URLs; normalization stays conservative.
    }
  }

  return value;
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
