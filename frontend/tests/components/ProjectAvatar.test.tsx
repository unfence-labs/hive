import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ProjectAvatar } from "@/components/ProjectAvatar";
import { replaceConnection } from "@/hooks/useConnection";

describe("ProjectAvatar", () => {
  beforeEach(() => {
    localStorage.clear();
    replaceConnection({ host: "127.0.0.1", port: 4000 });
  });

  it("carries the runtime token on the token-protected favicon route", () => {
    replaceConnection({ host: "127.0.0.1", port: 4000, authToken: "tok" });
    render(<ProjectAvatar name="Alpha" projectId="p1" hasFavicon />);

    expect(screen.getByRole("img", { name: "Alpha" })).toHaveAttribute(
      "src",
      "http://127.0.0.1:4000/api/projects/p1/favicon?token=tok",
    );
  });

  it("renders an image when hasFavicon and projectId are provided", () => {
    render(<ProjectAvatar name="Alpha" projectId="p1" hasFavicon />);

    const img = screen.getByRole("img", { name: "Alpha" });
    expect(img).toHaveAttribute("src", "http://127.0.0.1:4000/api/projects/p1/favicon");
    expect(img.className).toContain("h-5");
    expect(img.className).toContain("w-5");
  });

  it("adds the favicon version to the image URL", () => {
    render(<ProjectAvatar name="Alpha" projectId="p1" hasFavicon faviconVersion="abc123" />);

    expect(screen.getByRole("img", { name: "Alpha" })).toHaveAttribute(
      "src",
      "http://127.0.0.1:4000/api/projects/p1/favicon?v=abc123",
    );
  });

  it("falls back to the initial letter when favicon image fails", () => {
    render(<ProjectAvatar name="Alpha" projectId="p1" hasFavicon />);

    const img = screen.getByRole("img", { name: "Alpha" });
    fireEvent.error(img);

    expect(screen.queryByRole("img", { name: "Alpha" })).not.toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("renders initials when favicon is unavailable", () => {
    render(<ProjectAvatar name="Bravo" />);

    expect(screen.queryByRole("img", { name: "Bravo" })).not.toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
  });

  it("renders '?' when name is empty", () => {
    render(<ProjectAvatar name="" />);
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("does not render image when projectId is missing", () => {
    render(<ProjectAvatar name="Charlie" hasFavicon />);
    expect(screen.queryByRole("img", { name: "Charlie" })).not.toBeInTheDocument();
    expect(screen.getByText("C")).toBeInTheDocument();
  });

  it("uses provided size classes instead of default size classes", () => {
    render(<ProjectAvatar name="Delta" className="h-8 w-8 rounded-md" />);
    const fallback = screen.getByText("D");

    expect(fallback.className).toContain("h-8");
    expect(fallback.className).toContain("w-8");
    expect(fallback.className).not.toContain("h-5");
    expect(fallback.className).not.toContain("w-5");
  });
});
