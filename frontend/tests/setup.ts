import "@testing-library/jest-dom/vitest";

class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverMock);

// Node 22+ ships a native experimental `localStorage` that shadows jsdom's
// Storage implementation and lacks methods like `removeItem`. Force a
// jsdom-compatible stub so tests work regardless of the host Node version.
if (typeof window !== "undefined") {
  const needsShim =
    typeof window.localStorage?.removeItem !== "function" ||
    typeof window.localStorage?.getItem !== "function";
  if (needsShim) {
    const store = new Map<string, string>();
    const storage: Storage = {
      get length() {
        return store.size;
      },
      clear: () => store.clear(),
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => {
        store.set(key, String(value));
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      key: (index: number) => Array.from(store.keys())[index] ?? null,
    };
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: () => storage,
    });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => storage,
    });
  }
}

// jsdom does not implement matchMedia
if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}
