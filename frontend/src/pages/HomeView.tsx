import { Link } from "react-router-dom";
import { FolderGit2, Settings } from "lucide-react";
import { PageHeader } from "@/components/AppLayout";
import { CenterCard } from "@/components/CenterCard";
import { HiveLogo } from "@/components/HiveLogo";
import { Button } from "@/components/ui/button";
import { useConnection } from "@/hooks/useConnection";

interface HomeViewProps {
  onAddProject?: () => void;
}

/**
 * Landing / empty state shown at `/home` (and where projects, automations, etc.
 * redirect before anything is selected). It follows the same shell contract as
 * every other view — a {@link PageHeader} on the shell above a floating
 * {@link CenterCard} — and centers a minimal welcome: the Hive mark, a short
 * tagline, and the primary actions. Until a server is configured, adding a
 * repository is disabled and "Start config" carries the primary emphasis.
 */
export default function HomeView({ onAddProject }: HomeViewProps) {
  const { isConfigured } = useConnection();

  return (
    <div className="flex h-full flex-col">
      <PageHeader />
      <CenterCard>
        <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-12">
          {/* Soft brand glow behind the mark — a touch of depth, never motion. */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-[36%] size-72 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-70 blur-3xl"
            style={{ background: "var(--hive-accent-glow)" }}
          />

          <div className="relative flex w-full max-w-sm flex-col items-center gap-8 text-center">
            <div className="flex flex-col items-center gap-5">
              <HiveLogo className="h-[68px] w-auto" />
              <div className="flex flex-col gap-1.5">
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                  Welcome to Hive
                </h1>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Run coding agents in parallel across your repositories. Add a
                  repository to spin up your first workspace.
                </p>
              </div>
            </div>

            <div className="flex w-full flex-col items-center gap-3">
              <div className="flex flex-wrap items-center justify-center gap-2.5">
                <Button
                  variant={isConfigured ? "default" : "outline"}
                  onClick={onAddProject}
                  disabled={!isConfigured}
                  className="cursor-pointer"
                >
                  <FolderGit2 />
                  Add repository
                </Button>
                <Button
                  asChild
                  variant={isConfigured ? "outline" : "default"}
                  className="cursor-pointer"
                >
                  <Link to="/settings">
                    <Settings />
                    Start config
                  </Link>
                </Button>
              </div>
              {!isConfigured && (
                <p className="text-xs text-muted-foreground/70">
                  Connect your server in settings to add repositories.
                </p>
              )}
            </div>

            <a
              href="https://docs.hive.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground/60 underline-offset-4 transition-colors hover:text-muted-foreground hover:underline"
            >
              Documentation
            </a>
          </div>
        </div>
      </CenterCard>
    </div>
  );
}
