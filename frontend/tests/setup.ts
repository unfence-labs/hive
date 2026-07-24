import "@testing-library/jest-dom/vitest";

afterEach(() => {
  if (typeof localStorage !== "undefined") {
    localStorage.clear();
  }
});

class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverMock);

if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null);
}

// Node 22+ ships an experimental global `localStorage` that can shadow jsdom's
// implementation and emit warnings when accessed without a storage file.
if (typeof window !== "undefined") {
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

// CodeMirror measures DOM ranges for cursor and selection rendering. jsdom does
// not provide these layout APIs, so expose deterministic zero-sized rectangles.
if (typeof Range !== "undefined") {
  Range.prototype.getClientRects ??= vi.fn(() => ({
    length: 0,
    item: () => null,
    [Symbol.iterator]: function* () {},
  }) as DOMRectList);

  Range.prototype.getBoundingClientRect ??= vi.fn(() => ({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    toJSON: () => ({}),
  }) as DOMRect);
}
