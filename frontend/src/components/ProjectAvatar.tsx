import { useState } from "react";
import { cn } from "@/lib/utils";
import { getProjectColor } from "@/lib/project-colors";
import { getServerUrl } from "@/hooks/useServerUrl";

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
  let faviconUrl = hasFavicon && projectId
    ? `${getServerUrl()}/api/projects/${projectId}/favicon`
    : undefined;
  if (faviconUrl && faviconVersion) faviconUrl += `?v=${encodeURIComponent(faviconVersion)}`;

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
