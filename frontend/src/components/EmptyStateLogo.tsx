import hiveLogo from "@/assets/hive-logo.png";
import { cn } from "@/lib/utils";

interface EmptyStateLogoProps {
  className?: string;
}

export default function EmptyStateLogo({ className }: EmptyStateLogoProps) {
  return (
    <div className={cn("flex h-full flex-col items-center justify-center gap-4", className)}>
      <img
        src={hiveLogo}
        alt="Hive logo"
        className="h-44 w-44 object-contain md:h-56 md:w-56"
      />
      <h1 className="font-[family-name:var(--font-title)] text-6xl tracking-widest text-white md:text-8xl">
        HIVE
      </h1>
    </div>
  );
}
