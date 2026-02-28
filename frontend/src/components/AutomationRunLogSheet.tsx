import { useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import ChatMessage from "@/components/ChatMessage";
import { useAutomationRunMessages } from "@/hooks/useAutomations";
import { cn } from "@/lib/utils";
import type { AutomationRun } from "@/types";

const EMPTY_SET = new Set<string>();

interface AutomationRunLogSheetProps {
  automationId: string;
  run: AutomationRun | null;
  onClose: () => void;
}

export default function AutomationRunLogSheet({
  automationId,
  run,
  onClose,
}: AutomationRunLogSheetProps) {
  const { data, isLoading } = useAutomationRunMessages(
    run ? automationId : undefined,
    run?.id,
  );

  const messages = data?.messages;
  const systemPrompt = data?.systemPrompt;

  const startedAt = run?.startedAt
    ? new Date(run.startedAt).toLocaleString()
    : "";

  return (
    <Sheet open={!!run} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col gap-0 p-0">
        <SheetHeader className="shrink-0 px-4 py-3 border-b border-border/50">
          <SheetTitle className="text-sm">Run Log · {startedAt}</SheetTitle>
        </SheetHeader>

        {systemPrompt && <SystemPromptBanner content={systemPrompt} />}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : messages && messages.length > 0 ? (
            <div className="flex flex-col gap-4 px-8 py-4">
              {messages.map((msg, i) => (
                <ChatMessage
                  key={msg.id ?? `${msg.timestamp}-${i}`}
                  message={msg}
                  isInteractive={false}
                  dismissedToolCallIds={EMPTY_SET}
                />
              ))}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-xs text-muted-foreground">No messages recorded for this run.</p>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SystemPromptBanner({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="shrink-0 border-b border-border/50 bg-muted/20">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-4 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="font-medium">System Prompt</span>
        <ChevronDown
          className={cn(
            "ml-auto h-3 w-3 transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>
      {expanded && (
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap px-4 pb-3 text-xs text-foreground/80 font-mono">
          {content}
        </pre>
      )}
    </div>
  );
}
