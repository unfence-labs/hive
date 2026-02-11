import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

interface LaunchAgentFormProps {
  disabled: boolean;
  onSubmit: (prompt: string) => Promise<void>;
}

export default function LaunchAgentForm({ disabled, onSubmit }: LaunchAgentFormProps) {
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || disabled) return;
    setSubmitting(true);
    try {
      await onSubmit(prompt.trim());
      setPrompt("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <Textarea
        placeholder="Enter a prompt for the agent..."
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
    </form>
  );
}
