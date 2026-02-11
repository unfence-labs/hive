import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import ChatMessage from "@/components/ChatMessage";
import type { ConversationMessage } from "@/types";

interface ChatConversationProps {
  messages: ConversationMessage[];
  isStreaming: boolean;
  currentStreamingText: string;
}

export default function ChatConversation({
  messages,
  isStreaming,
  currentStreamingText,
}: ChatConversationProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentStreamingText]);

  // Build a virtual "streaming" message to render live text
  const streamingMessage: ConversationMessage | null =
    isStreaming && currentStreamingText
      ? {
          role: "assistant",
          content: currentStreamingText,
          timestamp: new Date().toISOString(),
        }
      : null;

  const hasContent = messages.length > 0 || streamingMessage;

  return (
    <ScrollArea className="flex-1">
      <div className="flex flex-col gap-4 p-4">
        {!hasContent && (
          <div className="flex flex-1 items-center justify-center py-20 text-sm text-muted-foreground">
            Start a conversation with the agent.
          </div>
        )}
        {messages.map((msg, i) => (
          <ChatMessage key={`${msg.timestamp}-${i}`} message={msg} />
        ))}
        {streamingMessage && (
          <ChatMessage message={streamingMessage} isStreaming />
        )}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
