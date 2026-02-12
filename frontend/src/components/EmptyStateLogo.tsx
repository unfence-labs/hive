import hiveLogo from "@/assets/hive-logo.png";
import { cn } from "@/lib/utils";

interface EmptyStateLogoProps {
  className?: string;
}

export default function EmptyStateLogo({ className }: EmptyStateLogoProps) {
  return (
    <div className={cn("flex h-full items-center justify-center", className)}>
      <img
        src={hiveLogo}
        alt="Hive logo"
        className="h-44 w-44 object-contain md:h-56 md:w-56"
      />
    </div>
  );
}
