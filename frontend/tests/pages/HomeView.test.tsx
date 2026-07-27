import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HomeView from "@/pages/HomeView";

const mocks = vi.hoisted(() => ({
  useConnection: vi.fn(),
}));

vi.mock("@/hooks/useConnection", () => ({
  useConnection: mocks.useConnection,
}));

describe("HomeView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useConnection.mockReturnValue({ connection: null, isConfigured: false });
  });

  it("disables the repository action and emphasizes config when no server is configured", async () => {
    const user = userEvent.setup();
    const onAddProject = vi.fn();

    render(
      <MemoryRouter>
        <HomeView onAddProject={onAddProject} />
      </MemoryRouter>,
    );

    const addRepository = screen.getByRole("button", { name: /add repository/i });
    expect(addRepository).toBeDisabled();
    await user.click(addRepository);
    expect(onAddProject).not.toHaveBeenCalled();

    // Until the server is configured, "Start config" carries the primary emphasis.
    const startConfig = screen.getByRole("link", { name: /start config/i });
    expect(startConfig).toHaveAttribute("href", "/settings");
    expect(startConfig).toHaveAttribute("data-variant", "default");

    const docs = screen.getByRole("link", { name: /documentation/i });
    expect(docs).toHaveAttribute("href", "https://docs.hive.dev");
    expect(docs).toHaveAttribute("target", "_blank");
  });

  it("enables the repository action and demotes config when a server is configured", async () => {
    const user = userEvent.setup();
    const onAddProject = vi.fn();
    mocks.useConnection.mockReturnValue({
      connection: { host: "100.64.0.10", port: 3000 },
      isConfigured: true,
    });

    render(
      <MemoryRouter>
        <HomeView onAddProject={onAddProject} />
      </MemoryRouter>,
    );

    const addRepository = screen.getByRole("button", { name: /add repository/i });
    expect(addRepository).toBeEnabled();
    await user.click(addRepository);
    expect(onAddProject).toHaveBeenCalledTimes(1);

    // Once configured, the primary emphasis moves to "Add repository".
    const startConfig = screen.getByRole("link", { name: /start config/i });
    expect(startConfig).toHaveAttribute("data-variant", "outline");
  });
});
