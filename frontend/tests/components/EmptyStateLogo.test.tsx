import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EmptyStateLogo from "@/components/EmptyStateLogo";

const mocks = vi.hoisted(() => ({
  useTailscaleConfig: vi.fn(),
}));

vi.mock("@/hooks/useTailscaleConfig", () => ({
  useTailscaleConfig: mocks.useTailscaleConfig,
}));

describe("EmptyStateLogo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    mocks.useTailscaleConfig.mockReturnValue({
      ip: "",
      port: "",
      isConfigured: false,
      setIp: vi.fn(),
      setPort: vi.fn(),
    });
  });

  it("disables repository action when tailscale config is missing", async () => {
    const user = userEvent.setup();
    const onAddProject = vi.fn();

    render(
      <MemoryRouter>
        <EmptyStateLogo onAddProject={onAddProject} />
      </MemoryRouter>,
    );

    const addRepository = screen.getByRole("button", { name: /add repository/i });
    expect(addRepository).toBeDisabled();
    await user.click(addRepository);
    expect(onAddProject).not.toHaveBeenCalled();

    const startConfig = screen.getByRole("link", { name: /start config/i });
    expect(startConfig).toHaveAttribute("href", "/settings");

    const docs = screen.getByRole("link", { name: /documentation/i });
    expect(docs).toHaveAttribute("href", "https://docs.hive.dev");
    expect(docs).toHaveAttribute("target", "_blank");
  });

  it("enables repository action when tailscale config exists", async () => {
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
        <EmptyStateLogo onAddProject={onAddProject} />
      </MemoryRouter>,
    );

    const addRepository = screen.getByRole("button", { name: /add repository/i });
    expect(addRepository).toBeEnabled();
    await user.click(addRepository);
    expect(onAddProject).toHaveBeenCalledTimes(1);
  });
});
