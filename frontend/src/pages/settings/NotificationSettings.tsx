import { useState, useSyncExternalStore, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Send, Save, Loader2 } from "lucide-react";
import { SettingsHeader } from "@/components/AppLayout";
import { CenterCard } from "@/components/CenterCard";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { api } from "@/hooks/useApi";

interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  chatId: string;
}

interface NotificationsConfig {
  telegram: TelegramConfig;
}

type Feedback = { type: "success" | "error"; message: string } | null;

const defaultTelegram: TelegramConfig = { enabled: false, botToken: "", chatId: "" };

export default function NotificationSettings() {
  const query = useQuery({
    queryKey: ["settings", "notifications"],
    queryFn: () => api.get<NotificationsConfig>("/api/settings/notifications"),
  });

  if (query.isLoading) return null;

  const telegram = query.data?.telegram ?? defaultTelegram;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <SettingsHeader>
        <h1 className="text-sm font-medium">Notifications</h1>
      </SettingsHeader>

      <CenterCard scroll>
      <div className="max-w-2xl space-y-6 px-4 py-5">
        <LocalToastsSection />
        <TelegramForm initial={telegram} />
      </div>
      </CenterCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared hook — mutation plumbing for a notification channel
// ---------------------------------------------------------------------------

function useNotificationChannel(opts: {
  initialEnabled: boolean;
  buildSavePayload: (enabled: boolean) => Record<string, unknown>;
  testUrl: string;
  buildTestPayload: () => Record<string, unknown>;
  testSuccessMsg: string;
}) {
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(opts.initialEnabled);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const clearFeedback = () => setFeedback(null);
  const showFeedback = (fb: Feedback) => {
    setFeedback(fb);
    if (fb?.type === "success") setTimeout(clearFeedback, 2500);
  };

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["settings", "notifications"] });

  const toggleMutation = useMutation({
    mutationFn: (newEnabled: boolean) =>
      api.put("/api/settings/notifications", opts.buildSavePayload(newEnabled)),
    onSuccess: invalidate,
    onError: (_: unknown, newEnabled: boolean) => {
      setEnabled(!newEnabled);
      showFeedback({ type: "error", message: "Failed to toggle" });
    },
  });

  const handleToggle = (v: boolean) => {
    setEnabled(v);
    clearFeedback();
    toggleMutation.mutate(v);
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      api.put("/api/settings/notifications", opts.buildSavePayload(enabled)),
    onMutate: clearFeedback,
    onSuccess: () => { invalidate(); showFeedback({ type: "success", message: "Saved" }); },
    onError: () => showFeedback({ type: "error", message: "Failed to save" }),
  });

  const testMutation = useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; error?: string }>(opts.testUrl, opts.buildTestPayload()),
    onMutate: clearFeedback,
    onSuccess: (result) => {
      showFeedback(result.ok
        ? { type: "success", message: opts.testSuccessMsg }
        : { type: "error", message: result.error ?? "Test failed" });
    },
    onError: () => showFeedback({ type: "error", message: "Could not reach backend" }),
  });

  return {
    enabled, handleToggle, clearFeedback, feedback,
    saving: saveMutation.isPending,
    testing: testMutation.isPending,
    onSave: () => saveMutation.mutate(),
    onTest: () => testMutation.mutate(),
  };
}

// ---------------------------------------------------------------------------
// Local toasts — localStorage-backed toggle
// ---------------------------------------------------------------------------

const LOCAL_TOASTS_KEY = "hive:local-toasts-enabled";

const localToastsListeners = new Set<() => void>();

export function getLocalToastsEnabled(): boolean {
  try {
    return localStorage.getItem(LOCAL_TOASTS_KEY) !== "false";
  } catch {
    return true;
  }
}

function setLocalToastsEnabled(v: boolean) {
  localStorage.setItem(LOCAL_TOASTS_KEY, String(v));
  localToastsListeners.forEach((fn) => fn());
}

export function useLocalToastsEnabled(): boolean {
  return useSyncExternalStore(
    (cb) => { localToastsListeners.add(cb); return () => { localToastsListeners.delete(cb); }; },
    getLocalToastsEnabled,
  );
}

function LocalToastsSection() {
  const enabled = useLocalToastsEnabled();
  return (
    <NotificationSection
      id="local-toasts"
      title="In-App Toasts"
      description="Show toast notifications when agents finish in background workspaces."
      enabled={enabled}
      onToggle={setLocalToastsEnabled}
    >
      <div />
    </NotificationSection>
  );
}

// ---------------------------------------------------------------------------
// Shared section wrapper (toggle header + card chrome)
// ---------------------------------------------------------------------------

function NotificationSection({ id, title, description, enabled, onToggle, children }: {
  id: string;
  title: string;
  description: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border/50 bg-card/50 p-5">
      <div className="flex items-start justify-between">
        <div>
          <h2 id={`${id}-toggle-label`} className="text-sm font-medium text-foreground">{title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <Toggle id={`${id}-toggle-label`} enabled={enabled} onChange={onToggle} />
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Toggle component
// ---------------------------------------------------------------------------

function Toggle({ id, enabled, onChange }: { id: string; enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-labelledby={id}
      onClick={() => onChange(!enabled)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        enabled ? "bg-primary" : "bg-muted-foreground/30",
      )}
    >
      <span
        className={cn(
          "pointer-events-none block h-4 w-4 rounded-full bg-primary-foreground shadow-sm transition-transform",
          enabled ? "translate-x-4" : "translate-x-0",
        )}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Telegram
// ---------------------------------------------------------------------------

function TelegramForm({ initial }: { initial: TelegramConfig }) {
  const [botToken, setBotToken] = useState(initial.botToken);
  const [chatId, setChatId] = useState(initial.chatId);
  const [showToken, setShowToken] = useState(false);

  const channel = useNotificationChannel({
    initialEnabled: initial.enabled,
    buildSavePayload: (en) => ({ telegram: { enabled: en, botToken, chatId } }),
    testUrl: "/api/settings/notifications/test",
    buildTestPayload: () => ({ botToken, chatId }),
    testSuccessMsg: "Test message sent!",
  });

  const hasCredentials = botToken.trim() !== "" && chatId.trim() !== "";

  return (
    <NotificationSection
      id="telegram"
      title="Telegram"
      description="Receive notifications via a Telegram bot."
      enabled={channel.enabled}
      onToggle={channel.handleToggle}
    >
      <div className={cn("mt-5 space-y-4 transition-opacity", !channel.enabled && "pointer-events-none opacity-50")}>
        <div>
          <label htmlFor="tg-token" className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Bot Token
          </label>
          <div className="relative">
            <Input
              id="tg-token"
              type={showToken ? "text" : "password"}
              value={botToken}
              onChange={(e) => { setBotToken(e.target.value); channel.clearFeedback(); }}
              placeholder="123456:ABC-DEF..."
              className="pr-9 font-mono text-xs"
            />
            <button
              type="button"
              onClick={() => setShowToken(!showToken)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
            >
              {showToken
                ? <EyeOff className="h-3.5 w-3.5" />
                : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="tg-chat" className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Chat ID
          </label>
          <Input
            id="tg-chat"
            value={chatId}
            onChange={(e) => { setChatId(e.target.value); channel.clearFeedback(); }}
            placeholder="-1001234567890"
            className="font-mono text-xs"
          />
        </div>
      </div>

      <div className="mt-4">
        <FormActions {...channel} hasCredentials={hasCredentials} />
      </div>
    </NotificationSection>
  );
}

// ---------------------------------------------------------------------------
// Shared form actions
// ---------------------------------------------------------------------------

function FormActions({
  saving, testing, hasCredentials, enabled, onTest, onSave, feedback,
}: {
  saving: boolean;
  testing: boolean;
  hasCredentials: boolean;
  enabled: boolean;
  onTest: () => void;
  onSave: () => void;
  feedback: Feedback;
}) {
  const disabled = !enabled;
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onTest}
        disabled={disabled || testing || !hasCredentials}
        className={cn(
          "inline-flex cursor-pointer items-center gap-2 rounded-md border border-border/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground",
          (disabled || testing || !hasCredentials) && "pointer-events-none opacity-60",
        )}
      >
        {testing
          ? <Loader2 className="h-3 w-3 animate-spin" />
          : <Send className="h-3 w-3" />}
        Test
      </button>

      <button
        type="button"
        onClick={onSave}
        disabled={disabled || saving}
        className={cn(
          "inline-flex cursor-pointer items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90",
          (disabled || saving) && "pointer-events-none opacity-60",
        )}
      >
        {saving
          ? <Loader2 className="h-3 w-3 animate-spin" />
          : <Save className="h-3 w-3" />}
        Save
      </button>

      {feedback && (
        <span className={cn(
          "text-xs font-medium",
          feedback.type === "success" ? "text-success-foreground" : "text-destructive",
        )}>
          {feedback.message}
        </span>
      )}
    </div>
  );
}
