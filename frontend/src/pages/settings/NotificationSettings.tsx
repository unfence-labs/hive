import { useState, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Send, Save, Loader2, Smartphone } from "lucide-react";
import { SettingsHeader } from "@/components/AppLayout";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { api } from "@/hooks/useApi";

interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  chatId: string;
}

interface ApnsConfig {
  enabled: boolean;
  teamId: string;
  keyId: string;
  keyContent: string;
  bundleId: string;
  sandbox: boolean;
  deviceTokens: string[];
}

interface NotificationsConfig {
  telegram: TelegramConfig;
  apns: ApnsConfig;
}

type Feedback = { type: "success" | "error"; message: string } | null;

const defaultTelegram: TelegramConfig = { enabled: false, botToken: "", chatId: "" };
const defaultApns: ApnsConfig = {
  enabled: false, teamId: "", keyId: "", keyContent: "", bundleId: "", sandbox: false, deviceTokens: [],
};

export default function NotificationSettings() {
  const query = useQuery({
    queryKey: ["settings", "notifications"],
    queryFn: () => api.get<NotificationsConfig>("/api/settings/notifications"),
  });

  if (query.isLoading) return null;

  const telegram = query.data?.telegram ?? defaultTelegram;
  const apns = query.data?.apns ?? defaultApns;

  return (
    <div className="flex h-full flex-col overflow-auto">
      <SettingsHeader>
        <h1 className="text-sm font-medium">Notifications</h1>
      </SettingsHeader>

      <div className="max-w-2xl space-y-6 px-4 py-5">
        <TelegramForm initial={telegram} />
        <ApnsForm initial={apns} />
      </div>
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
          "pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
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
// APNs
// ---------------------------------------------------------------------------

function ApnsForm({ initial }: { initial: ApnsConfig }) {
  const [teamId, setTeamId] = useState(initial.teamId);
  const [keyId, setKeyId] = useState(initial.keyId);
  const [keyContent, setKeyContent] = useState(initial.keyContent);
  const [bundleId, setBundleId] = useState(initial.bundleId);
  const [sandbox, setSandbox] = useState(initial.sandbox);
  const [showKey, setShowKey] = useState(false);

  const channel = useNotificationChannel({
    initialEnabled: initial.enabled,
    buildSavePayload: (en) => ({ apns: { enabled: en, teamId, keyId, keyContent, bundleId, sandbox } }),
    testUrl: "/api/settings/notifications/test-apns",
    buildTestPayload: () => ({ teamId, keyId, keyContent, bundleId, sandbox }),
    testSuccessMsg: "Test push sent!",
  });

  const hasCredentials = teamId.trim() !== "" && keyId.trim() !== "" && keyContent.trim() !== "" && bundleId.trim() !== "";
  const deviceCount = initial.deviceTokens.length;

  return (
    <NotificationSection
      id="apns"
      title="Apple Push Notifications"
      description="Push notifications to your iOS devices."
      enabled={channel.enabled}
      onToggle={channel.handleToggle}
    >
      <div className={cn("mt-5 space-y-4 transition-opacity", !channel.enabled && "pointer-events-none opacity-50")}>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="apns-team" className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Team ID
            </label>
            <Input
              id="apns-team"
              value={teamId}
              onChange={(e) => { setTeamId(e.target.value); channel.clearFeedback(); }}
              placeholder="ABCDE12345"
              className="font-mono text-xs"
            />
          </div>
          <div>
            <label htmlFor="apns-key-id" className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Key ID
            </label>
            <Input
              id="apns-key-id"
              value={keyId}
              onChange={(e) => { setKeyId(e.target.value); channel.clearFeedback(); }}
              placeholder="FGHIJ67890"
              className="font-mono text-xs"
            />
          </div>
        </div>

        <div>
          <label htmlFor="apns-bundle" className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Bundle ID
          </label>
          <Input
            id="apns-bundle"
            value={bundleId}
            onChange={(e) => { setBundleId(e.target.value); channel.clearFeedback(); }}
            placeholder="com.example.hive"
            className="font-mono text-xs"
          />
        </div>

        <div>
          <label htmlFor="apns-key" className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Private Key (.p8)
          </label>
          <div className="relative">
            <textarea
              id="apns-key"
              value={showKey ? keyContent : keyContent ? "••••••••••••••••" : ""}
              onChange={(e) => { setKeyContent(e.target.value); channel.clearFeedback(); }}
              onFocus={() => setShowKey(true)}
              placeholder={"-----BEGIN PRIVATE KEY-----\n..."}
              rows={4}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2 top-2 text-muted-foreground transition-colors hover:text-foreground"
            >
              {showKey
                ? <EyeOff className="h-3.5 w-3.5" />
                : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={sandbox}
              onChange={(e) => { setSandbox(e.target.checked); channel.clearFeedback(); }}
              className="rounded border-border"
            />
            Sandbox (development)
          </label>

          {deviceCount > 0 && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Smartphone className="h-3 w-3" />
              {deviceCount} device{deviceCount !== 1 ? "s" : ""} registered
            </span>
          )}
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
          feedback.type === "success" ? "text-emerald-500" : "text-red-500",
        )}>
          {feedback.message}
        </span>
      )}
    </div>
  );
}
