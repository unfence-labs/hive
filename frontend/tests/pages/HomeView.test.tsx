import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HomeView from "@/pages/HomeView";

const mocks = vi.hoisted(() => ({
  useTailscaleConfig: vi.fn(),
}));

vi.mock("@/hooks/useTailscaleConfig", () => ({
  useTailscaleConfig: mocks.useTailscaleConfig,
}));

describe("HomeView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useTailscaleConfig.mockReturnValue({
      ip: "",
      port: "",
      isConfigured: false,
      setIp: vi.fn(),
      setPort: vi.fn(),
    });
  });

  it("disables the repository action and emphasizes config when tailscale config is missing", async () => {
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

  it("enables the repository action and demotes config when tailscale config exists", async () => {
    const user = userEvent.setup();
    const onAddProject = vi.fn();
    mocks.useTailscaleConfig.mockReturnValue({
      ip: "100.64.0.10",
      port: "3000",
      isConfigured: true,
      setIp: vi.fn(),
      setPort: vi.fn(),
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
