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
import { serverUrlFor } from "@/hooks/useConnection";
import { WelcomeScreen } from "./screens/WelcomeScreen";
import { NetworkScreen } from "./screens/NetworkScreen";
import { SshKeyScreen } from "./screens/SshKeyScreen";
import { ConnectScreen } from "./screens/ConnectScreen";
import { ReadyScreen } from "./screens/ReadyScreen";
import { AccountsScreen } from "./screens/AccountsScreen";
import { InstallScreen, type InstallResult } from "./screens/InstallScreen";

interface InstallerProps {
  /** Injectable for tests; defaults to the desktop shell's SSH sidecar. */
  client?: ProvisionClient;
  /**
   * Leave the installer and show the ordinary app. The installer needs this
   * whatever it started from: its last screen runs after the connection has
   * been stored, so it is the installer, not the app, that decides when the
   * layer comes down.
   */
  onClose?: () => void;
  /**
   * Offer to abandon the installer from the welcome screen. Only true when a
   * server is already configured — with none, the welcome screen's second path
   * is the only way out.
   */
  cancellable?: boolean;
}

/**
 * The installer, a layer in front of the app and the only "not configured"
 * state there is. It never replaces the app with a reduced variant: once it is
 * done it simply stops being rendered.
 */
export default function Installer({
  client: injectedClient,
  onClose,
  cancellable,
}: InstallerProps) {
  const client = useMemo(() => injectedClient ?? createProvisionClient(), [injectedClient]);
  const [machine, dispatch] = useReducer(reduce, undefined, loadMachine);
  // Held for the length of one install and deliberately never persisted.
  const [escalationPassword, setEscalationPassword] = useState<string | undefined>(undefined);
  // What the install reported, kept only for the final screen: it addresses the
  // new server directly rather than through the stored connection.
  const [installed, setInstalled] = useState<InstallResult | null>(null);

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
   * The installer is done: the ordinary app takes over. The stored record is
   * wiped and reset to its pristine state, so reopening it starts from the
   * welcome screen rather than resuming a flow that no longer applies.
   */
  const finish = useCallback(() => {
    clearMachine();
    dispatch({ type: "reset" });
    setInstalled(null);
    onClose?.();
  }, [onClose]);

  const { state, inputs } = machine;

  /**
   * The install succeeded: the server it just built becomes the one server this
   * client talks to, and the flow moves on to connecting accounts on it.
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
   *
   * The run registry is cleared here rather than at the end: the install is
   * over, and nothing on the final screen may re-attach to it.
   */
  const complete = useCallback(
    async (result: InstallResult) => {
      const { host, user } = parseAddress(inputs.address);
      await switchServer({
        host,
        port: inputs.port,
        authToken: result.accessToken,
        sshUser: result.serviceUser,
        adminUser: user ?? "root",
      });
      clearInstallRuns();
      setInstalled(result);
      advance();
    },
    [inputs.address, inputs.port, advance],
  );

  let screen: React.ReactNode = null;
  switch (state) {
    case "welcome":
      screen = (
        <WelcomeScreen
          onInstall={() => advance()}
          onConnected={finish}
          {...(cancellable && onClose ? { onCancel: onClose } : {})}
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
    case "accounts":
      // `installed` is set in the same update that lands here, and a relaunch
      // resumes on welcome rather than on a screen whose credentials are gone,
      // so the null branch is unreachable in practice.
      screen =
        installed === null ? null : (
          <AccountsScreen
            target={{
              baseUrl: serverUrlFor({ host: parseAddress(inputs.address).host, port: inputs.port }),
              authToken: installed.accessToken,
            }}
            accessToken={installed.accessToken}
            onFinish={finish}
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
