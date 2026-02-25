import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  WorkspaceLiveDataProvider,
  useClearUnread,
  useWorkspaceLive,
  useWorkspaceLiveDataContext,
} from "@/contexts/WorkspaceLiveDataContext";

const mocks = vi.hoisted(() => ({
  useWorkspaceLiveData: vi.fn(),
}));

vi.mock("@/hooks/useWorkspaceLiveData", () => ({
  useWorkspaceLiveData: mocks.useWorkspaceLiveData,
}));

function ContextProbe({ wsId }: { wsId?: string }) {
  const map = useWorkspaceLiveDataContext();
  const single = useWorkspaceLive(wsId);
  return (
    <>
      <pre data-testid="map">{JSON.stringify(map)}</pre>
      <pre data-testid="single">{JSON.stringify(single)}</pre>
    </>
  );
}

function ClearUnreadProbe({ wsId = "ws-1", sessionId }: { wsId?: string; sessionId?: string }) {
  const clearUnread = useClearUnread();
  return (
    <button type="button" onClick={() => clearUnread(wsId, sessionId)}>
      clear unread
    </button>
  );
}

describe("WorkspaceLiveDataContext", () => {
  const clearUnread = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useWorkspaceLiveData.mockReturnValue({ liveData: {}, clearUnread });
  });

  it("exposes empty defaults outside provider", () => {
    render(<ContextProbe wsId="ws-1" />);

    expect(screen.getByTestId("map")).toHaveTextContent("{}");
    expect(screen.getByTestId("single")).toHaveTextContent("{}");
  });

  it("useClearUnread outside provider is a safe no-op", async () => {
    const user = userEvent.setup();
    render(<ClearUnreadProbe wsId="ws-1" sessionId="sess-1" />);

    await user.click(screen.getByRole("button", { name: "clear unread" }));
    expect(clearUnread).not.toHaveBeenCalled();
  });

  it("passes workspace ids to useWorkspaceLiveData and provides full map", () => {
    const liveData = {
      "ws-1": { status: "busy", streaming: true },
      "ws-2": { status: "idle", scriptRunning: false },
    };
    mocks.useWorkspaceLiveData.mockReturnValue({ liveData, clearUnread });

    render(
      <WorkspaceLiveDataProvider workspaceIds={["ws-1", "ws-2"]}>
        <ContextProbe wsId="ws-2" />
      </WorkspaceLiveDataProvider>,
    );

    expect(mocks.useWorkspaceLiveData).toHaveBeenCalledWith(["ws-1", "ws-2"]);
    expect(JSON.parse(screen.getByTestId("map").textContent ?? "{}")).toEqual(liveData);
    expect(JSON.parse(screen.getByTestId("single").textContent ?? "{}")).toEqual(
      liveData["ws-2"],
    );
  });

  it("returns empty object for undefined workspace id in useWorkspaceLive", () => {
    const liveData = { "ws-1": { status: "busy" } };
    mocks.useWorkspaceLiveData.mockReturnValue({ liveData, clearUnread });

    render(
      <WorkspaceLiveDataProvider workspaceIds={["ws-1"]}>
        <ContextProbe />
      </WorkspaceLiveDataProvider>,
    );

    expect(JSON.parse(screen.getByTestId("single").textContent ?? "{}")).toEqual({});
  });

  it("returns empty object when workspace id is missing from map", () => {
    const liveData = { "ws-1": { status: "idle" } };
    mocks.useWorkspaceLiveData.mockReturnValue({ liveData, clearUnread });

    render(
      <WorkspaceLiveDataProvider workspaceIds={["ws-1"]}>
        <ContextProbe wsId="ws-404" />
      </WorkspaceLiveDataProvider>,
    );

    expect(JSON.parse(screen.getByTestId("single").textContent ?? "{}")).toEqual({});
  });

  it("useClearUnread forwards calls to the hook implementation from provider", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceLiveDataProvider workspaceIds={["ws-1"]}>
        <ClearUnreadProbe wsId="ws-1" sessionId="sess-1" />
      </WorkspaceLiveDataProvider>,
    );

    await user.click(screen.getByRole("button", { name: "clear unread" }));
    expect(clearUnread).toHaveBeenCalledWith("ws-1", "sess-1");
  });
});
