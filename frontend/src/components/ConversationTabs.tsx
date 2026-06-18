import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquareIcon, PlusIcon, XIcon, FileIcon, GitCompareArrowsIcon, TerminalSquareIcon } from "lucide-react";
import AgentActivityPreview from "@/components/chat/AgentActivityPreview";
import { ProviderIcon, isKnownProvider } from "@/components/chat/ProviderIcon";
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
import type { SessionKind, SessionMetadata } from "@/types";
import type { FileViewMode } from "@/hooks/useTabs";

// Keep in sync with the backend Brain guard (MAX_BRAIN_SESSIONS in
// brain-manager.ts) and the iOS cap (maxSessions in ConversationsSection.swift).
// For the Brain this is enforced server-side; workspaces have no backend cap, so
// this is their only limit.
const MAX_SESSIONS_PER_WORKSPACE = 6;

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
  isFileTabActive?: boolean;
  fileViewMode?: FileViewMode;
  onFileTabActivate?: () => void;
  onFileTabClose?: () => void;
  onConversationActivate?: () => void;
  /** Live provider of the active session — shows the tab icon immediately, before
   * the sessions list refetches the persisted lockedProvider. */
  activeProvider?: string;
}

function getTabTitle(session: SessionMetadata): string {
  return session.title || "Untitled";
}

function getSessionVisualState({
  sessionId,
  activeSessionId,
  isStreaming,
  isFileTabActive,
  streamingSessions,
  unreadSessions,
}: {
  sessionId: string;
  activeSessionId?: string;
  isStreaming: boolean;
  isFileTabActive?: boolean;
  streamingSessions?: Record<string, boolean>;
  unreadSessions?: Record<string, boolean>;
}) {
  const isActive = sessionId === activeSessionId;
  const isSessionVisible = isActive && !isFileTabActive;
  const isSessionStreaming = Boolean(streamingSessions?.[sessionId] ?? (isActive && isStreaming));
  const isSessionUnread = !isSessionVisible && !isSessionStreaming && Boolean(unreadSessions?.[sessionId]);

  return { isActive, isSessionStreaming, isSessionUnread };
}

function getFallbackVisualState({
  activeSessionId,
  isStreaming,
  isFileTabActive,
  streamingSessions,
  unreadSessions,
}: {
  activeSessionId?: string;
  isStreaming: boolean;
  isFileTabActive?: boolean;
  streamingSessions?: Record<string, boolean>;
  unreadSessions?: Record<string, boolean>;
}) {
  const sessionIdsFromStream = Object.keys(streamingSessions ?? {});
  const fallbackSessionId = activeSessionId ?? sessionIdsFromStream[0];
  const isSessionStreaming = fallbackSessionId
    ? Boolean(streamingSessions?.[fallbackSessionId] ?? isStreaming)
    : isStreaming || sessionIdsFromStream.length > 0;
  const isSessionVisible = !isFileTabActive;
  const hasUnread = Object.keys(unreadSessions ?? {}).length > 0;
  const isSessionUnread = !isSessionVisible && !isSessionStreaming && hasUnread;

  return { isSessionStreaming, isSessionUnread };
}

/**
 * The tab's leading glyph. The provider mark is the conversation's resting
 * identity (shown once a session locks its provider on the first message), so
 * the whole strip reads which model each conversation runs at a glance.
 * Transient states take the slot momentarily: a working indicator while
 * streaming, an unread dot otherwise. Before a provider is known we fall back to
 * a neutral message icon.
 */
function TabLeadingIcon({
  isStreaming,
  isUnread,
  provider,
  sessionKind,
}: {
  isStreaming: boolean;
  isUnread: boolean;
  provider?: string;
  sessionKind?: SessionKind;
}) {
  if (isStreaming) {
    return (
      <div className="flex size-3.5 shrink-0 items-center justify-center overflow-visible">
        <AgentActivityPreview size="small" />
      </div>
    );
  }
  if (isUnread) {
    return <span className="size-2 shrink-0 rounded-full bg-primary" />;
  }
  if (sessionKind === "terminal") {
    return <TerminalSquareIcon className="size-3.5 shrink-0" />;
  }
  if (isKnownProvider(provider)) {
    return <ProviderIcon provider={provider} colored className="size-3.5 shrink-0" />;
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
  isFileTabActive,
  fileViewMode,
  onFileTabActivate,
  onFileTabClose,
  onConversationActivate,
  activeProvider,
}: ConversationTabsProps) {
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Whether content is clipped on each side — drives the edge fade masks so it's
  // discoverable that more conversations live off-screen.
  const [edges, setEdges] = useState({ left: false, right: false });

  const { isSessionStreaming: isFallbackStreaming, isSessionUnread: isFallbackUnread } = getFallbackVisualState({
    activeSessionId,
    isStreaming,
    isFileTabActive,
    streamingSessions,
    unreadSessions,
  });

  const updateEdges = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  // Recompute fades when the tab set or layout changes.
  useEffect(() => {
    updateEdges();
  }, [sessions, openFile, updateEdges]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(updateEdges);
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateEdges]);

  // Translate vertical wheel into horizontal scroll over the strip (mouse users
  // can't scroll a horizontal overflow otherwise). Native non-passive so we can
  // preventDefault and stop the page from scrolling instead.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.shiftKey || e.deltaY === 0) return;
      if (el.scrollWidth <= el.clientWidth) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Keep the active conversation in view when it changes (e.g. activated from
  // elsewhere), so it never sits half-clipped behind a fade.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !activeSessionId) return;
    const tab = Array.from(el.children).find(
      (child) => (child as HTMLElement).dataset.sessionId === activeSessionId,
    ) as HTMLElement | undefined;
    if (!tab) return;
    const left = tab.offsetLeft;
    const right = left + tab.offsetWidth;
    if (left < el.scrollLeft) {
      el.scrollLeft = left - 8;
    } else if (right > el.scrollLeft + el.clientWidth) {
      el.scrollLeft = right - el.clientWidth + 8;
    }
    updateEdges();
  }, [activeSessionId, sessions, updateEdges]);

  // Terminal tabs are a separate surface and don't count toward the conversation
  // cap (the backend caps chat sessions only), so they must not disable the +.
  const atLimit =
    sessions.filter((s) => s.kind !== "terminal").length >= MAX_SESSIONS_PER_WORKSPACE;

  return (
    <>
      <div className="flex h-9 items-center gap-1 px-2">
        {/* Pinned file/diff takeover tab — stays put while conversations scroll. */}
        {openFile && (
          <button
            type="button"
            className={cn(
              "group relative flex h-7 max-w-44 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs transition-colors",
              isFileTabActive
                ? "text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={onFileTabActivate}
          >
            {fileViewMode === "diff" ? (
              <GitCompareArrowsIcon className="size-3 shrink-0 text-primary" />
            ) : (
              <FileIcon className="size-3 shrink-0 text-primary" />
            )}
            <span className="truncate">{openFile.split("/").pop()}</span>
            <TabCloseAction onClose={() => onFileTabClose?.()} />
          </button>
        )}

        {/* Scrollable conversation strip. */}
        <div className="relative min-w-0 flex-1">
          <div
            ref={scrollRef}
            onScroll={updateEdges}
            className="flex items-center gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {sessions.length === 0 && (
              <button
                type="button"
                className={cn(
                  "relative flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs transition-colors",
                  !isFileTabActive
                    ? "text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={onConversationActivate}
              >
                <TabLeadingIcon isStreaming={isFallbackStreaming} isUnread={isFallbackUnread} />
                <span className="truncate">Untitled</span>
              </button>
            )}
            {sessions.map((session) => {
              const { isActive, isSessionStreaming, isSessionUnread } = getSessionVisualState({
                sessionId: session.sessionId,
                activeSessionId,
                isStreaming,
                isFileTabActive,
                streamingSessions,
                unreadSessions,
              });
              // Terminal sessions with no title fall back to "Terminal N",
              // where N is the 1-based position among terminal-kind sessions
              // (the list is already sorted by createdAt asc).
              const title =
                session.kind === "terminal" && !session.title
                  ? `Terminal ${
                      sessions.filter((s) => s.kind === "terminal").indexOf(session) + 1
                    }`
                  : getTabTitle(session);

              return (
                <button
                  key={session.sessionId}
                  data-session-id={session.sessionId}
                  type="button"
                  className={cn(
                    "group relative flex h-7 max-w-44 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs transition-colors",
                    isActive && !isFileTabActive
                      ? "text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => onActivateSession(session.sessionId)}
                >
                  <TabLeadingIcon
                    isStreaming={isSessionStreaming}
                    isUnread={isSessionUnread}
                    provider={session.lockedProvider ?? (isActive ? activeProvider : undefined)}
                    sessionKind={session.kind}
                  />
                  <span className="truncate">{title}</span>
                  {sessions.length > 1 && !isSessionStreaming && (
                    <TabCloseAction onClose={() => setDeleteTarget(session.sessionId)} />
                  )}
                </button>
              );
            })}
          </div>

          {edges.left && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-card to-transparent"
            />
          )}
          {edges.right && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-card to-transparent"
            />
          )}
        </div>

        {/* Pinned new-conversation button — always reachable, capped at the limit. */}
        <button
          type="button"
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground",
            atLimit
              ? "cursor-not-allowed opacity-40"
              : "hover:bg-accent/50 hover:text-foreground",
          )}
          onClick={onCreateSession}
          disabled={atLimit}
          title={atLimit ? `Session limit reached (${MAX_SESSIONS_PER_WORKSPACE} max)` : "New conversation"}
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
