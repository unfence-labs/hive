import { render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceWelcome } from "@/components/WorkspaceWelcome";

describe("WorkspaceWelcome", () => {
  it("renders workspace/project copy details and branch origin", () => {
    render(
      <WorkspaceWelcome
        projectName="hive"
        workspaceName="san-antonio"
        branch="workspace/san-antonio"
        defaultBranch="main"
        fileCount={12345}
      />,
    );

    expect(screen.getByText(/You're in a new copy of/i)).toBeInTheDocument();
    expect(screen.getByText("hive")).toBeInTheDocument();
    expect(screen.getAllByText("san-antonio")).toHaveLength(2);
    expect(screen.getByText("workspace/san-antonio")).toBeInTheDocument();
    expect(screen.getByText("origin/main")).toBeInTheDocument();
    expect(screen.getByText("12,345")).toBeInTheDocument();
  });

  it("omits the start-terminal button when onStartTerminal is absent", () => {
    render(
      <WorkspaceWelcome
        projectName="hive"
        workspaceName="san-antonio"
        branch="workspace/san-antonio"
        defaultBranch="main"
        fileCount={12}
      />,
    );

    expect(screen.queryByRole("button", { name: /start a terminal/i })).not.toBeInTheDocument();
  });

  it("renders the start-terminal button and invokes the callback when provided", () => {
    const onStartTerminal = vi.fn();
    render(
      <WorkspaceWelcome
        projectName="hive"
        workspaceName="san-antonio"
        branch="workspace/san-antonio"
        defaultBranch="main"
        fileCount={12}
        onStartTerminal={onStartTerminal}
      />,
    );

    const button = screen.getByRole("button", { name: /start a terminal/i });
    fireEvent.click(button);
    expect(onStartTerminal).toHaveBeenCalledTimes(1);
  });
});
