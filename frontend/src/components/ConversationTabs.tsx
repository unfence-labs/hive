import { useState, useRef, useEffect, useCallback } from "react";
import { MessageSquareIcon, PlusIcon, XIcon, MoreHorizontalIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import type { SessionMetadata } from "@/types";

interface ConversationTabsProps {
  sessions: SessionMetadata[];
  activeSessionId?: string;
  isStreaming: boolean;
  onCreateSession: () => void;
  onActivateSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
}

function getTabTitle(session: SessionMetadata, reverseIndex: number): string {
  return session.title || `Conversation ${reverseIndex}`;
}

export function ConversationTabs({
  sessions,
  activeSessionId,
  isStreaming,
  onCreateSession,
  onActivateSession,
  onDeleteSession,
}: ConversationTabsProps) {
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(sessions.length);
  const containerRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);

  const measureTabs = useCallback(() => {
    const container = containerRef.current;
    const tabsEl = tabsRef.current;
    if (!container || !tabsEl) return;

    // Available width = container - plus button (32px) - overflow button (32px) - gap (8px)
    const available = container.clientWidth - 72;
    const tabs = Array.from(tabsEl.children) as HTMLElement[];
    let usedWidth = 0;
    let count = 0;

    for (const tab of tabs) {
      // Temporarily show all tabs for measurement
      tab.style.display = "";
      const w = tab.offsetWidth + 4; // 4px gap
      if (usedWidth + w > available && count > 0) break;
      usedWidth += w;
      count++;
    }

    setVisibleCount(Math.max(1, count));
  }, []);

  useEffect(() => {
    measureTabs();
  }, [sessions.length, measureTabs]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(measureTabs);
    observer.observe(container);
    return () => observer.disconnect();
  }, [measureTabs]);

  const overflowSessions = sessions.slice(visibleCount);

  return (
    <>
      <div
        ref={containerRef}
        className="flex h-9 items-center gap-1 border-b border-border/50 px-2"
      >
        <div ref={tabsRef} className="flex min-w-0 items-center gap-1">
          {sessions.map((session, i) => {
            const isActive = session.sessionId === activeSessionId;
            const reverseIndex = sessions.length - i;
            const isVisible = i < visibleCount;
            const title = getTabTitle(session, reverseIndex);

            return (
              <button
                key={session.sessionId}
                type="button"
                className={cn(
                  "group flex h-7 max-w-48 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  !isVisible && "hidden",
                )}
                onClick={() => {
                  if (!isActive) onActivateSession(session.sessionId);
                }}
              >
                <MessageSquareIcon className="size-3 shrink-0" />
                <span className="truncate">{title}</span>
                {sessions.length > 1 && (
                  <span
                    role="button"
                    tabIndex={0}
                    className={cn(
                      "ml-auto shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100",
                      "hover:bg-destructive/10 hover:text-destructive",
                      "disabled:pointer-events-none disabled:opacity-30",
                      isActive && isStreaming && "pointer-events-none opacity-30",
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!(isActive && isStreaming)) {
                        setDeleteTarget(session.sessionId);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.stopPropagation();
                        if (!(isActive && isStreaming)) {
                          setDeleteTarget(session.sessionId);
                        }
                      }
                    }}
                  >
                    <XIcon className="size-3" />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {overflowSessions.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              >
                <MoreHorizontalIcon className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              {overflowSessions.map((session, i) => {
                const globalIndex = visibleCount + i;
                const reverseIndex = sessions.length - globalIndex;
                const isActive = session.sessionId === activeSessionId;
                const title = getTabTitle(session, reverseIndex);

                return (
                  <DropdownMenuItem
                    key={session.sessionId}
                    className="flex items-center gap-2"
                    onSelect={() => {
                      if (!isActive) onActivateSession(session.sessionId);
                    }}
                  >
                    <MessageSquareIcon className="size-3 shrink-0" />
                    <span className="flex-1 truncate text-xs">{title}</span>
                    {isActive && (
                      <span className="size-1.5 shrink-0 rounded-full bg-primary" />
                    )}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <button
          type="button"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          onClick={onCreateSession}
          title="New conversation"
        >
          <PlusIcon className="size-3.5" />
        </button>
      </div>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete conversation</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove all messages from this conversation.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) onDeleteSession(deleteTarget);
                setDeleteTarget(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
