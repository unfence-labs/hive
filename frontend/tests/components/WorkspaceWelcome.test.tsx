import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
});
