import { useState } from "react";
import { ChevronDownIcon, PlusIcon, Trash2Icon, MessageSquareIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { Button } from "@/components/ui/button";
import type { SessionMetadata } from "@/types";

interface SessionSelectorProps {
  sessions: SessionMetadata[];
  activeSessionId?: string;
  isStreaming: boolean;
  onCreateSession: () => void;
  onActivateSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHour = Math.floor(diffMs / 3_600_000);
  const diffDay = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

export function SessionSelector({
  sessions,
  activeSessionId,
  isStreaming,
  onCreateSession,
  onActivateSession,
  onDeleteSession,
}: SessionSelectorProps) {
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const activeIndex = sessions.findIndex((s) => s.sessionId === activeSessionId);
  const label = activeSessionId
    ? `Session ${activeIndex >= 0 ? sessions.length - activeIndex : 1}`
    : "No session";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="xs" className="gap-1 text-muted-foreground hover:text-foreground">
            <MessageSquareIcon className="size-3.5" />
            <span className="max-w-24 truncate text-xs">{label}</span>
            <ChevronDownIcon className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {sessions.map((session, i) => {
            const isActive = session.sessionId === activeSessionId;
            return (
              <DropdownMenuItem
                key={session.sessionId}
                className="flex items-center gap-2"
                onSelect={() => {
                  if (!isActive) onActivateSession(session.sessionId);
                }}
              >
                <span
                  className={`size-1.5 shrink-0 rounded-full ${
                    isActive ? "bg-primary" : "bg-transparent"
                  }`}
                />
                <span className="flex-1 truncate text-xs">
                  Session {sessions.length - i}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {session.messageCount} msg · {formatRelativeTime(session.updatedAt)}
                </span>
                {sessions.length > 1 && (
                  <button
                    className="shrink-0 rounded p-0.5 text-muted-foreground/50 hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
                    disabled={isActive && isStreaming}
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget(session.sessionId);
                    }}
                  >
                    <Trash2Icon className="size-3" />
                  </button>
                )}
              </DropdownMenuItem>
            );
          })}
          {sessions.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem
            className="gap-2"
            onSelect={onCreateSession}
          >
            <PlusIcon className="size-3.5" />
            <span className="text-xs">New session</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete session</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove all messages from this session. This cannot be undone.
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
