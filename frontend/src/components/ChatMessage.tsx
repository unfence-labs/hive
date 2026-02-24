import { memo, useState } from "react";
import type { ChatMessage as ChatMessageType, QuestionAnswer } from "@/types";
import { cn } from "@/lib/utils";
import { formatElapsed } from "@/lib/time";
import { resolveImageSrc } from "@/lib/image-url";
import { MessageResponse } from "@/components/ai-elements/message";
import { ThinkingBlock } from "@/components/chat/ThinkingBlock";
import { ToolCallList } from "@/components/chat/ToolCallList";
import { CopyButton } from "@/components/chat/CopyButton";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { PlanStatus } from "@/components/chat/PlanProposal";

interface ChatMessageProps {
  message: ChatMessageType;
  isInteractive?: boolean;
  planStatus?: PlanStatus;
  onQuestionAnswer?: (toolCallId: string, answers: QuestionAnswer[]) => void;
  onPlanApproval?: () => void;
  onHandOff?: (planContent: string, planPath?: string) => void;
}

const ChatMessage = memo(function ChatMessage({
  message,
  isInteractive = false,
  planStatus,
  onQuestionAnswer,
  onPlanApproval,
  onHandOff,
}: ChatMessageProps) {
  const isUser = message.role === "user";
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  return (
    <div className={cn("flex w-full items-start", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] text-sm leading-relaxed",
          isUser
            ? "group/user-msg relative rounded-[10px] rounded-br-[2px] border border-primary/15 bg-primary/20 px-3.5 py-2 text-white"
            : "text-foreground",
        )}
      >
        {isUser ? (
          <>
            {message.content && (
              <CopyButton
                content={message.content}
                className="absolute -top-2 -right-2 opacity-0 transition-opacity group-hover/user-msg:opacity-100"
              />
            )}
            {message.images && message.images.length > 0 && (
              <>
                <div className={cn("flex flex-wrap justify-end gap-1.5", message.content && "mb-1.5")}>
                  {message.images.map((img, i) => (
                    <button
                      key={`${message.id}-img-${i}`}
                      type="button"
                      onClick={() => setLightboxIndex(i)}
                      className="h-10 w-14 flex-none cursor-pointer overflow-hidden rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <img
                        src={resolveImageSrc(img.dataUrl)}
                        alt={img.name}
                        className="h-full w-full object-cover"
                      />
                    </button>
                  ))}
                </div>
                <Dialog
                  open={lightboxIndex !== null}
                  onOpenChange={(open) => { if (!open) setLightboxIndex(null); }}
                >
                  <DialogContent
                    showCloseButton={false}
                    overlayClassName="bg-black/80 backdrop-blur-sm"
                    className="flex items-center justify-center border-none bg-transparent p-0 shadow-none sm:max-w-[90vw]"
                    onClick={() => setLightboxIndex(null)}
                  >
                    <DialogTitle className="sr-only">Image preview</DialogTitle>
                    <DialogDescription className="sr-only">Full size image preview</DialogDescription>
                    {lightboxIndex !== null && message.images[lightboxIndex] && (
                      <img
                        src={resolveImageSrc(message.images[lightboxIndex].dataUrl)}
                        alt={message.images[lightboxIndex].name}
                        className="mx-auto max-h-[85vh] w-auto rounded-lg object-contain"
                      />
                    )}
                  </DialogContent>
                </Dialog>
              </>
            )}
            {message.content && <p className="whitespace-pre-wrap">{message.content}</p>}
          </>
        ) : (
          <>
            {message.thinkingContent && (
              <ThinkingBlock content={message.thinkingContent} />
            )}
            <div className="prose-sm">
              <MessageResponse>{message.content}</MessageResponse>
            </div>
            {message.toolCalls && (
              <ToolCallList
                toolCalls={message.toolCalls}
                isInteractive={isInteractive}
                planStatus={planStatus}
                onQuestionAnswer={onQuestionAnswer}
                onPlanApproval={onPlanApproval}
                onHandOff={onHandOff}
              />
            )}
            {message.cancelled && (
              <div className="mt-2 space-y-1 text-xs">
                <div className="italic text-muted-foreground">(cancelled)</div>
                {message.errorDetail && (
                  <div className="break-words font-mono text-[11px] text-destructive/90">
                    {message.errorDetail}
                  </div>
                )}
              </div>
            )}
            {message.durationMs != null && (
              <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span>{formatElapsed(message.durationMs)}</span>
                <span>·</span>
                <CopyButton content={message.content} className="mb-0.5" />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
});

export default ChatMessage;
