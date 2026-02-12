import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { SessionSelector } from "@/components/SessionSelector";
import type { SessionMetadata } from "@/types";

function makeSession(id: string, updatedAt: string): SessionMetadata {
  return {
    sessionId: id,
    workspaceId: "ws-1",
    createdAt: "2026-02-12T00:00:00.000Z",
    updatedAt,
    messageCount: 1,
  };
}

function renderSessionSelector(props?: Partial<ComponentProps<typeof SessionSelector>>) {
  const onCreateSession = vi.fn();
  const onActivateSession = vi.fn();
  const onDeleteSession = vi.fn();

  render(
    <SessionSelector
      sessions={[
        makeSession("sess-1", "2026-02-12T00:00:01.000Z"),
        makeSession("sess-2", "2026-02-12T00:00:00.000Z"),
      ]}
      activeSessionId="sess-1"
      isStreaming={false}
      onCreateSession={onCreateSession}
      onActivateSession={onActivateSession}
      onDeleteSession={onDeleteSession}
      {...props}
    />,
  );

  return { onCreateSession, onActivateSession, onDeleteSession };
}

describe("SessionSelector", () => {
  it("shows a no-session label when no active session id is provided", () => {
    renderSessionSelector({ activeSessionId: undefined });
    expect(screen.getByRole("button", { name: /No session/i })).toBeInTheDocument();
  });

  it("shows the active session index label", () => {
    renderSessionSelector({ activeSessionId: "sess-2" });
    expect(screen.getByRole("button", { name: /Session 1/i })).toBeInTheDocument();
  });

  it("creates a new session from dropdown action", async () => {
    const user = userEvent.setup();
    const { onCreateSession } = renderSessionSelector();

    await user.click(screen.getByRole("button", { name: /Session 2/i }));
    await user.click(screen.getByRole("menuitem", { name: /New session/i }));

    expect(onCreateSession).toHaveBeenCalledTimes(1);
  });

  it("activates only non-active sessions", async () => {
    const user = userEvent.setup();
    const { onActivateSession } = renderSessionSelector();

    await user.click(screen.getByRole("button", { name: /Session 2/i }));
    await user.click(screen.getByRole("menuitem", { name: /Session 1/i }));
    expect(onActivateSession).toHaveBeenCalledWith("sess-2");

    await user.click(screen.getByRole("button", { name: /Session 2/i }));
    await user.click(screen.getByRole("menuitem", { name: /Session 2/i }));
    expect(onActivateSession).toHaveBeenCalledTimes(1);
  });

  it("disables delete button for the active streaming session", async () => {
    const user = userEvent.setup();
    renderSessionSelector({ isStreaming: true, activeSessionId: "sess-1" });

    await user.click(screen.getByRole("button", { name: /Session 2/i }));

    const activeRow = screen.getByRole("menuitem", { name: /Session 2/i });
    const inactiveRow = screen.getByRole("menuitem", { name: /Session 1/i });
    expect(within(activeRow).getByRole("button")).toBeDisabled();
    expect(within(inactiveRow).getByRole("button")).not.toBeDisabled();
  });

  it("opens delete confirmation and deletes selected session", async () => {
    const user = userEvent.setup();
    const { onDeleteSession, onActivateSession } = renderSessionSelector();

    await user.click(screen.getByRole("button", { name: /Session 2/i }));
    const targetRow = screen.getByRole("menuitem", { name: /Session 1/i });
    await user.click(within(targetRow).getByRole("button"));

    expect(screen.getByText("Delete session")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDeleteSession).toHaveBeenCalledWith("sess-2");
    expect(onActivateSession).not.toHaveBeenCalled();
  });
});
