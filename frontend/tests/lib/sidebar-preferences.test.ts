import { afterEach, describe, expect, it } from "vitest";
import {
  readLegacySidebarPreferences,
  readSidebarPreferencesLocalSeed,
} from "@/lib/sidebar-preferences";

const originalWindowLocalStorage = window.localStorage;
const originalGlobalLocalStorage = globalThis.localStorage;

function installThrowingLocalStorage(): void {
  const throwingStorage = {
    getItem: () => {
      throw new Error("storage disabled");
    },
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0,
  } as Storage;

  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: throwingStorage,
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: throwingStorage,
  });
}

afterEach(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: originalWindowLocalStorage,
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: originalGlobalLocalStorage,
  });
});

describe("sidebar local storage reads", () => {
  it("falls back to an empty seed when localStorage.getItem throws", () => {
    installThrowingLocalStorage();

    expect(readSidebarPreferencesLocalSeed()).toEqual({
      source: "empty",
      state: { folders: [], folderOpenState: {} },
    });
  });

  it("returns null for legacy preferences when localStorage.getItem throws", () => {
    installThrowingLocalStorage();

    expect(readLegacySidebarPreferences()).toBeNull();
  });
});
