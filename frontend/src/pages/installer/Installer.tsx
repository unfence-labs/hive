import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import {
  clearMachine,
  loadMachine,
  parseAddress,
  reduce,
  saveMachine,
  type InstallerInputs,
} from "@/pages/installer/machine";
import { clearInstallRuns } from "@/pages/installer/install-run";
import { createProvisionClient, type ProvisionClient } from "@/lib/provision-client";
import { switchServer } from "@/lib/server-connection";
import { WelcomeScreen } from "./screens/WelcomeScreen";
import { NetworkScreen } from "./screens/NetworkScreen";
import { SshKeyScreen } from "./screens/SshKeyScreen";
import { ConnectScreen } from "./screens/ConnectScreen";
import { ReadyScreen } from "./screens/ReadyScreen";
import { InstallScreen, type InstallResult } from "./screens/InstallScreen";

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

  /**
   * The install succeeded: the server it just built becomes the one server this
   * client talks to, and the installer stops existing.
   *
   * The two accounts are stored apart on purpose. `sshUser` is the unprivileged
   * service account that owns the repositories, and every editor and terminal
   * session must connect as it; `adminUser` is only the login the install ran
   * as, kept so a reinstall knows how to get back in. Conflating them makes the
   * agent's own worktrees root-owned and unwritable.
   *
   * The connection is stored without re-probing it. The run already proved the
   * backend is up and enforcing its token from the server's side; if the port
   * is not reachable from here, Settings says so and can re-test — whereas
   * refusing to store a token that was just generated would strand the operator
   * with an installed server and no way to reach it.
   */
  const complete = useCallback(
    async ({ accessToken, serviceUser }: InstallResult) => {
      const { host, user } = parseAddress(inputs.address);
      await switchServer({
        host,
        port: inputs.port,
        authToken: accessToken,
        sshUser: serviceUser,
        adminUser: user ?? "root",
      });
      clearMachine();
      clearInstallRuns();
      onClose?.();
    },
    [inputs.address, inputs.port, onClose],
  );

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
    case "review":
      screen = (
        <ReadyScreen
          inputs={inputs}
          escalates={escalationPassword !== undefined}
          onContinue={() => advance()}
          onBack={back}
        />
      );
      break;
    case "install":
      screen = (
        <InstallScreen
          client={client}
          inputs={inputs}
          {...(escalationPassword === undefined ? {} : { password: escalationPassword })}
          onComplete={(result) => void complete(result)}
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
