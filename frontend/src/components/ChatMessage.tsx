import type { ConversationMessage } from "@/types";
import { cn } from "@/lib/utils";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import ChatToolUse from "@/components/ChatToolUse";

interface ChatMessageProps {
  message: ConversationMessage;
  isStreaming?: boolean;
}

export default function ChatMessage({ message, isStreaming }: ChatMessageProps) {
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
            <div className="prose-sm">
              <MarkdownRenderer content={message.content} />
              {isStreaming && (
                <span className="inline-block h-4 w-0.5 animate-pulse bg-current align-text-bottom" />
              )}
            </div>
            {message.toolUse && message.toolUse.length > 0 && (
              <div className="mt-2">
                {message.toolUse.map((tool) => (
                  <ChatToolUse key={tool.id} tool={tool} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
