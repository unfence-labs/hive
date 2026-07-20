import { describe, expect, it } from "vitest";
import { createMockProvisionClient, ndjsonToEvent } from "@/lib/provision-client";
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
    const events = await collect(
      client.resumeProvision({ host: "h", keyPath: "/k", tailscaleAuthKey: "", authToken: "t" }),
    );
    expect(events.some((e) => e.kind === "step_skip")).toBe(true);
    expect(events.at(-1)).toMatchObject({ kind: "run_end", status: "ok" });
  });

  it("lists keys and tests a connection", async () => {
    const client = createMockProvisionClient("happy");
    expect((await client.listKeys()).length).toBeGreaterThan(0);
    expect(await client.testConnection("h", "k")).toEqual({ fingerprint: "SHA256:mock-fingerprint" });
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

describe("ndjsonToEvent (Rust sidecar → wizard normalization)", () => {
  it("maps run lifecycle lines", () => {
    expect(
      ndjsonToEvent({ seq: 0, event: "run_start", runId: "r1", scriptVersion: "1", resume: false, stepsPlanned: ["a"] }),
    ).toEqual({ kind: "run_start", seq: 0, runId: "r1", scriptVersion: "1", resume: false, stepsPlanned: ["a"] });
    expect(ndjsonToEvent({ seq: 9, event: "run_end", status: "ok" })).toMatchObject({
      kind: "run_end",
      status: "ok",
    });
  });

  it("keeps errorCode and detail on an SSH-level run_end error", () => {
    expect(
      ndjsonToEvent({ seq: -1, event: "run_end", status: "error", errorCode: "SSH_AUTH_FAILED", detail: "denied" }),
    ).toMatchObject({ kind: "run_end", status: "error", errorCode: "SSH_AUTH_FAILED", detail: "denied" });
  });

  it("maps step lifecycle statuses", () => {
    expect(ndjsonToEvent({ seq: 1, step: "install_node", status: "start", title: "Node" })).toEqual({
      kind: "step_start",
      seq: 1,
      step: "install_node",
      title: "Node",
    });
    expect(ndjsonToEvent({ seq: 2, step: "install_node", status: "log", line: "…" })).toMatchObject({ kind: "step_log" });
    expect(ndjsonToEvent({ seq: 3, step: "install_node", status: "ok", durationMs: 10 })).toMatchObject({
      kind: "step_ok",
      durationMs: 10,
    });
    expect(ndjsonToEvent({ seq: 4, step: "x", status: "skip", reason: "already-satisfied" })).toMatchObject({
      kind: "step_skip",
    });
    expect(
      ndjsonToEvent({ seq: 5, step: "tailscale_up", status: "error", errorCode: "TS_AUTHKEY_INVALID", exitCode: 1 }),
    ).toMatchObject({ kind: "step_error", errorCode: "TS_AUTHKEY_INVALID" });
  });

  it("ignores lines with neither event nor step", () => {
    expect(ndjsonToEvent({ seq: 7 })).toBeNull();
  });
});
