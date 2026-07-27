import { useState } from "react";
import { cn } from "@/lib/utils";
import { getProjectColor } from "@/lib/project-colors";
import { resolveApiResourceSrc } from "@/lib/image-url";

interface ProjectAvatarProps {
  name: string;
  projectId?: string;
  hasFavicon?: boolean;
  faviconVersion?: string;
  className?: string;
}

export function ProjectAvatar({ name, projectId, hasFavicon, faviconVersion, className }: ProjectAvatarProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  const size = "h-5 w-5";
  const sizeClass = className?.includes("h-") ? "" : size;
  // The favicon route is token-protected like any other API resource, and an
  // <img> cannot set headers — resolveApiResourceSrc appends the token.
  let faviconPath = hasFavicon && projectId
    ? `/api/projects/${projectId}/favicon`
    : undefined;
  if (faviconPath && faviconVersion) faviconPath += `?v=${encodeURIComponent(faviconVersion)}`;
  const faviconUrl = faviconPath ? resolveApiResourceSrc(faviconPath) : undefined;

  if (faviconUrl && failedUrl !== faviconUrl) {
    return (
      <img
        src={faviconUrl}
        alt={name}
        onError={() => setFailedUrl(faviconUrl)}
        className={cn(
          "shrink-0 rounded object-cover",
          sizeClass,
          className,
        )}
      />
    );
  }

  const color = getProjectColor(name);
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded text-[10px] font-bold",
        sizeClass,
        color.bg,
        color.text,
        className,
      )}
    >
      {name[0]?.toUpperCase() ?? "?"}
    </span>
  );
}
