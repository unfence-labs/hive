import { Loader2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import ChatConversation from "@/components/ChatConversation";
import { useAutomationRunMessages } from "@/hooks/useAutomations";
import type { AutomationRun } from "@/types";

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
  const { data: messages, isLoading } = useAutomationRunMessages(
    run ? automationId : undefined,
    run?.id,
  );

  const startedAt = run?.startedAt
    ? new Date(run.startedAt).toLocaleString()
    : "";

  return (
    <Sheet open={!!run} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col gap-0 p-0">
        <SheetHeader className="shrink-0 px-4 py-3 border-b border-border/50">
          <SheetTitle className="text-sm">Run Log · {startedAt}</SheetTitle>
        </SheetHeader>

        <div className="min-h-0 flex-1 flex flex-col">
          {isLoading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : messages && messages.length > 0 ? (
            <ChatConversation
              key={run?.id}
              messages={messages}
              isStreaming={false}
              streamingStartedAt={null}
              currentStreamingText=""
              currentThinking=""
              activeToolCalls={[]}
              pendingToolInputs={[]}
              switchCounter={0}
              scrollToBottomTrigger={0}
            />
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
