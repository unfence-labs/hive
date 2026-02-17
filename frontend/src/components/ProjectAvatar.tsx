import { cn } from "@/lib/utils";
import { getProjectColor } from "@/lib/project-colors";

interface ProjectAvatarProps {
  name: string;
  className?: string;
}

export function ProjectAvatar({ name, className }: ProjectAvatarProps) {
  const color = getProjectColor(name);
  return (
    <span
      className={cn(
        "flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold",
        color.bg,
        color.text,
        className,
      )}
    >
      {name[0]?.toUpperCase() ?? "?"}
    </span>
  );
}
