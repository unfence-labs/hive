import type { ChatMessage as ChatMessageType } from "@/types";
import { cn } from "@/lib/utils";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import ChatToolUse from "@/components/ChatToolUse";

interface ChatMessageProps {
  message: ChatMessageType;
}

export default function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground",
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <>
            {message.thinkingContent && (
              <details className="mb-2">
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                  Thinking
                </summary>
                <div className="mt-1 rounded bg-muted/80 px-2 py-1 text-xs italic text-muted-foreground">
                  {message.thinkingContent}
                </div>
              </details>
            )}
            <div className="prose-sm">
              <MarkdownRenderer content={message.content} />
            </div>
            {message.toolCalls && message.toolCalls.length > 0 && (
              <div className="mt-2">
                {message.toolCalls.map((tool) => (
                  <ChatToolUse key={tool.id} tool={tool} />
                ))}
              </div>
            )}
            {message.cancelled && (
              <div className="mt-2 text-xs italic text-muted-foreground">
                (cancelled)
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
