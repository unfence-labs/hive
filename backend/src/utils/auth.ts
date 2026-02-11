import { timingSafeEqual } from "node:crypto";
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

export function isAuthorized(
  headers: Record<string, string | string[] | undefined>,
  expectedToken?: string,
  fallbackToken?: string
): boolean {
  if (!expectedToken) return true;
  const headerToken = extractAuthToken(headers);
  const provided = headerToken ?? fallbackToken?.trim();
  if (!provided) return false;
  return safeEqual(provided, expectedToken);
}

export function createAuthHook(expectedToken?: string) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!expectedToken) return;
    if (req.url.startsWith("/health")) return;
    if (isAuthorized(req.headers, expectedToken)) return;

    reply.status(401).send({ error: "Unauthorized" });
  };
}
