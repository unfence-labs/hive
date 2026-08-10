import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HiveToaster } from "@/components/ui/toaster";

const mocks = vi.hoisted(() => ({
  toaster: vi.fn(() => null),
  useToastPosition: vi.fn(),
}));

vi.mock("sonner", () => ({ Toaster: mocks.toaster }));
vi.mock("@/hooks/useThemeType", () => ({ useThemeType: () => "dark" }));
vi.mock("@/hooks/useToastPosition", () => ({ useToastPosition: mocks.useToastPosition }));

describe("HiveToaster", () => {
  beforeEach(() => {
    mocks.toaster.mockClear();
    mocks.useToastPosition.mockReturnValue({ position: "bottom-center" });
  });

  it("uses the local position and Sonner's default swipe behavior", () => {
    render(<HiveToaster />);

    const props = mocks.toaster.mock.calls[0]?.[0];
    expect(props).toEqual(expect.objectContaining({ position: "bottom-center", theme: "dark" }));
    expect(props).not.toHaveProperty("swipeDirections");
  });
});
