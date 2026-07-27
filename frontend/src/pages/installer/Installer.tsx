import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import {
  clearMachine,
  loadMachine,
  reduce,
  saveMachine,
  type InstallerInputs,
} from "@/pages/installer/machine";
import { createProvisionClient, type ProvisionClient } from "@/lib/provision-client";
import { WelcomeScreen } from "./screens/WelcomeScreen";
import { NetworkScreen } from "./screens/NetworkScreen";
import { SshKeyScreen } from "./screens/SshKeyScreen";
import { ConnectScreen } from "./screens/ConnectScreen";
import { ReadyScreen } from "./screens/ReadyScreen";

interface InstallerProps {
  /** Injectable for tests; defaults to the desktop shell's SSH sidecar. */
  client?: ProvisionClient;
  /**
   * Leave the installer. Only passed when a server is already configured — with
   * no server, the welcome screen's second path is the only way out.
   */
  onClose?: () => void;
}

/**
 * The installer, a layer in front of the app and the only "not configured"
 * state there is. It never replaces the app with a reduced variant: once a
 * server is configured it simply stops being rendered.
 */
export default function Installer({ client: injectedClient, onClose }: InstallerProps) {
  const client = useMemo(() => injectedClient ?? createProvisionClient(), [injectedClient]);
  const [machine, dispatch] = useReducer(reduce, undefined, loadMachine);
  // Held for the length of one install and deliberately never persisted.
  const [escalationPassword, setEscalationPassword] = useState<string | undefined>(undefined);

  // Persist on every change, so closing the app resumes where it stopped.
  useEffect(() => {
    saveMachine(machine);
  }, [machine]);

  const advance = useCallback(
    (inputs?: Partial<InstallerInputs>) => dispatch({ type: "advance", inputs }),
    [],
  );
  const back = useCallback(() => dispatch({ type: "back" }), []);

  /**
   * A configured server ends the installer. The stored record is wiped and
   * reset to its pristine state, so reopening it starts from the welcome
   * screen rather than resuming a flow that no longer applies.
   */
  const finish = useCallback(() => {
    clearMachine();
    dispatch({ type: "reset" });
    onClose?.();
  }, [onClose]);

  const { state, inputs } = machine;

  let screen: React.ReactNode = null;
  switch (state) {
    case "welcome":
      screen = (
        <WelcomeScreen
          onInstall={() => advance()}
          onConnected={finish}
          {...(onClose ? { onCancel: onClose } : {})}
        />
      );
      break;
    case "network":
      screen = <NetworkScreen inputs={inputs} onContinue={advance} onBack={back} />;
      break;
    case "ssh_key":
      screen = (
        <SshKeyScreen client={client} inputs={inputs} onContinue={advance} onBack={back} />
      );
      break;
    case "connect":
      screen = (
        <ConnectScreen
          client={client}
          inputs={inputs}
          onContinue={(values, password) => {
            setEscalationPassword(password);
            advance(values);
          }}
          onBack={back}
        />
      );
      break;
    case "install":
      screen = (
        <ReadyScreen
          inputs={inputs}
          escalates={escalationPassword !== undefined}
          onBack={back}
        />
      );
      break;
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* The window titlebar is overlaid, so a fullscreen layer must provide
          its own drag region. */}
      <div className="h-10 shrink-0" data-tauri-drag-region />
      <div className="min-h-0 flex-1 overflow-auto">{screen}</div>
    </div>
  );
}
