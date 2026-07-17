import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  closeSetupWizard,
  openSetupWizard,
  useSetupWizardRequest,
} from "@/hooks/useSetupWizardRequest";

describe("useSetupWizardRequest", () => {
  it("reflects open/close requests", () => {
    const { result } = renderHook(() => useSetupWizardRequest());
    expect(result.current).toBe(false);

    act(() => openSetupWizard());
    expect(result.current).toBe(true);

    act(() => closeSetupWizard());
    expect(result.current).toBe(false);
  });
});
