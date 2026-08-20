import { Loader2, LogOut, ExternalLink, AlertCircle, CheckCircle2, Terminal, XCircle } from "lucide-react";
import { Github } from "@react-symbols/icons";
import { SettingsHeader } from "@/components/AppLayout";
import { CenterCard } from "@/components/CenterCard";
import { SettingsPanel, SettingsSection } from "@/components/settings/SettingsSection";
import { cn } from "@/lib/utils";
import { openExternal } from "@/lib/open-external";
import { SignInPrompt } from "@/components/setup/SignInPrompt";
import { useGithubAccount } from "@/components/setup/useGithubAccount";

export default function AccountSettings() {
  // No target: this page always talks to the connected server.
  const { state, connect, cancelConnect, disconnect, retry, disconnecting } = useGithubAccount();

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <SettingsHeader>
        <h1 className="text-sm font-medium">Account</h1>
      </SettingsHeader>

      <CenterCard scroll>
        {state.kind === "loading" ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-5 w-5 motion-safe:animate-spin text-muted-foreground" />
          </div>
        ) : (
          <SettingsPanel>
            {state.kind === "no-gh" && (
              <SettingsSection>
                <div className="flex items-start gap-3">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" />
                  <div>
                    <h2 className="text-sm font-medium">GitHub CLI not found</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      The GitHub CLI (<code className="rounded bg-muted px-1 py-0.5 text-[11px]">gh</code>) is required but was not found on the server.
                    </p>
                    <button
                      type="button"
                      onClick={() => void openExternal("https://cli.github.com")}
                      className="mt-3 inline-flex cursor-pointer items-center gap-1.5 text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm"
                    >
                      Install GitHub CLI
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </SettingsSection>
            )}

            {state.kind === "disconnected" && (
              <SettingsSection>
                <div className="flex flex-col items-center py-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/50">
                    <Github className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <h2 className="mt-3 text-sm font-medium">Not connected</h2>
                  <p className="mt-1 text-center text-xs text-muted-foreground">
                    Connect your GitHub account to enable PR tracking and automatic git credentials.
                  </p>
                  <button
                    type="button"
                    onClick={connect}
                    className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-md bg-[#24292f] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#24292f]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    <Github className="h-3.5 w-3.5" />
                    Connect with GitHub
                  </button>
                </div>
              </SettingsSection>
            )}

            {state.kind === "connecting" && (
              <SettingsSection
                title="Enter this code on GitHub"
                description="Copy the code below and enter it at the GitHub verification page."
              >
                <SignInPrompt
                  verificationUri={state.verificationUri}
                  userCode={state.userCode}
                  onCancel={cancelConnect}
                />
              </SettingsSection>
            )}

            {state.kind === "connected" && (
              <SettingsSection>
                <div className="flex items-center gap-4">
                  {state.user.avatarUrl ? (
                    <img
                      src={state.user.avatarUrl}
                      alt={`${state.user.login}'s avatar`}
                      className="h-16 w-16 rounded-full"
                    />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                      <Github className="h-8 w-8 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <h2 className="text-base font-semibold">
                      {state.user.name || state.user.login}
                    </h2>
                    {state.user.email && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{state.user.email}</p>
                    )}
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <Github className="h-3 w-3" />
                      {state.user.login}
                    </p>
                  </div>
                </div>
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={disconnect}
                    disabled={disconnecting}
                    className={cn(
                      "inline-flex cursor-pointer items-center gap-2 rounded-md border border-border/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                      disconnecting && "pointer-events-none opacity-60",
                    )}
                  >
                    {disconnecting
                      ? <Loader2 className="h-3 w-3 motion-safe:animate-spin" />
                      : <LogOut className="h-3 w-3" />}
                    Disconnect
                  </button>
                </div>
              </SettingsSection>
            )}

            {state.kind === "error" && (
              <SettingsSection role="alert">
                <div className="flex items-start gap-3">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <div>
                    <h2 className="text-sm font-medium">Something went wrong</h2>
                    <p className="mt-1 text-xs text-muted-foreground">{state.message}</p>
                    {state.retryable && (
                      <button
                        type="button"
                        onClick={retry}
                        className="mt-3 inline-flex cursor-pointer items-center gap-1.5 text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm"
                      >
                        Try again
                      </button>
                    )}
                  </div>
                </div>
              </SettingsSection>
            )}

            {/* GitHub CLI integration status */}
            <SettingsSection>
              <div className="flex items-start gap-3">
                {state.kind === "connected" ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-foreground" />
                ) : state.kind === "no-gh" ? (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                ) : (
                  <Terminal className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <div>
                  <h2 className="text-sm font-medium">GitHub CLI integration</h2>
                  {state.kind === "connected" && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Authenticated and ready.
                    </p>
                  )}
                  {state.kind === "no-gh" && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      GitHub CLI (<code className="rounded bg-muted px-1 py-0.5 text-[11px]">gh</code>) is not installed.
                    </p>
                  )}
                  {(state.kind === "disconnected" || state.kind === "connecting" || state.kind === "error") && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      GitHub CLI is installed but not authenticated.
                    </p>
                  )}
                </div>
              </div>
            </SettingsSection>
          </SettingsPanel>
        )}
      </CenterCard>
    </div>
  );
}
