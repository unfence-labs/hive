import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

function safeEqual(left: string, right: string): boolean {
  const leftBuf = Buffer.from(left);
  const rightBuf = Buffer.from(right);
  if (leftBuf.length !== rightBuf.length) return false;
  return timingSafeEqual(leftBuf, rightBuf);
}

function headerString(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length > 0) return value[0];
  return undefined;
}

export function extractAuthToken(
  headers: Record<string, string | string[] | undefined>
): string | undefined {
  const bearer = headerString(headers.authorization);
  if (bearer) {
    const match = bearer.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]) return match[1].trim();
  }

  const xToken = headerString(headers["x-hive-token"]);
  if (xToken?.trim()) return xToken.trim();

  return undefined;
}

/**
 * Auth expectation. Provisioned installs store the token hash-only via
 * `expectedTokenSha256`; legacy manual installs keep the plaintext `expectedToken`.
 * One mode per install, but both are accepted (a hash match still authorizes
 * when only the hash is configured).
 */
export interface AuthExpectation {
  expectedToken?: string;
  /** Lowercase hex SHA-256 of the accepted token. */
  expectedTokenSha256?: string;
}

/** Accept either a bare plaintext token (legacy callers) or a full expectation. */
export type AuthExpectationInput = string | AuthExpectation | undefined;

function normalizeExpectation(input: AuthExpectationInput): AuthExpectation {
  if (input === undefined) return {};
  if (typeof input === "string") return { expectedToken: input };
  return input;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function isAuthorized(
  headers: Record<string, string | string[] | undefined>,
  expectationInput?: AuthExpectationInput,
  fallbackToken?: string
): boolean {
  const expectation = normalizeExpectation(expectationInput);
  const expectedToken = expectation.expectedToken;
  const expectedTokenSha256 = expectation.expectedTokenSha256?.trim().toLowerCase();
  // No expectation configured → open (dev/local default).
  if (!expectedToken && !expectedTokenSha256) return true;

  const headerToken = extractAuthToken(headers);
  const provided = headerToken ?? fallbackToken?.trim();
  if (!provided) return false;

  if (expectedToken && safeEqual(provided, expectedToken)) return true;
  if (expectedTokenSha256 && safeEqual(sha256Hex(provided), expectedTokenSha256)) return true;
  return false;
}

/**
 * Host-header allowlist (anti DNS-rebinding). Token-less installs rely on
 * network reachability (tailnet/LAN); a malicious website resolving its own
 * domain to the backend's IP would carry that domain in the Host header, so
 * only IP literals, localhost, Tailscale MagicDNS names, and explicitly
 * allowed hosts (HIVE_ALLOWED_HOSTS, comma-separated) are accepted.
 */
export function isAllowedHostHeader(
  rawHost: string | undefined,
  extraAllowed: readonly string[] = [],
): boolean {
  if (!rawHost) return false;
  let host = rawHost.trim().toLowerCase();
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    if (end === -1) return false;
    host = host.slice(1, end);
  } else {
    const colon = host.lastIndexOf(":");
    if (colon !== -1 && !host.slice(0, colon).includes(":")) {
      host = host.slice(0, colon);
    }
  }
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  if (host.includes(":") && /^[0-9a-f:]+$/.test(host)) return true;
  if (host.endsWith(".ts.net")) return true;
  return extraAllowed.includes(host);
}

export function createHostGuardHook(extraAllowed: readonly string[] = []) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (req.url.startsWith("/health")) return;
    if (isAllowedHostHeader(headerString(req.headers.host), extraAllowed)) return;
    reply.status(403).send({ error: "Forbidden host" });
  };
}

export function createAuthHook(expectationInput?: AuthExpectationInput) {
  const expectation = normalizeExpectation(expectationInput);
  const enabled = Boolean(expectation.expectedToken || expectation.expectedTokenSha256);
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!enabled) return;
    if (req.url.startsWith("/health")) return;
    // Support ?token= query param for resources loaded via <img src> / AsyncImage
    const queryToken = (req.query as Record<string, string>)?.token;
    if (isAuthorized(req.headers, expectation, queryToken)) return;

    reply.status(401).send({ error: "Unauthorized" });
  };
}
