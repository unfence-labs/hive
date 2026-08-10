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
import { isDesktopShell } from "@/lib/is-desktop";
import {
  completeConnectionSetup,
  replaceConnection,
  serverUrlFor,
  useConnection,
} from "@/hooks/useConnection";
import { WelcomeScreen } from "./screens/WelcomeScreen";
import { ServerScreen } from "./screens/ServerScreen";
import { ReadyScreen } from "./screens/ReadyScreen";
import { AccountsScreen } from "./screens/AccountsScreen";
import { InstallScreen, type InstallResult } from "./screens/InstallScreen";
import { InstallerScreen } from "./screens/InstallerScreen";

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
 * The installer, and the only "not configured" state there is. At boot with no
 * server it is the whole screen — the app mounts once it finishes — and
 * reopened from Settings it is a layer over the configured app. It never
 * replaces the app with a reduced variant: once it is done it simply stops
 * being rendered.
 */
export default function Installer({
  client: injectedClient,
  onClose,
  cancellable,
}: InstallerProps) {
  // The web build has no SSH sidecar to build a client on — and never reaches
  // the screens that need one, since it cannot start the install path.
  const client = useMemo(
    () => injectedClient ?? (isDesktopShell() ? createProvisionClient() : null),
    [injectedClient],
  );
  const [machine, dispatch] = useReducer(reduce, undefined, loadMachine);
  const { connection } = useConnection();
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
   * The installer is done: the ordinary app takes over. The stored record is
   * wiped and reset to its pristine state, so reopening it starts from the
   * welcome screen rather than resuming a flow that no longer applies.
   */
  const close = useCallback(() => {
    clearMachine();
    dispatch({ type: "reset" });
    onClose?.();
  }, [onClose]);

  const finish = useCallback(() => {
    if (!completeConnectionSetup()) return;
    close();
  }, [close]);

  const restart = useCallback(() => {
    replaceConnection(null);
    clearMachine();
    dispatch({ type: "reset" });
  }, []);

  const { inputs } = machine;
  // The connection write is the durable boundary. Once it says setup is
  // pending, Accounts wins over any stale machine state, including the small
  // crash window before the install screen advances.
  const state = connection?.setupPending ? "accounts" : machine.state;

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
        ...(inputs.sshKeyPath ? { sshKeyPath: inputs.sshKeyPath } : {}),
        setupPending: true,
      });
      clearInstallRuns();
      advance();
    },
    [inputs.address, inputs.port, inputs.sshKeyPath, advance],
  );

  let screen: React.ReactNode = null;
  switch (state) {
    case "welcome":
      screen = (
        <WelcomeScreen
          // The install path runs over the desktop shell's SSH sidecar; the
          // web build only connects to servers that already exist.
          {...(isDesktopShell() ? { onInstall: () => advance() } : {})}
          onConnected={close}
          {...(cancellable && onClose ? { onCancel: onClose } : {})}
        />
      );
      break;
    // The install-path states need the sidecar client. They are unreachable
    // without it — only the desktop shell offers the install path — so the
    // null branches below are types, not flows.
    case "server":
      screen = client === null ? null : (
        <ServerScreen
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
      screen = client === null ? null : (
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
      screen =
        connection?.setupPending && connection.authToken && connection.sshUser ? (
          <AccountsScreen
            target={{
              baseUrl: serverUrlFor(connection),
              authToken: connection.authToken,
            }}
            accessToken={connection.authToken}
            onFinish={finish}
          />
        ) : (
          <InstallerScreen
            title="Setup cannot continue"
            description={
              <span role="alert">
                The saved setup is missing its access token or service account. Connect again to
                restore a usable server connection.
              </span>
            }
            onContinue={restart}
            continueLabel="Connect again"
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
