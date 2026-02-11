import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

interface LaunchAgentFormProps {
  disabled: boolean;
  onSubmit: (prompt: string, mode: "conversation" | "print") => Promise<void>;
}

export default function LaunchAgentForm({ disabled, onSubmit }: LaunchAgentFormProps) {
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<"conversation" | "print">("print");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || disabled) return;
    setSubmitting(true);
    try {
      await onSubmit(prompt.trim(), mode);
      setPrompt("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Mode:</span>
        <button
          type="button"
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            mode === "print"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setMode("print")}
        >
          Print
        </button>
        <button
          type="button"
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            mode === "conversation"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setMode("conversation")}
        >
          Conversation
        </button>
      </div>
      <div className="flex gap-2">
        <Textarea
          placeholder={
            mode === "conversation"
              ? "First message for the conversation..."
              : "Enter a prompt for the agent..."
          }
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={disabled || submitting}
          className="min-h-[60px] flex-1 resize-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              handleSubmit(e);
            }
          }}
        />
        <Button
          type="submit"
          disabled={disabled || submitting || !prompt.trim()}
          className="self-end"
        >
          {submitting ? "Launching..." : "Launch"}
        </Button>
      </div>
    </form>
  );
}
