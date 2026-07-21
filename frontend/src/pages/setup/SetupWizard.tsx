import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import {
  reduce,
  loadMachineState,
  saveMachineState,
  clearMachineState,
  type SetupInputs,
} from "@/pages/setup/machine";
import type { SetupErrorCode } from "@hive/shared/setup-errors";
import { createProvisionClient, type ProvisionClient } from "@/lib/provision-client";
import { switchServer } from "@/lib/server-connection";

import { WelcomeScreen } from "./screens/WelcomeScreen";
import { TailscaleKeyScreen } from "./screens/TailscaleKeyScreen";
import { SshKeyScreen } from "./screens/SshKeyScreen";
import { ServerIpScreen } from "./screens/ServerIpScreen";
import { HostTrustScreen } from "./screens/HostTrustScreen";
import { ProvisioningScreen } from "./screens/ProvisioningScreen";
import { TailnetHandoffScreen } from "./screens/TailnetHandoffScreen";
import { GuidedSetupScreen } from "./screens/GuidedSetupScreen";
import { DoneScreen } from "./screens/DoneScreen";
import { ErrorPanel } from "./screens/ErrorPanel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const DEFAULT_PORT = 3000;

interface SetupWizardProps {
  /** Injectable for tests; defaults to the runtime-appropriate client. */
  client?: ProvisionClient;
  /** Called when the wizard completes and the app should proceed. */
  onComplete?: () => void;
  /** Leaves provisioning and opens the existing-server connection form. */
  onConnectExisting?: () => void;
}

export function SetupWizard({ client: injectedClient, onComplete, onConnectExisting }: SetupWizardProps) {
  const client = useMemo(() => injectedClient ?? createProvisionClient(), [injectedClient]);
  const [machine, dispatch] = useReducer(reduce, undefined, loadMachineState);

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
  const [confirmingStartOver, setConfirmingStartOver] = useState(false);
  const startOver = useCallback(() => setConfirmingStartOver(true), []);
  const fail = useCallback(
    (code: SetupErrorCode, logExcerpt?: string) => dispatch({ type: "fail", error: { code, logExcerpt } }),
    [],
  );

  const { state, inputs, error } = machine;

  const serverBaseUrl = inputs.serverIp
    ? `http://${inputs.serverIp}:${DEFAULT_PORT}`
    : "";

  const finish = useCallback(async () => {
    if (!inputs.serverIp) return;
    try {
      await switchServer({
        host: inputs.serverIp,
        port: DEFAULT_PORT,
        sshUser: inputs.sshUser,
      });
      clearMachineState();
      onComplete?.();
    } catch (caught) {
      fail("UNKNOWN", caught instanceof Error ? caught.message : String(caught));
    }
  }, [fail, inputs.serverIp, inputs.sshUser, onComplete]);

  let screen: React.ReactNode;
  switch (state) {
    case "welcome":
      screen = (
        <WelcomeScreen
          onContinue={() => advance()}
          onConnectExisting={onConnectExisting}
        />
      );
      break;
    case "tailscale":
      screen = (
        <TailscaleKeyScreen
          initialValue={inputs.tailscaleAuthKey}
          onContinue={(tailscaleAuthKey, skipTailscale) =>
            advance({ tailscaleAuthKey, skipTailscale })
          }
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
    case "server":
      screen = (
        <ServerIpScreen
          client={client}
          initialValue={inputs.sshUser && inputs.serverIp ? `${inputs.sshUser}@${inputs.serverIp}` : inputs.serverIp}
          onContinue={(serverIp, hostFingerprint, hostKey, sshUser) =>
            advance({ serverIp, hostFingerprint, hostKey, sshUser })
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
          hostKey={inputs.hostKey ?? ""}
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
            skipTailscale: inputs.skipTailscale ?? false,
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
          client={inputs.skipTailscale ? undefined : client}
          host={inputs.serverIp ?? ""}
          expectedHostKey={inputs.hostKey}
          baseUrl={serverBaseUrl}
          onContinue={() => advance()}
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
    case "done":
      screen = (
        <DoneScreen
          serverHost={inputs.serverIp}
          serverPort={DEFAULT_PORT}
          onFinish={() => void finish()}
        />
      );
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
        {error && (
          <div className="mx-auto max-w-xl px-6 pt-6">
            <ErrorPanel error={error} onDismiss={() => dispatch({ type: "clearError" })} />
          </div>
        )}
        {screen}
      </div>

      <AlertDialog open={confirmingStartOver} onOpenChange={setConfirmingStartOver}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start the setup over?</AlertDialogTitle>
            <AlertDialogDescription>
              The saved wizard progress and Tailscale key are discarded.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmingStartOver(false);
                dispatch({ type: "reset" });
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Start over
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default SetupWizard;
