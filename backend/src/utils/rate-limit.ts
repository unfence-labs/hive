import type { FastifyReply, FastifyRequest } from "fastify";

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  exemptPrefixes?: string[];
}

interface Bucket {
  count: number;
  resetAt: number;
}

function nowMs(): number {
  return Date.now();
}

export function createRateLimitHook(config: RateLimitConfig) {
  const { maxRequests, windowMs, exemptPrefixes = ["/health"] } = config;
  const buckets = new Map<string, Bucket>();

  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (exemptPrefixes.some((prefix) => req.url.startsWith(prefix))) return;

    const key = req.ip || "unknown";
    const now = nowMs();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, {
        count: 1,
        resetAt: now + windowMs,
      });
      return;
    }

    bucket.count += 1;
    if (bucket.count <= maxRequests) return;

    const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    reply.header("Retry-After", String(retryAfterSec));
    reply.status(429).send({
      error: `Rate limit exceeded. Retry in ${retryAfterSec}s.`,
    });

    // Lightweight cleanup to avoid unbounded growth under long uptime.
    if (buckets.size > 10_000) {
      for (const [bucketKey, value] of buckets) {
        if (value.resetAt <= now) buckets.delete(bucketKey);
      }
    }
  };
}
