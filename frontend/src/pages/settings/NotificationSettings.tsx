import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Eye, EyeOff, Send, Save, Loader2, Smartphone } from "lucide-react";
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
      <div className="border-b border-border/50 px-8 py-5" data-tauri-drag-region>
        <h1 className="text-base font-semibold">Notifications</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Configure how Hive notifies you when agents finish work.
        </p>
      </div>

      <div className="max-w-2xl space-y-6 px-8 py-6">
        <TelegramForm initial={telegram} />
        <ApnsForm initial={apns} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toggle component (shared)
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
  const [enabled, setEnabled] = useState(initial.enabled);
  const [botToken, setBotToken] = useState(initial.botToken);
  const [chatId, setChatId] = useState(initial.chatId);
  const [showToken, setShowToken] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const clearFeedback = () => setFeedback(null);
  const showFeedback = (fb: { type: "success" | "error"; message: string }) => {
    setFeedback(fb);
    if (fb.type === "success") setTimeout(clearFeedback, 2500);
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      api.put("/api/settings/notifications", {
        telegram: { enabled, botToken, chatId },
      }),
    onMutate: clearFeedback,
    onSuccess: () => showFeedback({ type: "success", message: "Saved" }),
    onError: () => showFeedback({ type: "error", message: "Failed to save" }),
  });

  const testMutation = useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; error?: string }>(
        "/api/settings/notifications/test",
        { botToken, chatId },
      ),
    onMutate: clearFeedback,
    onSuccess: (result) => {
      if (result.ok) {
        showFeedback({ type: "success", message: "Test message sent!" });
      } else {
        showFeedback({ type: "error", message: result.error ?? "Test failed" });
      }
    },
    onError: () => showFeedback({ type: "error", message: "Could not reach backend" }),
  });

  const saving = saveMutation.isPending;
  const testing = testMutation.isPending;
  const hasCredentials = botToken.trim() !== "" && chatId.trim() !== "";

  return (
    <section className="rounded-lg border border-border/50 bg-card/50 p-5">
      <div className="flex items-start justify-between">
        <div>
          <h2 id="telegram-toggle-label" className="text-sm font-medium text-foreground">Telegram</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Receive notifications via a Telegram bot.
          </p>
        </div>
        <Toggle id="telegram-toggle-label" enabled={enabled} onChange={setEnabled} />
      </div>

      <div className={cn("mt-5 space-y-4 transition-opacity", !enabled && "pointer-events-none opacity-50")}>
        <div>
          <label htmlFor="tg-token" className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Bot Token
          </label>
          <div className="relative">
            <Input
              id="tg-token"
              type={showToken ? "text" : "password"}
              value={botToken}
              onChange={(e) => { setBotToken(e.target.value); clearFeedback(); }}
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
            onChange={(e) => { setChatId(e.target.value); clearFeedback(); }}
            placeholder="-1001234567890"
            className="font-mono text-xs"
          />
        </div>

        <FormActions
          saving={saving}
          testing={testing}
          hasCredentials={hasCredentials}
          onTest={() => testMutation.mutate()}
          onSave={() => saveMutation.mutate()}
          feedback={feedback}
        />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// APNs
// ---------------------------------------------------------------------------

function ApnsForm({ initial }: { initial: ApnsConfig }) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [teamId, setTeamId] = useState(initial.teamId);
  const [keyId, setKeyId] = useState(initial.keyId);
  const [keyContent, setKeyContent] = useState(initial.keyContent);
  const [bundleId, setBundleId] = useState(initial.bundleId);
  const [sandbox, setSandbox] = useState(initial.sandbox);
  const [showKey, setShowKey] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const clearFeedback = () => setFeedback(null);
  const showFeedback = (fb: { type: "success" | "error"; message: string }) => {
    setFeedback(fb);
    if (fb.type === "success") setTimeout(clearFeedback, 2500);
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      api.put("/api/settings/notifications", {
        apns: { enabled, teamId, keyId, keyContent, bundleId, sandbox },
      }),
    onMutate: clearFeedback,
    onSuccess: () => showFeedback({ type: "success", message: "Saved" }),
    onError: () => showFeedback({ type: "error", message: "Failed to save" }),
  });

  const testMutation = useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; error?: string }>(
        "/api/settings/notifications/test-apns",
        { teamId, keyId, keyContent, bundleId, sandbox },
      ),
    onMutate: clearFeedback,
    onSuccess: (result) => {
      if (result.ok) {
        showFeedback({ type: "success", message: "Test push sent!" });
      } else {
        showFeedback({ type: "error", message: result.error ?? "Test failed" });
      }
    },
    onError: () => showFeedback({ type: "error", message: "Could not reach backend" }),
  });

  const saving = saveMutation.isPending;
  const testing = testMutation.isPending;
  const hasCredentials = teamId.trim() !== "" && keyId.trim() !== "" && keyContent.trim() !== "" && bundleId.trim() !== "";
  const deviceCount = initial.deviceTokens.length;

  return (
    <section className="rounded-lg border border-border/50 bg-card/50 p-5">
      <div className="flex items-start justify-between">
        <div>
          <h2 id="apns-toggle-label" className="text-sm font-medium text-foreground">Apple Push Notifications</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Push notifications to your iOS devices.
          </p>
        </div>
        <Toggle id="apns-toggle-label" enabled={enabled} onChange={setEnabled} />
      </div>

      <div className={cn("mt-5 space-y-4 transition-opacity", !enabled && "pointer-events-none opacity-50")}>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="apns-team" className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Team ID
            </label>
            <Input
              id="apns-team"
              value={teamId}
              onChange={(e) => { setTeamId(e.target.value); clearFeedback(); }}
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
              onChange={(e) => { setKeyId(e.target.value); clearFeedback(); }}
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
            onChange={(e) => { setBundleId(e.target.value); clearFeedback(); }}
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
              onChange={(e) => { setKeyContent(e.target.value); clearFeedback(); }}
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
              onChange={(e) => { setSandbox(e.target.checked); clearFeedback(); }}
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

        <FormActions
          saving={saving}
          testing={testing}
          hasCredentials={hasCredentials}
          onTest={() => testMutation.mutate()}
          onSave={() => saveMutation.mutate()}
          feedback={feedback}
        />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Shared form actions
// ---------------------------------------------------------------------------

function FormActions({
  saving,
  testing,
  hasCredentials,
  onTest,
  onSave,
  feedback,
}: {
  saving: boolean;
  testing: boolean;
  hasCredentials: boolean;
  onTest: () => void;
  onSave: () => void;
  feedback: { type: "success" | "error"; message: string } | null;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onTest}
        disabled={testing || !hasCredentials}
        className={cn(
          "inline-flex cursor-pointer items-center gap-2 rounded-md border border-border/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground",
          (testing || !hasCredentials) && "pointer-events-none opacity-60",
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
        disabled={saving}
        className={cn(
          "inline-flex cursor-pointer items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90",
          saving && "pointer-events-none opacity-60",
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
