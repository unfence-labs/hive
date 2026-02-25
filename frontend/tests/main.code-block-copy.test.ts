import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn(),
  createRoot: vi.fn(),
  render: vi.fn(),
}));

vi.mock("@/lib/clipboard", () => ({
  copyToClipboard: mocks.copyToClipboard,
}));

vi.mock("@/App", () => ({
  default: () => null,
}));

vi.mock("@/lib/query-client", () => ({
  queryClient: {},
}));

vi.mock("react-dom/client", () => ({
  createRoot: (el: HTMLElement) => {
    mocks.createRoot(el);
    return { render: mocks.render };
  },
}));

describe("main.tsx streamdown copy fallback", () => {
  beforeAll(async () => {
    document.body.innerHTML = '<div id="root"></div>';
    await import("@/main");
  });

  beforeEach(() => {
    mocks.copyToClipboard.mockReset();
    document.querySelectorAll('[data-test-fixture="streamdown"]').forEach((el) => el.remove());
  });

  function addCodeBlockFixture(code: string) {
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-test-fixture", "streamdown");
    wrapper.innerHTML = `
      <div data-streamdown="code-block">
        <button type="button" data-streamdown="code-block-copy-button">
          <span data-testid="inner-target">copy</span>
        </button>
        <div data-streamdown="code-block-body"><code>${code}</code></div>
      </div>
    `;
    document.body.appendChild(wrapper);
    const target = wrapper.querySelector('[data-testid="inner-target"]');
    if (!target) throw new Error("fixture target not found");
    return { target };
  }

  it("copies code block text when streamdown copy button is clicked", () => {
    const { target } = addCodeBlockFixture("echo hello");
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(mocks.copyToClipboard).toHaveBeenCalledWith("echo hello");
  });

  it("ignores clicks outside streamdown copy button", () => {
    const outside = document.createElement("button");
    outside.textContent = "outside";
    document.body.appendChild(outside);

    outside.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(mocks.copyToClipboard).not.toHaveBeenCalled();
  });

  it("does not copy when code body is missing", () => {
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-test-fixture", "streamdown");
    wrapper.innerHTML = `
      <div data-streamdown="code-block">
        <button type="button" data-streamdown="code-block-copy-button">
          <span data-testid="inner-target">copy</span>
        </button>
      </div>
    `;
    document.body.appendChild(wrapper);

    const target = wrapper.querySelector('[data-testid="inner-target"]');
    if (!target) throw new Error("fixture target not found");
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(mocks.copyToClipboard).not.toHaveBeenCalled();
  });
});
