import { useCallback, useEffect, useMemo, useReducer } from "react";
import {
  reduce,
  loadMachineState,
  saveMachineState,
  clearMachineState,
  type SetupInputs,
} from "@/pages/setup/machine";
import type { SetupErrorCode } from "@hive/shared/setup-errors";
import { createProvisionClient, type ProvisionClient } from "@/lib/provision-client";
import { saveSshConnection } from "@/lib/ssh-connection";
import { useServerUrl } from "@/hooks/useServerUrl";
import { useTailscaleConfig } from "@/hooks/useTailscaleConfig";
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
  const { setIp, setPort, setSshUser } = useTailscaleConfig();
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

  const serverBaseUrl = inputs.serverIp
    ? `http://${inputs.serverIp}:${DEFAULT_PORT}`
    : "";

  const finish = useCallback(() => {
    // Commit the runtime connection details to the app's stores.
    // v1 installs are token-less (network access = tailnet or LAN, plus the
    // backend's host-header guard); clear any token left from a previous
    // connection so requests don't send a stale bearer.
    if (inputs.serverIp) {
      setServerUrl(`http://${inputs.serverIp}:${DEFAULT_PORT}`);
      // Prefill Settings > Connection with the freshly-installed server.
      setIp(inputs.serverIp);
      setPort(String(DEFAULT_PORT));
      setSshUser(inputs.sshUser ?? "");
    }
    setAuthToken("");
    // Keep the SSH details so Settings > Connection can push backend updates later.
    if (inputs.serverIp && inputs.sshKeyPath) {
      saveSshConnection({
        host: inputs.serverIp,
        keyPath: inputs.sshKeyPath,
        user: inputs.sshUser,
        tailnet: Boolean(inputs.tailscaleAuthKey),
      });
    }
    clearMachineState();
    onComplete?.();
  }, [inputs, setServerUrl, setIp, setPort, setSshUser, setAuthToken, onComplete]);

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
        <ServerChoiceScreen onContinue={() => advance()} onBack={back} onContinueLater={continueLater} />
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
          initialValue={inputs.sshUser && inputs.serverIp ? `${inputs.sshUser}@${inputs.serverIp}` : inputs.serverIp}
          onContinue={(serverIp, hostFingerprint, hostKeys, sshUser) =>
            advance({ serverIp, hostFingerprint, hostKeys, sshUser })
          }
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
          hostKeys={inputs.hostKeys ?? []}
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
            user: inputs.sshUser,
            keyPath: inputs.sshKeyPath ?? "",
            tailscaleAuthKey: inputs.tailscaleAuthKey ?? "",
            port: DEFAULT_PORT,
          }}
          onDone={(tailnetIp) => {
            // The wizard's TOFU ran against the pre-tailnet address; trust the
            // tailnet IP too so later SSH (updates) passes strict checking.
            if (tailnetIp) void client.trustHost(tailnetIp);
            advance(tailnetIp ? { serverIp: tailnetIp } : undefined);
          }}
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
          onContinue={() => advance()}
          onBack={back}
          onContinueLater={continueLater}
        />
      );
      break;
    case "ios_pairing":
      screen = (
        <IosPairingScreen
          host={inputs.serverIp ?? ""}
          port={DEFAULT_PORT}
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
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Draggable strip: the window titlebar is overlaid, so the fullscreen
          wizard must provide its own drag region. */}
      <div className="h-10 shrink-0" data-tauri-drag-region />
      <div className="min-h-0 flex-1 overflow-auto">
        {/* Global error panel: rendered above the current screen when a step fails
            outside the provisioning screen's own inline panel. */}
        {error && error.state !== "provisioning" && (
          <div className="mx-auto max-w-xl px-6 pt-6">
            <ErrorPanel error={error} onDismiss={() => dispatch({ type: "clearError" })} />
          </div>
        )}
        {screen}
      </div>
    </div>
  );
}

export default SetupWizard;
