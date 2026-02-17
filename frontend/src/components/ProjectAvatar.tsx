import { useState } from "react";
import { cn } from "@/lib/utils";
import { getProjectColor } from "@/lib/project-colors";
import { getServerUrl } from "@/hooks/useServerUrl";

interface ProjectAvatarProps {
  name: string;
  projectId?: string;
  hasFavicon?: boolean;
  className?: string;
}

export function ProjectAvatar({ name, projectId, hasFavicon, className }: ProjectAvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);

  const size = "h-5 w-5";
  const sizeClass = className?.includes("h-") ? "" : size;

  if (hasFavicon && projectId && !imgFailed) {
    const faviconUrl = `${getServerUrl()}/api/projects/${projectId}/favicon`;
    return (
      <img
        src={faviconUrl}
        alt={name}
        onError={() => setImgFailed(true)}
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
