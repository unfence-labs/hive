import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_DATA_DIR,
  DEFAULT_INSTALL_DIR,
  INSTALLER_SCHEMA,
  INSTALLER_STORAGE_KEY,
  canGoBack,
  clearMachine,
  initialMachine,
  isUsableAddress,
  isUsableDirectory,
  loadMachine,
  nextState,
  parseAddress,
  previousState,
  reduce,
  saveMachine,
} from "@/pages/installer/machine";
import { DEFAULT_BACKEND_PORT } from "@/lib/server-connection";

describe("installer machine", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts on welcome with the production port and the script's own defaults", () => {
    const machine = initialMachine();

    expect(machine.state).toBe("welcome");
    // 3000 is the development port and must never be offered here.
    expect(machine.inputs.port).toBe(9420);
    expect(DEFAULT_BACKEND_PORT).toBe(9420);
    expect(machine.inputs.installDir).toBe(DEFAULT_INSTALL_DIR);
    expect(machine.inputs.dataDir).toBe(DEFAULT_DATA_DIR);
  });

  it("walks the sequence forward and back, and back is available everywhere but welcome", () => {
    expect(nextState("welcome")).toBe("network");
    expect(nextState("network")).toBe("ssh_key");
    expect(nextState("ssh_key")).toBe("connect");
    expect(previousState("connect")).toBe("ssh_key");
    expect(previousState("welcome")).toBe("welcome");

    expect(canGoBack("welcome")).toBe(false);
    for (const state of ["network", "ssh_key", "connect", "install"] as const) {
      expect(canGoBack(state)).toBe(true);
    }
  });

  it("keeps collected inputs when stepping back and forward", () => {
    let machine = reduce(initialMachine(), { type: "advance" });
    machine = reduce(machine, { type: "advance", inputs: { address: "root@203.0.113.10" } });
    machine = reduce(machine, { type: "back" });

    expect(machine.state).toBe("network");
    expect(machine.inputs.address).toBe("root@203.0.113.10");
  });

  it("resumes where it stopped", () => {
    let machine = reduce(initialMachine(), { type: "advance" });
    machine = reduce(machine, { type: "advance", inputs: { address: "203.0.113.10", port: 9999 } });
    saveMachine(machine);

    const resumed = loadMachine();
    expect(resumed.state).toBe("ssh_key");
    expect(resumed.inputs.address).toBe("203.0.113.10");
    expect(resumed.inputs.port).toBe(9999);
  });

  it("starts over rather than resuming a record it cannot trust", () => {
    localStorage.setItem(INSTALLER_STORAGE_KEY, "not json");
    expect(loadMachine().state).toBe("welcome");

    localStorage.setItem(
      INSTALLER_STORAGE_KEY,
      JSON.stringify({ schema: INSTALLER_SCHEMA + 1, state: "connect", inputs: {} }),
    );
    expect(loadMachine().state).toBe("welcome");

    localStorage.setItem(
      INSTALLER_STORAGE_KEY,
      JSON.stringify({ schema: INSTALLER_SCHEMA, state: "no-such-screen", inputs: {} }),
    );
    expect(loadMachine().state).toBe("welcome");
  });

  it("resumes onto connect rather than past it, since the password was not kept", () => {
    saveMachine({
      schema: INSTALLER_SCHEMA,
      state: "install",
      inputs: { ...initialMachine().inputs, address: "ops@203.0.113.10" },
    });

    expect(loadMachine().state).toBe("connect");
  });

  it("resumes straight back into an install that reaches root without a password", () => {
    for (const privilegeMode of ["root", "sudoNoPassword"] as const) {
      for (const state of ["review", "install"] as const) {
        saveMachine({
          schema: INSTALLER_SCHEMA,
          state,
          inputs: { ...initialMachine().inputs, address: "root@203.0.113.10", privilegeMode },
        });

        expect(loadMachine().state).toBe(state);
      }
    }
  });

  it("sends an install that needs the escalation password back to connect", () => {
    for (const state of ["review", "install"] as const) {
      saveMachine({
        schema: INSTALLER_SCHEMA,
        state,
        inputs: {
          ...initialMachine().inputs,
          address: "ops@203.0.113.10",
          privilegeMode: "sudoPassword",
        },
      });

      expect(loadMachine().state).toBe("connect");
    }
  });

  it("never persists an escalation password, because it never holds one", () => {
    let machine = reduce(initialMachine(), { type: "advance" });
    machine = reduce(machine, { type: "patch", inputs: { address: "root@203.0.113.10" } });
    saveMachine(machine);

    expect(localStorage.getItem(INSTALLER_STORAGE_KEY)).not.toMatch(/password/i);
  });

  it("clears the record", () => {
    saveMachine(initialMachine());
    clearMachine();
    expect(localStorage.getItem(INSTALLER_STORAGE_KEY)).toBeNull();
  });

  it("splits an optional user off the address", () => {
    expect(parseAddress(" root@203.0.113.10 ")).toEqual({ host: "203.0.113.10", user: "root" });
    expect(parseAddress("hive.example.com")).toEqual({ host: "hive.example.com" });
    expect(parseAddress("root@[2001:db8::1]")).toEqual({ host: "2001:db8::1", user: "root" });
    expect(parseAddress("@host")).toEqual({ host: "host" });
  });

  it("refuses addresses and directories the sidecar would refuse", () => {
    expect(isUsableAddress("203.0.113.10")).toBe(true);
    expect(isUsableAddress("ops_2@server.example.com")).toBe(true);
    expect(isUsableAddress("root@[2001:db8::1]")).toBe(true);
    expect(isUsableAddress("")).toBe(false);
    expect(isUsableAddress("-oProxyCommand=bad")).toBe(false);
    expect(isUsableAddress("host name")).toBe(false);
    expect(isUsableAddress("2root@host")).toBe(false);

    expect(isUsableDirectory("/opt/hive")).toBe(true);
    expect(isUsableDirectory("opt/hive")).toBe(false);
    expect(isUsableDirectory("/opt/../etc")).toBe(false);
    expect(isUsableDirectory("/opt/hive;rm")).toBe(false);
    expect(isUsableDirectory("/")).toBe(false);
  });
});
