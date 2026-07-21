import { beforeEach, describe, expect, it } from "vitest";
import {
  SETUP_STATES,
  initialMachineState,
  reduce,
  nextState,
  prevState,
  canGoBack,
  loadMachineState,
  saveMachineState,
  clearMachineState,
  SETUP_STATE_STORAGE_KEY,
  SETUP_STATE_SCHEMA,
  type SetupMachineState,
} from "@/pages/setup/machine";

describe("setup machine", () => {
  beforeEach(() => {
    localStorage.removeItem(SETUP_STATE_STORAGE_KEY);
  });

  it("starts at welcome with empty inputs", () => {
    const s = initialMachineState();
    expect(s.state).toBe("welcome");
    expect(s.inputs).toEqual({});
    expect(s.error).toBeNull();
  });

  it("contains only the nine user-facing setup stages", () => {
    expect(SETUP_STATES).toEqual([
      "welcome",
      "tailscale",
      "ssh_key",
      "server",
      "host_trust",
      "provisioning",
      "tailnet_handoff",
      "guided_setup",
      "done",
    ]);
  });

  it("advances through the full flow in order", () => {
    let s = initialMachineState();
    for (let i = 1; i < SETUP_STATES.length; i++) {
      s = reduce(s, { type: "advance" });
      expect(s.state).toBe(SETUP_STATES[i]);
    }
    // At the end, advancing again is a no-op.
    const last = reduce(s, { type: "advance" });
    expect(last.state).toBe("done");
  });

  it("merges inputs on advance", () => {
    let s = initialMachineState();
    s = reduce(s, { type: "advance" }); // tailscale
    s = reduce(s, { type: "advance", inputs: { tailscaleAuthKey: "tskey-auth-x" } });
    expect(s.inputs.tailscaleAuthKey).toBe("tskey-auth-x");
    s = reduce(s, { type: "advance", inputs: { serverIp: "1.2.3.4" } });
    expect(s.inputs.serverIp).toBe("1.2.3.4");
    expect(s.inputs.tailscaleAuthKey).toBe("tskey-auth-x");
  });

  it("goes back but not before welcome and not from done", () => {
    expect(canGoBack("welcome")).toBe(false);
    expect(canGoBack("done")).toBe(false);
    expect(canGoBack("server")).toBe(true);

    let s = initialMachineState();
    s = reduce(s, { type: "advance" });
    s = reduce(s, { type: "advance" }); // ssh_key
    const back = reduce(s, { type: "back" });
    expect(back.state).toBe("tailscale");

    // back at welcome is a no-op
    const atWelcome = reduce(initialMachineState(), { type: "back" });
    expect(atWelcome.state).toBe("welcome");
  });

  it("nextState/prevState are pure and bounded", () => {
    expect(nextState("welcome")).toBe("tailscale");
    expect(nextState("done")).toBe("done");
    expect(prevState("welcome")).toBe("welcome");
    expect(prevState("done")).toBe("guided_setup");
  });

  it("records and clears errors, advance clears error", () => {
    let s = initialMachineState();
    s = reduce(s, { type: "advance" });
    s = reduce(s, { type: "advance" });
    s = reduce(s, { type: "fail", error: { code: "SSH_UNREACHABLE" } });
    expect(s.error).toEqual({ state: "ssh_key", code: "SSH_UNREACHABLE" });
    const cleared = reduce(s, { type: "clearError" });
    expect(cleared.error).toBeNull();
    const advanced = reduce(s, { type: "advance" });
    expect(advanced.error).toBeNull();
  });

  it("reset returns to initial", () => {
    let s = initialMachineState();
    s = reduce(s, { type: "advance", inputs: { serverIp: "1.1.1.1" } });
    const r = reduce(s, { type: "reset" });
    expect(r).toEqual(initialMachineState());
  });

  it("reset keeps only the SSH key choice and drops secrets and server inputs", () => {
    let s = initialMachineState();
    s = reduce(s, {
      type: "advance",
      inputs: {
        tailscaleAuthKey: "tskey-auth-x",
        sshKeyPath: "/home/u/.ssh/id_ed25519",
        serverIp: "1.1.1.1",
        hostFingerprint: "SHA256:abc",
      },
    });
    const r = reduce(s, { type: "reset" });
    expect(r.state).toBe("welcome");
    expect(r.inputs.tailscaleAuthKey).toBeUndefined();
    expect(r.inputs.sshKeyPath).toBe("/home/u/.ssh/id_ed25519");
    expect(r.inputs.serverIp).toBeUndefined();
    expect(r.inputs.hostFingerprint).toBeUndefined();
  });

  describe("persistence", () => {
    it("saves and restores state across reload", () => {
      let s = initialMachineState();
      s = reduce(s, { type: "advance", inputs: { tailscaleAuthKey: "tskey-auth-y" } });
      s = reduce(s, { type: "advance" });
      saveMachineState(s);

      const restored = loadMachineState();
      expect(restored.state).toBe("tailscale");
      expect(restored.inputs.tailscaleAuthKey).toBeUndefined();
      expect(localStorage.getItem(SETUP_STATE_STORAGE_KEY)).not.toContain("tskey-auth-y");
    });

    it("resumes local development and post-provision states without a Tailscale key", () => {
      localStorage.setItem(
        SETUP_STATE_STORAGE_KEY,
        JSON.stringify({
          schema: SETUP_STATE_SCHEMA,
          state: "server",
          inputs: { skipTailscale: true, sshKeyPath: "/key" },
          error: null,
        }),
      );
      expect(loadMachineState().state).toBe("server");

      localStorage.setItem(
        SETUP_STATE_STORAGE_KEY,
        JSON.stringify({
          schema: SETUP_STATE_SCHEMA,
          state: "guided_setup",
          inputs: { serverIp: "100.64.0.1" },
          error: null,
        }),
      );
      expect(loadMachineState().state).toBe("guided_setup");
    });

    it("starts fresh on schema mismatch", () => {
      const stale: SetupMachineState = {
        schema: SETUP_STATE_SCHEMA + 1,
        state: "guided_setup",
        inputs: { serverIp: "9.9.9.9" },
        error: null,
      };
      localStorage.setItem(SETUP_STATE_STORAGE_KEY, JSON.stringify(stale));
      expect(loadMachineState().state).toBe("welcome");
    });

    it("starts fresh on unknown state or corrupt JSON", () => {
      localStorage.setItem(
        SETUP_STATE_STORAGE_KEY,
        JSON.stringify({ schema: SETUP_STATE_SCHEMA, state: "bogus" }),
      );
      expect(loadMachineState().state).toBe("welcome");

      localStorage.setItem(SETUP_STATE_STORAGE_KEY, "{not json");
      expect(loadMachineState().state).toBe("welcome");
    });

    it("clears persisted state", () => {
      saveMachineState(initialMachineState());
      clearMachineState();
      expect(localStorage.getItem(SETUP_STATE_STORAGE_KEY)).toBeNull();
    });
  });
});
