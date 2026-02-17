import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ConductorMigration from "@/pages/settings/ConductorMigration";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock("@/hooks/useApi", () => ({
  api: {
    get: mocks.get,
  },
}));

vi.mock("@/hooks/useServerUrl", () => ({
  getServerUrl: () => "http://localhost:3000",
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("ConductorMigration", () => {
  it("shows scanning state initially", () => {
    mocks.get.mockReturnValue(new Promise(() => {})); // never resolves
    render(<ConductorMigration />);
    expect(screen.getByText("Scanning for Conductor data...")).toBeInTheDocument();
  });

  it("shows not-found message when no Conductor DB exists", async () => {
    mocks.get.mockResolvedValueOnce({
      found: false,
      dbPath: "/path/to/db",
      projects: [],
      totals: { projects: 0, workspaces: 0, sessions: 0, messages: 0 },
    });

    render(<ConductorMigration />);

    await screen.findByText("No Conductor installation found");
    expect(screen.getByText(/Could not find a Conductor database/)).toBeInTheDocument();
  });

  it("shows not-found on API error", async () => {
    mocks.get.mockRejectedValueOnce(new Error("network error"));

    render(<ConductorMigration />);

    await screen.findByText("No Conductor installation found");
  });

  it("displays detected projects with counts", async () => {
    mocks.get.mockResolvedValueOnce({
      found: true,
      dbPath: "/path/to/conductor.db",
      projects: [
        {
          id: "repo-1",
          name: "avnu-saas",
          remoteUrl: "git@github.com:avnu/avnu-saas.git",
          workspaceCount: 3,
          sessionCount: 5,
          messageCount: 150,
          alreadyImported: false,
        },
        {
          id: "repo-2",
          name: "avnu-swap",
          remoteUrl: "git@github.com:avnu/avnu-swap.git",
          workspaceCount: 2,
          sessionCount: 3,
          messageCount: 80,
          alreadyImported: true,
        },
      ],
      totals: { projects: 2, workspaces: 5, sessions: 8, messages: 230 },
    });

    render(<ConductorMigration />);

    await screen.findByText("2 projects detected on Conductor");
    expect(screen.getByText(/5 workspaces, 8 sessions, 230 messages/)).toBeInTheDocument();

    expect(screen.getByText("avnu-saas")).toBeInTheDocument();
    expect(screen.getByText("avnu-swap")).toBeInTheDocument();
    expect(screen.getByText("Already imported")).toBeInTheDocument();
    expect(screen.getByText("Import 1 project to Hive")).toBeInTheDocument();
  });

  it("shows all-imported message when every project is already imported", async () => {
    mocks.get.mockResolvedValueOnce({
      found: true,
      dbPath: "/path/to/conductor.db",
      projects: [
        {
          id: "repo-1",
          name: "avnu-saas",
          remoteUrl: "git@github.com:avnu/avnu-saas.git",
          workspaceCount: 3,
          sessionCount: 5,
          messageCount: 150,
          alreadyImported: true,
        },
      ],
      totals: { projects: 1, workspaces: 3, sessions: 5, messages: 150 },
    });

    render(<ConductorMigration />);

    await screen.findByText("All projects are already imported.");
  });

  it("renders page header correctly", async () => {
    mocks.get.mockResolvedValueOnce({
      found: false,
      dbPath: "/path/to/db",
      projects: [],
      totals: { projects: 0, workspaces: 0, sessions: 0, messages: 0 },
    });

    render(<ConductorMigration />);

    await screen.findByRole("heading", { name: "Import from Conductor" });
    expect(screen.getByText(/Migrate your Conductor projects/)).toBeInTheDocument();
  });

  it("title bar has tauri drag region", async () => {
    mocks.get.mockResolvedValueOnce({
      found: false,
      dbPath: "/path/to/db",
      projects: [],
      totals: { projects: 0, workspaces: 0, sessions: 0, messages: 0 },
    });

    render(<ConductorMigration />);

    const heading = await screen.findByRole("heading", { name: "Import from Conductor" });
    expect(heading.closest("div")).toHaveAttribute("data-tauri-drag-region");
  });
});
