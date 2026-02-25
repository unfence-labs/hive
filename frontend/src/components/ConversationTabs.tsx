import { useState, useRef, useEffect, useCallback } from "react";
import { MessageSquareIcon, PlusIcon, XIcon, MoreHorizontalIcon, FileIcon } from "lucide-react";
import AgentActivityPreview from "@/components/chat/AgentActivityPreview";
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
  streamingSessions?: Record<string, boolean>;
  unreadSessions?: Record<string, boolean>;
  onCreateSession: () => void;
  onActivateSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  openFile?: string | null;
  isFileActive?: boolean;
  onFileTabClick?: () => void;
  onFileTabClose?: () => void;
  onConversationTabClick?: () => void;
}

function getTabTitle(session: SessionMetadata): string {
  return session.title || "Untitled";
}

function getSessionVisualState({
  sessionId,
  activeSessionId,
  isStreaming,
  isFileActive,
  streamingSessions,
  unreadSessions,
}: {
  sessionId: string;
  activeSessionId?: string;
  isStreaming: boolean;
  isFileActive?: boolean;
  streamingSessions?: Record<string, boolean>;
  unreadSessions?: Record<string, boolean>;
}) {
  const isActive = sessionId === activeSessionId;
  const isSessionVisible = isActive && !isFileActive;
  const isSessionStreaming = Boolean(streamingSessions?.[sessionId] ?? (isActive && isStreaming));
  const isSessionUnread = !isSessionVisible && !isSessionStreaming && Boolean(unreadSessions?.[sessionId]);

  return { isActive, isSessionStreaming, isSessionUnread };
}

function SessionStatusIndicator({
  isStreaming,
  isUnread,
}: {
  isStreaming: boolean;
  isUnread: boolean;
}) {
  if (isStreaming) {
    return (
      <div className="flex size-3 shrink-0 items-center justify-center overflow-visible">
        <AgentActivityPreview size="small" />
      </div>
    );
  }
  if (isUnread) {
    return <span className="size-2 shrink-0 rounded-full bg-primary" />;
  }
  return <MessageSquareIcon className="size-3 shrink-0" />;
}

function TabCloseAction({ onClose }: { onClose: () => void }) {
  return (
    <span
      role="button"
      tabIndex={0}
      className={cn(
        "ml-auto shrink-0 rounded p-0.5 text-muted-foreground/50",
        "hover:bg-destructive/10 hover:text-destructive",
      )}
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <XIcon className="size-3" />
    </span>
  );
}

export function ConversationTabs({
  sessions,
  activeSessionId,
  isStreaming,
  streamingSessions,
  unreadSessions,
  onCreateSession,
  onActivateSession,
  onDeleteSession,
  openFile,
  isFileActive,
  onFileTabClick,
  onFileTabClose,
  onConversationTabClick,
}: ConversationTabsProps) {
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(sessions.length);
  const tabsRef = useRef<HTMLDivElement>(null);
  const visibleSessionCount = Math.max(0, visibleCount - (openFile ? 1 : 0));

  const measureTabs = useCallback(() => {
    const tabsEl = tabsRef.current;
    if (!tabsEl) return;

    // Temporarily make all tabs visible for accurate measurement
    const tabs = Array.from(tabsEl.children) as HTMLElement[];
    for (const tab of tabs) tab.classList.remove("hidden");

    const containerWidth = tabsEl.clientWidth;
    let usedWidth = 0;
    let count = 0;

    for (const tab of tabs) {
      const w = tab.scrollWidth + 4; // 4px gap
      if (usedWidth + w > containerWidth && count > 0) break;
      usedWidth += w;
      count++;
    }

    // Re-hide overflow tabs immediately to avoid flash
    for (let i = count; i < tabs.length; i++) tabs[i].classList.add("hidden");

    setVisibleCount(Math.max(1, count));
  }, []);

  useEffect(() => {
    measureTabs();
  }, [sessions, openFile, measureTabs]);

  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;
    const observer = new ResizeObserver(measureTabs);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measureTabs]);

  const overflowSessions = sessions.slice(visibleSessionCount);

  return (
    <>
      <div className="flex h-9 items-center gap-1 border-b border-border/50 px-2">
        <div ref={tabsRef} className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
          {openFile && (
            <button
              type="button"
              className={cn(
                "group relative flex h-7 max-w-48 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs transition-colors",
                isFileActive
                  ? "text-foreground after:absolute after:bottom-0 after:inset-x-2 after:h-0.5 after:rounded-full after:bg-primary"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
              onClick={onFileTabClick}
            >
              <FileIcon className="size-3 shrink-0" />
              <span className="truncate">{openFile.split("/").pop()}</span>
              <TabCloseAction onClose={() => onFileTabClose?.()} />
            </button>
          )}
          {sessions.length === 0 && (
            <button
              type="button"
              className={cn(
                "relative flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs transition-colors",
                !isFileActive
                  ? "text-foreground after:absolute after:bottom-0 after:inset-x-2 after:h-0.5 after:rounded-full after:bg-primary"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
              onClick={onConversationTabClick}
            >
              <MessageSquareIcon className="size-3 shrink-0" />
              <span className="truncate">Untitled</span>
            </button>
          )}
          {sessions.map((session, i) => {
            const { isActive, isSessionStreaming, isSessionUnread } = getSessionVisualState({
              sessionId: session.sessionId,
              activeSessionId,
              isStreaming,
              isFileActive,
              streamingSessions,
              unreadSessions,
            });
            const isVisible = i < visibleSessionCount;
            const title = getTabTitle(session);

            return (
              <button
                key={session.sessionId}
                type="button"
                className={cn(
                  "group relative flex h-7 max-w-48 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs transition-colors",
                  isActive && !isFileActive
                    ? "text-foreground after:absolute after:bottom-0 after:inset-x-2 after:h-0.5 after:rounded-full after:bg-primary"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  !isVisible && "hidden",
                )}
                onClick={() => onActivateSession(session.sessionId)}
              >
                <SessionStatusIndicator isStreaming={isSessionStreaming} isUnread={isSessionUnread} />
                <span className="truncate">{title}</span>
                {sessions.length > 1 && !isSessionStreaming && (
                  <TabCloseAction onClose={() => setDeleteTarget(session.sessionId)} />
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
              {overflowSessions.map((session) => {
                const { isActive, isSessionStreaming: isOverflowStreaming, isSessionUnread: isOverflowUnread } = getSessionVisualState({
                  sessionId: session.sessionId,
                  activeSessionId,
                  isStreaming,
                  isFileActive,
                  streamingSessions,
                  unreadSessions,
                });
                const title = getTabTitle(session);

                return (
                  <DropdownMenuItem
                    key={session.sessionId}
                    className="flex items-center gap-2"
                    onSelect={() => onActivateSession(session.sessionId)}
                  >
                    <SessionStatusIndicator
                      isStreaming={isOverflowStreaming}
                      isUnread={isOverflowUnread}
                    />
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
