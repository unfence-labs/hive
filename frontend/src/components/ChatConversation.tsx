import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import ChatMessage from "@/components/ChatMessage";
import ChatToolUse from "@/components/ChatToolUse";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import type { ChatMessage as ChatMessageType, ToolCall } from "@/types";

interface ChatConversationProps {
  messages: ChatMessageType[];
  isStreaming: boolean;
  currentStreamingText: string;
  currentThinking: string;
  activeToolCalls: ToolCall[];
}

export default function ChatConversation({
  messages,
  isStreaming,
  currentStreamingText,
  currentThinking,
  activeToolCalls,
}: ChatConversationProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentStreamingText, activeToolCalls]);

  const hasContent = messages.length > 0 || isStreaming;

  return (
    <ScrollArea className="flex-1">
      <div className="flex flex-col gap-4 p-4">
        {!hasContent && (
          <div className="flex flex-1 items-center justify-center py-20 text-sm text-muted-foreground">
            Send a message to start a conversation.
          </div>
        )}
        {messages.map((msg, i) => (
          <ChatMessage key={msg.id ?? `${msg.timestamp}-${i}`} message={msg} />
        ))}

        {/* Live streaming content */}
        {isStreaming && (currentStreamingText || currentThinking || activeToolCalls.length > 0) && (
          <div className="flex w-full justify-start">
            <div className="max-w-[85%] rounded-xl bg-muted px-4 py-3 text-sm leading-relaxed text-foreground">
              {currentThinking && (
                <details className="mb-2" open>
                  <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                    Thinking...
                  </summary>
                  <div className="mt-1 rounded bg-muted/80 px-2 py-1 text-xs italic text-muted-foreground">
                    {currentThinking}
                  </div>
                </details>
              )}
              {currentStreamingText && (
                <div className="prose-sm">
                  <MarkdownRenderer content={currentStreamingText} />
                  <span className="inline-block h-4 w-0.5 animate-pulse bg-current align-text-bottom" />
                </div>
              )}
              {activeToolCalls.length > 0 && (
                <div className="mt-2">
                  {activeToolCalls.map((tool) => (
                    <ChatToolUse
                      key={tool.id}
                      tool={tool}
                      isExecuting={tool.output === undefined}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
