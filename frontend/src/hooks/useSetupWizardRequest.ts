import { useSyncExternalStore } from "react";

// On-demand entry point for the setup wizard. The first-run gate
// (isTauri() && no server URL) only covers brand-new installs; users with an
// existing connection reach the wizard through this request flag instead
// (Settings > Connection > "Set up a new server").

let requested = false;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function openSetupWizard(): void {
  requested = true;
  notify();
}

export function closeSetupWizard(): void {
  requested = false;
  notify();
}

export function useSetupWizardRequest(): boolean {
  return useSyncExternalStore(subscribe, () => requested, () => false);
}
