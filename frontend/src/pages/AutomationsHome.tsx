import { Clock, Github, Plus, Zap } from "lucide-react";

interface AutomationsHomeProps {
  onAddAutomation?: () => void;
}

export default function AutomationsHome({ onAddAutomation }: AutomationsHomeProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-6">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border/50 bg-card/50">
          <Zap className="h-6 w-6 text-primary/60" />
        </div>
      </div>

      <div className="text-center">
        <h2 className="text-sm font-medium text-foreground">Automations</h2>
        <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-muted-foreground">
          Schedule agents to run automatically on a cron schedule.
          GitHub event triggers are coming soon.
        </p>
      </div>

      <div className="flex items-center gap-6 text-xs text-muted-foreground/60">
        <span className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" />
          Cron
        </span>
        <span className="flex items-center gap-1.5">
          <Github className="h-3.5 w-3.5" />
          GitHub
          <span className="rounded bg-muted/40 px-1 py-0.5 text-[10px]">soon</span>
        </span>
      </div>

      {onAddAutomation && (
        <button
          type="button"
          onClick={onAddAutomation}
          className="flex items-center gap-2 rounded-md border border-dashed border-primary/40 px-5 py-2.5 text-sm text-primary transition-colors hover:border-primary hover:bg-primary/10"
        >
          <Plus className="h-4 w-4" />
          Create automation
        </button>
      )}
    </div>
  );
}
