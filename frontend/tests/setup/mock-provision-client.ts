import type {
  ProvisionClient,
  ProvisionEvent,
  SshKey,
  TestConnectionResult,
} from "@/lib/provision-client";

export type MockScenario = "happy" | "error";

export interface MockScript {
  keys?: SshKey[];
  connection?: TestConnectionResult;
  events: ProvisionEvent[];
  retryEvents?: ProvisionEvent[];
  delayMs?: number;
}

const DEFAULT_KEYS: SshKey[] = [
  { path: "/home/user/.ssh/id_ed25519", label: "id_ed25519", type: "ed25519" },
  { path: "/home/user/.ssh/id_rsa", label: "id_rsa", type: "rsa", encrypted: true },
];

const STEPS = [
  ["probe_os", "Check server OS"],
  ["tailscale_up", "Join the tailnet"],
  ["apt_baseline", "Install system packages"],
  ["install_release", "Install the Hive release"],
  ["start_service", "Start Hive"],
] as const;

function happyEvents(resume = false): ProvisionEvent[] {
  let seq = resume ? 100 : 0;
  const events: ProvisionEvent[] = [
    {
      kind: "run_start",
      seq: seq++,
      runId: resume ? "r-mock-retry" : "r-mock",
      scriptVersion: "0.3.0",
      resume,
      stepsPlanned: STEPS.map(([step]) => step),
    },
  ];
  for (const [step, title] of STEPS) {
    events.push({ kind: "step_start", seq: seq++, step, title });
    events.push({ kind: "step_ok", seq: seq++, step, durationMs: 10 });
  }
  events.push({ kind: "run_end", seq: seq++, status: "ok" });
  return events;
}

function errorEvents(): ProvisionEvent[] {
  return [
    {
      kind: "run_start",
      seq: 0,
      runId: "r-mock",
      scriptVersion: "0.3.0",
      resume: false,
      stepsPlanned: STEPS.map(([step]) => step),
    },
    { kind: "step_start", seq: 1, step: "tailscale_up", title: "Join the tailnet" },
    {
      kind: "step_error",
      seq: 2,
      step: "tailscale_up",
      errorCode: "TS_AUTHKEY_INVALID",
      detail: "backend error: invalid key",
    },
    { kind: "run_end", seq: 3, status: "error" },
  ];
}

function scenarioScript(scenario: MockScenario): MockScript {
  return {
    keys: DEFAULT_KEYS,
    connection: {
      fingerprint: "SHA256:mock-fingerprint",
      hostKey: "mock-host ssh-ed25519 AAAA",
    },
    events: scenario === "error" ? errorEvents() : happyEvents(),
    retryEvents: happyEvents(true),
  };
}

export function createMockProvisionClient(
  scenario: MockScenario | MockScript = "happy",
): ProvisionClient {
  const script = typeof scenario === "string" ? scenarioScript(scenario) : scenario;
  let attempts = 0;

  async function* stream(events: ProvisionEvent[]): AsyncIterable<ProvisionEvent> {
    for (const event of events) {
      if (script.delayMs) await new Promise((resolve) => setTimeout(resolve, script.delayMs));
      yield event;
    }
  }

  return {
    async listKeys() {
      return script.keys ?? DEFAULT_KEYS;
    },
    async testConnection() {
      return script.connection ?? {
        fingerprint: "SHA256:mock-fingerprint",
        hostKey: "mock-host ssh-ed25519 AAAA",
      };
    },
    async trustHost() {},
    startProvision() {
      const events = attempts++ === 0 ? script.events : (script.retryEvents ?? script.events);
      return stream(events);
    },
    async cancelProvision() {},
    async startClaudeAuth() {
      return { url: "https://claude.ai/oauth/mock" };
    },
    async completeClaudeAuth() {},
    async pollClaudeAuth() {
      return { token: "sk-ant-oat01-mock", exited: true };
    },
    async cancelClaudeAuth() {},
  };
}
