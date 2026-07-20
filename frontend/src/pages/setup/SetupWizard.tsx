import { useCallback, useEffect, useMemo, useReducer } from "react";
import {
  reduce,
  loadMachineState,
  saveMachineState,
  clearMachineState,
  type SetupInputs,
} from "@/pages/setup/machine";
import type { SetupErrorCode } from "@hive/shared/setup-errors";
import type { PairingPayload } from "@hive/shared/setup-types";
import { createProvisionClient, type ProvisionClient } from "@/lib/provision-client";
import { useServerUrl } from "@/hooks/useServerUrl";
import { useAuthToken } from "@/hooks/useAuthToken";

import { WelcomeScreen } from "./screens/WelcomeScreen";
import { TailscaleIntroScreen } from "./screens/TailscaleIntroScreen";
import { TailscaleKeyScreen } from "./screens/TailscaleKeyScreen";
import { ServerChoiceScreen } from "./screens/ServerChoiceScreen";
import { SshKeyScreen } from "./screens/SshKeyScreen";
import { ServerIpScreen } from "./screens/ServerIpScreen";
import { HostTrustScreen } from "./screens/HostTrustScreen";
import { ProvisioningScreen } from "./screens/ProvisioningScreen";
import { TailnetHandoffScreen } from "./screens/TailnetHandoffScreen";
import { GuidedSetupScreen } from "./screens/GuidedSetupScreen";
import { IosPairingScreen } from "./screens/IosPairingScreen";
import { DoneScreen } from "./screens/DoneScreen";
import { ErrorPanel } from "./screens/ErrorPanel";

const DEFAULT_PORT = 3000;

/** Generate a URL-safe HIVE_AUTH_TOKEN locally, before install (§ security model). */
export function generateAuthToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let str = "";
  for (const b of bytes) str += b.toString(16).padStart(2, "0");
  return `hive_${str}`;
}

interface SetupWizardProps {
  /** Injectable for tests; defaults to the runtime-appropriate client. */
  client?: ProvisionClient;
  /** Called when the wizard completes and the app should proceed. */
  onComplete?: () => void;
}

export function SetupWizard({ client: injectedClient, onComplete }: SetupWizardProps) {
  const client = useMemo(() => injectedClient ?? createProvisionClient(), [injectedClient]);
  const [machine, dispatch] = useReducer(reduce, undefined, loadMachineState);
  const { setServerUrl } = useServerUrl();
  const { setAuthToken } = useAuthToken();

  // Persist on every change so a reload resumes mid-flow.
  useEffect(() => {
    saveMachineState(machine);
  }, [machine]);

  const advance = useCallback(
    (inputs?: Partial<SetupInputs>) => dispatch({ type: "advance", inputs }),
    [],
  );
  const back = useCallback(() => dispatch({ type: "back" }), []);
  const continueLater = useCallback(() => {
    // State is already persisted; hand control back to the app.
    onComplete?.();
  }, [onComplete]);
  const startOver = useCallback(() => {
    if (
      window.confirm(
        "Start the setup over from the beginning? This install's progress is discarded (the Tailscale key and SSH key choice are kept).",
      )
    ) {
      dispatch({ type: "reset" });
    }
  }, []);
  const fail = useCallback(
    (code: SetupErrorCode, logExcerpt?: string) => dispatch({ type: "fail", error: { code, logExcerpt } }),
    [],
  );

  const { state, inputs, error } = machine;

  // Ensure an auth token exists once we start collecting server details.
  useEffect(() => {
    if (state === "tailscale_key" && !inputs.authToken) {
      dispatch({ type: "setInputs", inputs: { authToken: generateAuthToken() } });
    }
  }, [state, inputs.authToken]);

  const serverBaseUrl = inputs.serverIp
    ? `http://${inputs.serverIp}:${DEFAULT_PORT}`
    : "";

  const finish = useCallback(() => {
    // Commit the runtime connection details to the app's stores.
    if (inputs.serverIp) setServerUrl(`http://${inputs.serverIp}:${DEFAULT_PORT}`);
    if (inputs.authToken) setAuthToken(inputs.authToken);
    clearMachineState();
    onComplete?.();
  }, [inputs.serverIp, inputs.authToken, setServerUrl, setAuthToken, onComplete]);

  const pairingPayload: PairingPayload = {
    v: 1,
    host: inputs.serverIp ?? "",
    port: DEFAULT_PORT,
    token: inputs.authToken ?? "",
    name: "Hive",
  };

  let screen: React.ReactNode;
  switch (state) {
    case "welcome":
      screen = <WelcomeScreen onContinue={() => advance()} />;
      break;
    case "tailscale_intro":
      screen = (
        <TailscaleIntroScreen onContinue={() => advance()} onBack={back} onContinueLater={continueLater} />
      );
      break;
    case "tailscale_key":
      screen = (
        <TailscaleKeyScreen
          initialValue={inputs.tailscaleAuthKey}
          onContinue={(tailscaleAuthKey) => advance({ tailscaleAuthKey })}
          onBack={back}
          onContinueLater={continueLater}
        />
      );
      break;
    case "server_choice":
      screen = (
        <ServerChoiceScreen
          initialValue={inputs.serverChoice}
          onContinue={(serverChoice) => advance({ serverChoice })}
          onBack={back}
          onContinueLater={continueLater}
        />
      );
      break;
    case "ssh_key":
      screen = (
        <SshKeyScreen
          client={client}
          initialValue={inputs.sshKeyPath}
          onContinue={(sshKeyPath) => advance({ sshKeyPath })}
          onBack={back}
          onContinueLater={continueLater}
        />
      );
      break;
    case "server_ip":
      screen = (
        <ServerIpScreen
          client={client}
          keyPath={inputs.sshKeyPath ?? ""}
          initialValue={inputs.serverIp}
          onContinue={(serverIp, hostFingerprint) => advance({ serverIp, hostFingerprint })}
          onBack={back}
          onContinueLater={continueLater}
          onError={fail}
        />
      );
      break;
    case "host_trust":
      screen = (
        <HostTrustScreen
          client={client}
          host={inputs.serverIp ?? ""}
          fingerprint={inputs.hostFingerprint ?? ""}
          onContinue={() => advance()}
          onBack={back}
          onContinueLater={continueLater}
        />
      );
      break;
    case "provisioning":
      screen = (
        <ProvisioningScreen
          client={client}
          params={{
            host: inputs.serverIp ?? "",
            keyPath: inputs.sshKeyPath ?? "",
            tailscaleAuthKey: inputs.tailscaleAuthKey ?? "",
            authToken: inputs.authToken ?? "",
            port: DEFAULT_PORT,
          }}
          onDone={(tailnetIp) => advance(tailnetIp ? { serverIp: tailnetIp } : undefined)}
          onBack={back}
          onStartOver={startOver}
          onContinueLater={continueLater}
        />
      );
      break;
    case "tailnet_handoff":
      screen = (
        <TailnetHandoffScreen
          baseUrl={serverBaseUrl}
          onContinue={() => advance()}
          onBack={back}
          onContinueLater={continueLater}
        />
      );
      break;
    case "guided_setup":
      screen = (
        <GuidedSetupScreen
          client={client}
          baseUrl={serverBaseUrl}
          authToken={inputs.authToken ?? ""}
          onContinue={() => advance()}
          onBack={back}
          onContinueLater={continueLater}
        />
      );
      break;
    case "ios_pairing":
      screen = (
        <IosPairingScreen
          payload={pairingPayload}
          onContinue={() => advance()}
          onBack={back}
          onSkip={() => advance()}
        />
      );
      break;
    case "done":
      screen = <DoneScreen serverHost={inputs.serverIp} onFinish={finish} />;
      break;
    default:
      screen = null;
  }

  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-background">
      {/* Global error panel: rendered above the current screen when a step fails
          outside the provisioning screen's own inline panel. */}
      {error && error.state !== "provisioning" && (
        <div className="mx-auto max-w-xl px-6 pt-6">
          <ErrorPanel error={error} onDismiss={() => dispatch({ type: "clearError" })} />
        </div>
      )}
      {screen}
    </div>
  );
}

export default SetupWizard;
