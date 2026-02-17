import { useEffect, useState } from "react";
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

export default function NotificationSettings() {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    api.get<NotificationsConfig>("/api/settings/notifications").then((data) => {
      setEnabled(data.telegram.enabled);
      setBotToken(data.telegram.botToken);
      setChatId(data.telegram.chatId);
    }).catch(() => {
      // defaults are fine
    }).finally(() => setLoading(false));
  }, []);

  const clearFeedback = () => setFeedback(null);
  const showFeedback = (fb: { type: "success" | "error"; message: string }) => {
    setFeedback(fb);
    if (fb.type === "success") setTimeout(clearFeedback, 2500);
  };

  const handleSave = async () => {
    setSaving(true);
    clearFeedback();
    try {
      await api.put("/api/settings/notifications", {
        telegram: { enabled, botToken, chatId },
      });
      showFeedback({ type: "success", message: "Saved" });
    } catch {
      showFeedback({ type: "error", message: "Failed to save" });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    clearFeedback();
    try {
      const result = await api.post<{ ok: boolean; error?: string }>(
        "/api/settings/notifications/test",
        { botToken, chatId },
      );
      if (result.ok) {
        showFeedback({ type: "success", message: "Test message sent!" });
      } else {
        showFeedback({ type: "error", message: result.error ?? "Test failed" });
      }
    } catch {
      showFeedback({ type: "error", message: "Could not reach backend" });
    } finally {
      setTesting(false);
    }
  };

  if (loading) return null;

  const hasCredentials = botToken.trim() !== "" && chatId.trim() !== "";

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="border-b border-border/50 px-8 py-5">
        <h1 className="text-base font-semibold">Notifications</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Configure how Hive notifies you when agents finish work.
        </p>
      </div>

      <div className="max-w-2xl space-y-6 px-8 py-6">
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
                onClick={() => void handleTest()}
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
                onClick={() => void handleSave()}
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
      </div>
    </div>
  );
}
