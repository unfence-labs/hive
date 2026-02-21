import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Eye, EyeOff, Send, Save, Loader2 } from "lucide-react";
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

const defaultTelegram: TelegramConfig = { enabled: false, botToken: "", chatId: "" };

export default function NotificationSettings() {
  const query = useQuery({
    queryKey: ["settings", "notifications"],
    queryFn: () => api.get<NotificationsConfig>("/api/settings/notifications"),
  });

  if (query.isLoading) return null;

  const initial = query.data?.telegram ?? defaultTelegram;

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="border-b border-border/50 px-8 py-5" data-tauri-drag-region>
        <h1 className="text-base font-semibold">Notifications</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Configure how Hive notifies you when agents finish work.
        </p>
      </div>

      <div className="max-w-2xl space-y-6 px-8 py-6">
        <TelegramForm initial={initial} />
      </div>
    </div>
  );
}

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
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-labelledby="telegram-toggle-label"
          onClick={() => setEnabled(!enabled)}
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

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => testMutation.mutate()}
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
            onClick={() => saveMutation.mutate()}
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
      </div>
    </section>
  );
}
