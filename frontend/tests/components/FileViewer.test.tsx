import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { FileViewer, type FileViewerHandle } from "@/components/FileViewer";
import type { ComponentProps } from "react";

function renderFileViewer(props: ComponentProps<typeof FileViewer>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <FileViewer {...props} />
    </QueryClientProvider>,
  );
}

vi.mock("@/hooks/useApi", () => ({
  api: {
    get: vi.fn(),
  },
}));

vi.mock("@/lib/shiki", () => ({
  highlightCode: vi.fn(),
}));

vi.mock("@/components/MarkdownEditor", () => ({
  MarkdownEditor: ({
    value,
    onChange,
    ariaLabel,
  }: {
    value: string;
    onChange: (value: string) => void;
    ariaLabel: string;
  }) => (
    <textarea
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

async function getApiMock() {
  const { api } = await import("@/hooks/useApi");
  return api.get as ReturnType<typeof vi.fn>;
}

async function getHighlightMock() {
  const { highlightCode } = await import("@/lib/shiki");
  return highlightCode as ReturnType<typeof vi.fn>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FileViewer", () => {
  it("shows loading skeletons initially", async () => {
    const apiMock = await getApiMock();
    // Keep API pending forever
    apiMock.mockReturnValue(new Promise(() => {}));

    renderFileViewer({ wsId: "ws-1", filePath: "src/index.ts" });

    // Skeleton elements should be visible
    const skeletons = document.querySelectorAll(".h-4");
    expect(skeletons.length).toBeGreaterThanOrEqual(1);
  });

  it("renders highlighted code after loading", async () => {
    const apiMock = await getApiMock();
    const highlightMock = await getHighlightMock();

    apiMock.mockResolvedValue({ content: "const x = 1;", path: "src/app.ts" });
    highlightMock.mockResolvedValue('<pre class="shiki"><code><span class="line">const x = 1;</span></code></pre>');

    renderFileViewer({ wsId: "ws-1", filePath: "src/app.ts" });

    await waitFor(() => {
      expect(screen.getByText("const x = 1;")).toBeInTheDocument();
    });

    expect(apiMock).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/file?path=src%2Fapp.ts",
    );
    expect(highlightMock).toHaveBeenCalledWith("const x = 1;", "typescript", expect.any(String));
  });

  it("renders image files as previews instead of fetching text content", async () => {
    const apiMock = await getApiMock();
    const highlightMock = await getHighlightMock();

    renderFileViewer({ wsId: "ws-1", filePath: "assets/logo.png" });

    const img = screen.getByRole("img", { name: "logo.png" });
    expect(img).toHaveAttribute(
      "src",
      "/api/workspaces/ws-1/file/raw?path=assets%2Flogo.png",
    );
    expect(screen.getByText("Loading preview...")).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalled();
    expect(highlightMock).not.toHaveBeenCalled();
  });

  it("shows error message when API fails", async () => {
    const apiMock = await getApiMock();
    apiMock.mockRejectedValue(new Error("File too large"));

    renderFileViewer({ wsId: "ws-1", filePath: "big-file.bin" });

    await waitFor(() => {
      expect(screen.getByText("File too large")).toBeInTheDocument();
    });
  });

  it("fetches new file when filePath changes", async () => {
    const apiMock = await getApiMock();
    const highlightMock = await getHighlightMock();

    apiMock.mockResolvedValue({ content: "first", path: "a.ts" });
    highlightMock.mockResolvedValue('<pre class="shiki"><code><span class="line">first</span></code></pre>');

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { rerender } = render(<FileViewer wsId="ws-1" filePath="a.ts" />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText("first")).toBeInTheDocument();
    });

    apiMock.mockResolvedValue({ content: "second", path: "b.ts" });
    highlightMock.mockResolvedValue('<pre class="shiki"><code><span class="line">second</span></code></pre>');

    rerender(<FileViewer wsId="ws-1" filePath="b.ts" />);

    await waitFor(() => {
      expect(screen.getByText("second")).toBeInTheDocument();
    });

    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  it("uses correct language mapping for various extensions", async () => {
    const apiMock = await getApiMock();
    const highlightMock = await getHighlightMock();

    const cases = [
      { path: "app.tsx", lang: "tsx" },
      { path: "style.css", lang: "css" },
      { path: "config.json", lang: "json" },
      { path: "README.md", lang: "markdown" },
      { path: "script.py", lang: "python" },
      { path: "unknown.xyz", lang: "text" },
    ];

    for (const { path, lang } of cases) {
      vi.clearAllMocks();
      apiMock.mockResolvedValue({ content: "code", path });
      highlightMock.mockResolvedValue(`<pre class="shiki"><code><span class="line">${lang}</span></code></pre>`);

      const { unmount } = renderFileViewer({ wsId: "ws-1", filePath: path });

      await waitFor(() => {
        expect(highlightMock).toHaveBeenCalledWith("code", lang, expect.any(String));
      });

      unmount();
    }
  });

  it("renders the file-viewer container with proper classes", async () => {
    const apiMock = await getApiMock();
    const highlightMock = await getHighlightMock();

    apiMock.mockResolvedValue({ content: "x", path: "f.ts" });
    highlightMock.mockResolvedValue('<pre class="shiki"><code><span class="line">x</span></code></pre>');

    renderFileViewer({ wsId: "ws-1", filePath: "f.ts" });

    await waitFor(() => {
      const container = document.querySelector(".file-viewer");
      expect(container).toBeInTheDocument();
      expect(container?.querySelector(".file-viewer-content")).toBeInTheDocument();
    });
  });

  it("flushes a pending editable write through the imperative handle", async () => {
    const apiMock = await getApiMock();
    apiMock.mockResolvedValue({ content: "old", path: "notes/a.md" });
    const onWriteToDisk = vi.fn().mockResolvedValue(undefined);
    const ref = React.createRef<FileViewerHandle>();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <FileViewer
          ref={ref}
          wsId="brain"
          filePath="notes/a.md"
          editable
          onWriteToDisk={onWriteToDisk}
        />
      </QueryClientProvider>,
    );

    const editor = await screen.findByLabelText("File content");
    fireEvent.change(editor, { target: { value: "new" } });
    expect(onWriteToDisk).not.toHaveBeenCalled();

    await act(async () => {
      await ref.current?.flushPendingWrite();
    });

    expect(onWriteToDisk).toHaveBeenCalledWith("notes/a.md", "new");
  });

  it("renders a truncated file read-only even when editable is requested", async () => {
    const apiMock = await getApiMock();
    const highlightMock = await getHighlightMock();
    apiMock.mockResolvedValue({ content: "prefix only", path: "notes/big.md", truncated: true });
    highlightMock.mockResolvedValue(
      '<pre class="shiki"><code><span class="line">prefix only</span></code></pre>',
    );
    const onWriteToDisk = vi.fn();

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <FileViewer wsId="brain" filePath="notes/big.md" editable onWriteToDisk={onWriteToDisk} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText(/too large to load fully/i)).toBeInTheDocument();
    });
    // No editor is rendered, so the truncated tail can never be overwritten.
    expect(screen.queryByLabelText("File content")).not.toBeInTheDocument();
  });
});
