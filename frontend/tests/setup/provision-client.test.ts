import { describe, expect, it } from "vitest";
import { createMockProvisionClient } from "@/lib/provision-client";
import type { ProvisionEvent } from "@/lib/provision-client";

async function collect(iterable: AsyncIterable<ProvisionEvent>): Promise<ProvisionEvent[]> {
  const out: ProvisionEvent[] = [];
  for await (const e of iterable) out.push(e);
  return out;
}

describe("mock provision client", () => {
  it("replays a happy path ending in run_end ok", async () => {
    const client = createMockProvisionClient("happy");
    const events = await collect(client.startProvision({ host: "h", keyPath: "k", tailscaleAuthKey: "t", authToken: "a" }));
    expect(events[0].kind).toBe("run_start");
    const end = events.at(-1);
    expect(end).toMatchObject({ kind: "run_end", status: "ok" });
    // Strictly monotonic seq.
    for (let i = 1; i < events.length; i++) expect(events[i].seq).toBeGreaterThan(events[i - 1].seq);
  });

  it("replays an error path with a taxonomy error code", async () => {
    const client = createMockProvisionClient("error");
    const events = await collect(client.startProvision({ host: "h", keyPath: "k", tailscaleAuthKey: "t", authToken: "a" }));
    const err = events.find((e) => e.kind === "step_error");
    expect(err).toMatchObject({ kind: "step_error", errorCode: "TS_AUTHKEY_INVALID" });
    expect(events.at(-1)).toMatchObject({ kind: "run_end", status: "error" });
  });

  it("resume replays a run that skips completed steps and succeeds", async () => {
    const client = createMockProvisionClient("error");
    const events = await collect(client.resumeProvision("h"));
    expect(events.some((e) => e.kind === "step_skip")).toBe(true);
    expect(events.at(-1)).toMatchObject({ kind: "run_end", status: "ok" });
  });

  it("lists keys and tests a connection", async () => {
    const client = createMockProvisionClient("happy");
    expect((await client.listKeys()).length).toBeGreaterThan(0);
    expect(await client.testConnection("h", "k")).toEqual({ fingerprint: "SHA256:mock-fingerprint" });
  });

  it("runs local claude auth returning a token", async () => {
    const client = createMockProvisionClient("happy");
    expect((await client.runLocalClaudeAuth()).token).toMatch(/^sk-ant-oat01-/);
  });

  it("accepts a custom script", async () => {
    const client = createMockProvisionClient({
      events: [
        { kind: "run_start", seq: 0, runId: "r", scriptVersion: "1", resume: false, stepsPlanned: ["x"] },
        { kind: "step_ok", seq: 1, step: "x" },
        { kind: "run_end", seq: 2, status: "ok" },
      ],
      connection: { error: "SSH_AUTH_FAILED" },
    });
    expect(await client.testConnection("h", "k")).toEqual({ error: "SSH_AUTH_FAILED" });
    const events = await collect(client.startProvision({ host: "h", keyPath: "k", tailscaleAuthKey: "t", authToken: "a" }));
    expect(events).toHaveLength(3);
  });
});
