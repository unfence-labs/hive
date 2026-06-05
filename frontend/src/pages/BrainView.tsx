import { Brain } from "lucide-react";
import { useBrain } from "@/hooks/useBrain";

export default function BrainView() {
  const { brain, loading } = useBrain();

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold text-foreground">Brain</h1>
        </div>
      </div>

      <main className="flex flex-1 flex-col justify-center px-6">
        {/* The real three-column Brain layout lands in M-B. */}
        <div className="max-w-xl">
          <p className="text-sm font-medium text-foreground">
            Brain workspace — coming soon
          </p>
          <p className="mt-2 break-all text-sm text-muted-foreground">
            {loading
              ? "Loading Brain repository..."
              : brain.exists
                ? brain.repoUrl
                : "No Brain repository connected."}
          </p>
        </div>
      </main>
    </div>
  );
}
