import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AutocompletePopup } from "@/components/chat/AutocompletePopup";
import type { CompletionItem } from "@/types";

function makeItem(
  name: string,
  source: CompletionItem["source"],
  description?: string,
): CompletionItem {
  return {
    type: name.startsWith("agent") ? "agent" : "slash_command",
    name,
    label: source.includes("agent") ? `@${name}` : `/${name}`,
    description,
    source,
  };
}

describe("AutocompletePopup", () => {
  it("renders nothing when there are no items", () => {
    const { container } = render(
      <AutocompletePopup
        items={[]}
        selectedIndex={0}
        onSelect={vi.fn()}
        onHover={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("groups items by source using the expected display order", () => {
    const { container } = render(
      <AutocompletePopup
        items={[
          makeItem("agent-z", "project_agent"),
          makeItem("help", "builtin"),
          makeItem("deploy", "user_skill"),
          makeItem("agent-a", "user_agent"),
          makeItem("local", "project_skill"),
        ]}
        selectedIndex={0}
        onSelect={vi.fn()}
        onHover={vi.fn()}
      />,
    );

    const headerTexts = Array.from(container.querySelectorAll(".sticky")).map((el) =>
      el.textContent?.trim(),
    );
    expect(headerTexts).toEqual([
      "Commands",
      "Skills",
      "Project Skills",
      "Agents",
      "Project Agents",
    ]);
  });

  it("falls back to raw source label for unknown sources", () => {
    render(
      <AutocompletePopup
        items={[
          makeItem("help", "builtin"),
          makeItem("custom", "plugin"),
          {
            ...makeItem("x", "builtin"),
            source: "custom_source" as CompletionItem["source"],
            label: "/custom-source",
          },
        ]}
        selectedIndex={0}
        onSelect={vi.fn()}
        onHover={vi.fn()}
      />,
    );

    expect(screen.getByText("custom_source")).toBeInTheDocument();
  });

  it("uses opaque header backgrounds to avoid scroll bleed", () => {
    render(
      <AutocompletePopup
        items={[makeItem("help", "builtin"), makeItem("agent-a", "user_agent")]}
        selectedIndex={0}
        onSelect={vi.fn()}
        onHover={vi.fn()}
      />,
    );

    const commandsHeader = screen.getByText("Commands");
    expect(commandsHeader.className).toContain("bg-black/5");
    expect(commandsHeader.className).toContain("dark:bg-[var(--header-bg)]");
  });

  it("marks the selected item using selectedIndex", () => {
    render(
      <AutocompletePopup
        items={[makeItem("help", "builtin"), makeItem("deploy", "user_skill")]}
        selectedIndex={1}
        onSelect={vi.fn()}
        onHover={vi.fn()}
      />,
    );

    const selected = screen.getByRole("button", { name: /\/deploy/i });
    const unselected = screen.getByRole("button", { name: /\/help/i });

    expect(selected.className).toContain("bg-primary/10");
    expect(unselected.className).toContain("hover:bg-white/[0.04]");
  });

  it("calls onSelect on mousedown and prevents default", () => {
    const onSelect = vi.fn();
    const item = makeItem("help", "builtin", "Show available commands");

    render(
      <AutocompletePopup
        items={[item]}
        selectedIndex={0}
        onSelect={onSelect}
        onHover={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", { name: /\/help/i });
    const notCancelled = fireEvent.mouseDown(button);

    expect(notCancelled).toBe(false);
    expect(onSelect).toHaveBeenCalledWith(item);
  });

  it("calls onHover with global item index", () => {
    const onHover = vi.fn();

    render(
      <AutocompletePopup
        items={[
          makeItem("help", "builtin"),
          makeItem("deploy", "user_skill"),
          makeItem("agent-a", "user_agent"),
        ]}
        selectedIndex={0}
        onSelect={vi.fn()}
        onHover={onHover}
      />,
    );

    const thirdButton = screen.getByRole("button", { name: /@agent-a/i });
    fireEvent.mouseEnter(thirdButton);

    expect(onHover).toHaveBeenCalledWith(2);
  });

  it("renders description text when provided", () => {
    render(
      <AutocompletePopup
        items={[makeItem("help", "builtin", "Show available commands")]}
        selectedIndex={0}
        onSelect={vi.fn()}
        onHover={vi.fn()}
      />,
    );

    expect(screen.getByText("Show available commands")).toBeInTheDocument();
  });
});
