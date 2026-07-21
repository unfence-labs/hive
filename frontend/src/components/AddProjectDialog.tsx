import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogDescription,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { api } from "@/hooks/useApi";
import { useBrain } from "@/hooks/useBrain";

type DialogMode = "clone" | "create" | "brain";

interface AccountStatus {
  ghInstalled: boolean;
  authenticated: boolean;
  user?: { login: string };
}

interface AddProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClone: (url: string) => Promise<{ id: string; warning?: string } | void>;
  onCreate: (params: {
    name: string;
    visibility?: "public" | "private";
  }) => Promise<{ id: string; warning?: string } | void>;
}

// Must match backend REPO_NAME_RE in backend/src/utils/github.ts
const REPO_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;

export default function AddProjectDialog({
  open,
  onOpenChange,
  onClone,
  onCreate,
}: AddProjectDialogProps) {
  const navigate = useNavigate();
  const { brain, createBrain } = useBrain();

  // ── Shared state ─────────────────────────────────────────────────
  const [mode, setMode] = useState<DialogMode>("clone");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  // ── Clone state ──────────────────────────────────────────────────
  const [url, setUrl] = useState("");

  // ── Create state ─────────────────────────────────────────────────
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("private");

  // ── Reset form state when dialog closes ────────────────────────────
  useEffect(() => {
    if (!open) {
      setUrl("");
      setName("");
      setVisibility("private");
      setMode("clone");
      setError(null);
      setWarning(null);
    }
  }, [open]);

  // ── GitHub status (only fetched when Create mode is active) ──────
  const { data: account } = useQuery({
    queryKey: ["account", "status"],
    queryFn: () => api.get<AccountStatus>("/api/account/status"),
    staleTime: 5 * 60_000,
    enabled: open && (mode === "create" || mode === "brain"),
  });

  const ghConnected = account?.authenticated === true;

  // ── Validation ───────────────────────────────────────────────────
  const nameError =
    name.length > 0 && !REPO_NAME_RE.test(name.toLowerCase())
      ? "Lowercase letters, numbers, hyphens, underscores, and dots only"
      : null;

  const canSubmitClone = url.trim().length > 0;
  const canSubmitCreate = name.trim().length > 0 && !nameError;
  const canSubmitBrain = brain.exists || (canSubmitCreate && ghConnected);

  // ── Handlers ─────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      let result: { id: string; warning?: string } | void;
      if (mode === "clone") {
        result = await onClone(url.trim());
      } else if (mode === "brain") {
        if (brain.exists) {
          onOpenChange(false);
          navigate("/brain");
          return;
        }
        await createBrain({ name: name.trim().toLowerCase() });
        setName("");
        setMode("clone");
        onOpenChange(false);
        navigate("/brain");
        return;
      } else {
        result = await onCreate({
          name: name.trim().toLowerCase(),
          visibility: ghConnected ? visibility : undefined,
        });
      }
      // Reset form on success
      setUrl("");
      setName("");
      setVisibility("private");
      setMode("clone");
      if (result?.warning) {
        setWarning(result.warning);
      } else {
        onOpenChange(false);
      }
      if (result) navigate(`/workspaces/${result.id}`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong",
      );
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (next: DialogMode) => {
    setMode(next);
    setError(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === "clone"
              ? "Add Project"
              : mode === "brain"
                ? brain.exists ? "Open Brain" : "Brain"
                : "Create Project"}
          </DialogTitle>
          <DialogDescription>
            {mode === "clone"
              ? "Enter the Git repository URL to clone into Hive."
              : mode === "brain"
                ? "Create or open your private Brain repository."
                : "Create a new Git repository and start working."}
          </DialogDescription>
        </DialogHeader>

        {/* ── Mode toggle ────────────────────────────────────────── */}
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {(["clone", "create", "brain"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                mode === m
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m === "clone"
                ? "Clone existing"
                : m === "brain"
                  ? brain.exists ? "Open Brain" : "Brain"
                  : "Create new"}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          {mode === "clone" ? (
            /* ── Clone form ──────────────────────────────────────── */
            <Input
              placeholder="https://github.com/user/repo.git"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={loading}
              autoFocus
            />
          ) : mode === "brain" ? (
            <div className="space-y-4">
              {brain.exists ? (
                <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                  <p className="text-sm font-medium text-foreground">Brain already exists</p>
                  <p className="mt-1 break-all text-xs text-muted-foreground">
                    {brain.repoUrl}
                  </p>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="brain-repo-name" className="text-xs font-medium text-muted-foreground">
                      Repository name
                    </Label>
                    <Input
                      id="brain-repo-name"
                      placeholder="my-brain"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      disabled={loading}
                      autoFocus
                    />
                    {nameError && (
                      <p className="text-xs text-destructive">{nameError}</p>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {account === undefined ? (
                      <span>Checking GitHub connection...</span>
                    ) : ghConnected ? (
                      <span>
                        <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-success" />
                        Private GitHub repository as{" "}
                        <span className="font-medium text-foreground">@{account.user?.login}</span>
                      </span>
                    ) : (
                      <span className="text-warning-foreground">
                        GitHub connection required - connect an account in Settings.
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          ) : (
            /* ── Create form ─────────────────────────────────────── */
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="repo-name" className="text-xs font-medium text-muted-foreground">
                  Repository name
                </Label>
                <Input
                  id="repo-name"
                  placeholder="my-new-project"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={loading}
                  autoFocus
                />
                {nameError && (
                  <p className="text-xs text-destructive">{nameError}</p>
                )}
              </div>

              {ghConnected && (
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground">
                    Visibility
                  </Label>
                  <RadioGroup
                    value={visibility}
                    onValueChange={(v) => setVisibility(v as "public" | "private")}
                    className="flex gap-4"
                  >
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="private" id="vis-private" />
                      <Label htmlFor="vis-private" className="text-sm font-normal">
                        Private
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="public" id="vis-public" />
                      <Label htmlFor="vis-public" className="text-sm font-normal">
                        Public
                      </Label>
                    </div>
                  </RadioGroup>
                </div>
              )}

              {/* ── GitHub status indicator ───────────────────────── */}
              <div className="text-xs text-muted-foreground">
                {account === undefined ? (
                  <span>Checking GitHub connection...</span>
                ) : ghConnected ? (
                  <span>
                    <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-success" />
                    Connected as <span className="font-medium text-foreground">@{account.user?.login}</span>
                  </span>
                ) : (
                  <span className="text-warning-foreground">
                    GitHub not connected — will create local only
                  </span>
                )}
              </div>
            </div>
          )}

          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
          {warning && (
            <div className="mt-2 rounded-md bg-warning-muted px-3 py-2 text-sm text-warning-foreground">
              {warning}
            </div>
          )}

          <DialogFooter className="mt-4">
            {warning ? (
              <Button type="button" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={loading}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={
                    loading ||
                    (mode === "clone"
                      ? !canSubmitClone
                      : mode === "brain"
                        ? !canSubmitBrain
                        : !canSubmitCreate)
                  }
                >
                  {loading
                    ? mode === "clone"
                      ? "Adding…"
                      : "Creating…"
                    : mode === "clone"
                      ? "Add"
                      : mode === "brain" && brain.exists
                        ? "Open Brain"
                        : "Create"}
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
