import { describe, expect, it, vi } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createRateLimitHook } from "./rate-limit.js";

function createReq(url: string, ip = "127.0.0.1"): FastifyRequest {
  return { url, ip } as FastifyRequest;
}

function createReply() {
  const headers = new Map<string, string>();
  const reply = {
    statusCode: 200,
    body: undefined as unknown,
    header(name: string, value: string) {
      headers.set(name, value);
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send(payload: unknown) {
      this.body = payload;
      return this;
    },
  };

  return {
    reply: reply as unknown as FastifyReply,
    getHeader: (name: string) => headers.get(name),
    getStatus: () => reply.statusCode,
    getBody: () => reply.body,
  };
}

describe("createRateLimitHook", () => {
  it("allows requests up to the configured limit then blocks", async () => {
    const hook = createRateLimitHook({ maxRequests: 2, windowMs: 60_000 });

    for (let i = 0; i < 2; i++) {
      const { reply, getStatus } = createReply();
      await hook(createReq("/api/projects"), reply);
      expect(getStatus()).toBe(200);
    }

    const blocked = createReply();
    await hook(createReq("/api/projects"), blocked.reply);
    expect(blocked.getStatus()).toBe(429);
    expect(blocked.getBody()).toEqual(
      expect.objectContaining({
        error: expect.stringContaining("Rate limit exceeded"),
      }),
    );
    expect(blocked.getHeader("Retry-After")).toBeDefined();
  });

  it("resets counters when the window passes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-11T00:00:00.000Z"));

    const hook = createRateLimitHook({ maxRequests: 1, windowMs: 1000 });
    const req = createReq("/api/projects");

    const first = createReply();
    await hook(req, first.reply);
    expect(first.getStatus()).toBe(200);

    const second = createReply();
    await hook(req, second.reply);
    expect(second.getStatus()).toBe(429);

    vi.advanceTimersByTime(1001);

    const third = createReply();
    await hook(req, third.reply);
    expect(third.getStatus()).toBe(200);

    vi.useRealTimers();
  });

  it("skips exempt paths", async () => {
    const hook = createRateLimitHook({ maxRequests: 1, windowMs: 60_000 });
    const req = createReq("/health");

    const first = createReply();
    await hook(req, first.reply);
    expect(first.getStatus()).toBe(200);

    const second = createReply();
    await hook(req, second.reply);
    expect(second.getStatus()).toBe(200);
  });
});
